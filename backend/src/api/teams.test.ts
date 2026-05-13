import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { pool } from '../db/client.js';
import authRouter from './auth.js';
import teamsRouter from './teams.js';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/teams', teamsRouter);

// Fetched once from static data tables (never truncated by truncate_all_tables)
let validIds!: { pokemonId: number; abilityId: number; natureId: number };

beforeAll(async () => {
  // Seed minimal static data so FK constraints work even if the test DB has no seeded data.
  // ON CONFLICT DO NOTHING keeps this idempotent when the DB is already seeded.
  await pool.query(`INSERT INTO types (id, name) VALUES (1, 'normal') ON CONFLICT DO NOTHING`);
  await pool.query(`INSERT INTO natures (id, name) VALUES (1, 'hardy') ON CONFLICT DO NOTHING`);
  await pool.query(
    `INSERT INTO abilities (id, name, effect_tag) VALUES (1, 'overgrow', 'overgrow') ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO pokemon (id, name, type1_id, hp, atk, def, spa, spd, spe, weight_kg, generation)
     VALUES (1, 'bulbasaur', 1, 45, 49, 49, 65, 65, 45, 6.9, 1)
     ON CONFLICT DO NOTHING`,
  );
  validIds = { pokemonId: 1, abilityId: 1, natureId: 1 };
});

beforeEach(async () => {
  await pool.query('SELECT truncate_all_tables()');
});

afterAll(async () => {
  await pool.end();
});

async function registerAndLogin(email: string, username: string): Promise<string> {
  await request(app)
    .post('/api/v1/auth/register')
    .send({ email, username, password: 'password123' });
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'password123' });
  const cookies = res.headers['set-cookie'] as string[];
  return cookies.find((c) => c.startsWith('token='))!.split(';')[0];
}

function makeSlot(slot: number) {
  return {
    slot,
    pokemon_id: validIds.pokemonId,
    ability_id: validIds.abilityId,
    nature_id: validIds.natureId,
  };
}

describe('GET /api/v1/teams', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/teams');
    expect(res.status).toBe(401);
  });

  it('returns empty array when user has no teams', async () => {
    const cookie = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const res = await request(app).get('/api/v1/teams').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns team summaries with pokemon_count', async () => {
    const cookie = await registerAndLogin('ash@pokemon.com', 'ashketchum');

    await request(app)
      .post('/api/v1/teams')
      .set('Cookie', cookie)
      .send({ name: 'Team Alpha', format: 'singles' });

    const res = await request(app).get('/api/v1/teams').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ name: 'Team Alpha', format: 'singles', pokemon_count: 0 });
  });
});

