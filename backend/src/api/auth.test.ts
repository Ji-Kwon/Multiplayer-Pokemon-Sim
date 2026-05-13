import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { pool } from '../db/client.js';
import authRouter from './auth.js';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/v1/auth', authRouter);

beforeEach(async () => {
  await pool.query('SELECT truncate_all_tables()');
});

afterAll(async () => {
  await pool.end();
});

describe('POST /api/v1/auth/register', () => {
  it('creates a new user and returns 201 with id, email, username', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'ash@pokemon.com', username: 'ashketchum', password: 'pikachu1' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'ash@pokemon.com', username: 'ashketchum' });
    expect(typeof res.body.id).toBe('string');
    expect(res.body.password_hash).toBeUndefined();
  });

  it('returns 409 with EMAIL_TAKEN when email is already registered', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'ash@pokemon.com', username: 'ashketchum', password: 'pikachu1' });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'ash@pokemon.com', username: 'misty', password: 'starmie1' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('returns 409 with USERNAME_TAKEN when username is already taken', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'ash@pokemon.com', username: 'ashketchum', password: 'pikachu1' });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'misty@pokemon.com', username: 'ashketchum', password: 'starmie1' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USERNAME_TAKEN');
  });

  it('returns 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'notanemail', username: 'ashketchum', password: 'pikachu1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when username is under 3 characters', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'ash@pokemon.com', username: 'ab', password: 'pikachu1' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when password is under 8 characters', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'ash@pokemon.com', username: 'ashketchum', password: 'short' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'ash@pokemon.com', username: 'ashketchum', password: 'pikachu1' });
  });

  it('returns 200 and sets httpOnly token cookie on valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ash@pokemon.com', password: 'pikachu1' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'ash@pokemon.com', username: 'ashketchum' });
    expect(typeof res.body.id).toBe('string');

    const setCookie = res.headers['set-cookie'] as string[] | undefined;
    expect(setCookie).toBeDefined();
    const tokenCookie = setCookie!.find((c) => c.startsWith('token='));
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie).toMatch(/HttpOnly/i);
  });

  it('returns 401 with INVALID_CREDENTIALS on wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ash@pokemon.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 for email that does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@pokemon.com', password: 'pikachu1' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('returns 204 and clears the token cookie', async () => {
    const res = await request(app).post('/api/v1/auth/logout');

    expect(res.status).toBe(204);
    const setCookie = res.headers['set-cookie'] as string[] | undefined;
    expect(setCookie).toBeDefined();
    const tokenCookie = setCookie!.find((c) => c.startsWith('token='));
    expect(tokenCookie).toBeDefined();
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns 401 when no cookie is provided', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with a tampered token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', 'token=totallyfaketoken');

    expect(res.status).toBe(401);
  });

  it('returns the current user when a valid token cookie is present', async () => {
    const registerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'ash@pokemon.com', username: 'ashketchum', password: 'pikachu1' });

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ash@pokemon.com', password: 'pikachu1' });

    const setCookie = loginRes.headers['set-cookie'] as string[];
    const tokenCookie = setCookie.find((c) => c.startsWith('token='))!;
    const cookieValue = tokenCookie.split(';')[0];

    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookieValue);

    expect(meRes.status).toBe(200);
    expect(meRes.body).toMatchObject({
      id: registerRes.body.id,
      email: 'ash@pokemon.com',
      username: 'ashketchum',
    });
    expect(meRes.body.password_hash).toBeUndefined();
  });
});