describe('POST /api/v1/teams', () => {
  it('creates a team and returns 201 with full team object', async () => {
    const cookie = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const res = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', cookie)
      .send({ name: 'My Team', format: 'singles' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'My Team', format: 'singles' });
    expect(typeof res.body.id).toBe('string');
    expect(res.body.slots).toHaveLength(6);
    expect(res.body.slots.every((s: unknown) => s === null)).toBe(true);
  });

  it('returns 400 for missing name', async () => {
    const cookie = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const res = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', cookie)
      .send({ format: 'singles' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid format', async () => {
    const cookie = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const res = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', cookie)
      .send({ name: 'My Team', format: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/v1/teams').send({ name: 'X', format: 'singles' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/teams/:id', () => {
  it('returns the full team with 6 slots', async () => {
    const cookie = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const createRes = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', cookie)
      .send({ name: 'My Team', format: 'singles' });

    const res = await request(app)
      .get(`/api/v1/teams/${createRes.body.id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createRes.body.id);
    expect(res.body.slots).toHaveLength(6);
  });

  it('returns 404 for unknown team', async () => {
    const cookie = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const res = await request(app)
      .get('/api/v1/teams/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('returns 403 when accessing another user\'s team', async () => {
    const cookie1 = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const cookie2 = await registerAndLogin('misty@pokemon.com', 'misty');

    const createRes = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', cookie1)
      .send({ name: 'Ash\'s Team', format: 'singles' });

    const res = await request(app)
      .get(`/api/v1/teams/${createRes.body.id}`)
      .set('Cookie', cookie2);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('PUT /api/v1/teams/:id', () => {
  it('updates team name', async () => {
    const cookie = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const createRes = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', cookie)
      .send({ name: 'Old Name', format: 'singles' });

    const res = await request(app)
      .put(`/api/v1/teams/${createRes.body.id}`)
      .set('Cookie', cookie)
      .send({ name: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
    expect(res.body.slots).toHaveLength(6);
  });

  it('adds a pokemon to a slot', async () => {
    const cookie = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const createRes = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', cookie)
      .send({ name: 'My Team', format: 'singles' });

    const res = await request(app)
      .put(`/api/v1/teams/${createRes.body.id}`)
      .set('Cookie', cookie)
      .send({ slots: [makeSlot(1)] });

    expect(res.status).toBe(200);
    expect(res.body.slots[0]).not.toBeNull();
    expect(res.body.slots[0].pokemon_id).toBe(validIds.pokemonId);
    expect(res.body.slots[1]).toBeNull();
  });

  it('replaces all slots when slots array is provided', async () => {
    const cookie = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const createRes = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', cookie)
      .send({ name: 'My Team', format: 'singles' });
    const teamId = createRes.body.id;

    // Add slot 1 and 2
    await request(app)
      .put(`/api/v1/teams/${teamId}`)
      .set('Cookie', cookie)
      .send({ slots: [makeSlot(1), makeSlot(2)] });

    // Replace with only slot 3 — slots 1 and 2 should be gone
    const res = await request(app)
      .put(`/api/v1/teams/${teamId}`)
      .set('Cookie', cookie)
      .send({ slots: [makeSlot(3)] });

    expect(res.status).toBe(200);
    expect(res.body.slots[0]).toBeNull();
    expect(res.body.slots[1]).toBeNull();
    expect(res.body.slots[2]).not.toBeNull();
  });

  it('returns 400 when EVs exceed 510', async () => {
    const cookie = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const createRes = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', cookie)
      .send({ name: 'My Team', format: 'singles' });

    const res = await request(app)
      .put(`/api/v1/teams/${createRes.body.id}`)
      .set('Cookie', cookie)
      .send({
        slots: [
          {
            ...makeSlot(1),
            ev_hp: 252,
            ev_atk: 252,
            ev_def: 7,  // total = 511
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts EVs that sum to exactly 510', async () => {
    const cookie = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const createRes = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', cookie)
      .send({ name: 'My Team', format: 'singles' });

    const res = await request(app)
      .put(`/api/v1/teams/${createRes.body.id}`)
      .set('Cookie', cookie)
      .send({
        slots: [
          {
            ...makeSlot(1),
            ev_hp: 252,
            ev_atk: 252,
            ev_spe: 6,  // total = 510
          },
        ],
      });

    expect(res.status).toBe(200);
  });

  it('returns 400 for duplicate slot numbers', async () => {
    const cookie = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const createRes = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', cookie)
      .send({ name: 'My Team', format: 'singles' });

    const res = await request(app)
      .put(`/api/v1/teams/${createRes.body.id}`)
      .set('Cookie', cookie)
      .send({ slots: [makeSlot(1), makeSlot(1)] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when updating another user\'s team', async () => {
    const cookie1 = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const cookie2 = await registerAndLogin('misty@pokemon.com', 'misty');

    const createRes = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', cookie1)
      .send({ name: 'Ash\'s Team', format: 'singles' });

    const res = await request(app)
      .put(`/api/v1/teams/${createRes.body.id}`)
      .set('Cookie', cookie2)
      .send({ name: 'Stolen' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('DELETE /api/v1/teams/:id', () => {
  it('deletes the team and returns 204', async () => {
    const cookie = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const createRes = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', cookie)
      .send({ name: 'My Team', format: 'singles' });

    const deleteRes = await request(app)
      .delete(`/api/v1/teams/${createRes.body.id}`)
      .set('Cookie', cookie);

    expect(deleteRes.status).toBe(204);

    const getRes = await request(app)
      .get(`/api/v1/teams/${createRes.body.id}`)
      .set('Cookie', cookie);
    expect(getRes.status).toBe(404);
  });

  it('returns 403 when deleting another user\'s team', async () => {
    const cookie1 = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const cookie2 = await registerAndLogin('misty@pokemon.com', 'misty');

    const createRes = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', cookie1)
      .send({ name: 'Ash\'s Team', format: 'singles' });

    const res = await request(app)
      .delete(`/api/v1/teams/${createRes.body.id}`)
      .set('Cookie', cookie2);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 for non-existent team', async () => {
    const cookie = await registerAndLogin('ash@pokemon.com', 'ashketchum');
    const res = await request(app)
      .delete('/api/v1/teams/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});
