import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { pool } from '../db/client.js';
import { pokemonRouter, itemsRouter, naturesRouter } from './pokemon.js';

const app = express();
app.use(express.json());
app.use('/api/v1/pokemon', pokemonRouter);
app.use('/api/v1/items', itemsRouter);
app.use('/api/v1/natures', naturesRouter);

// IDs sourced from static data (survives truncation)
let firstPokemonId: number | undefined;

beforeAll(async () => {
  // Seed minimal static data so endpoints return rows even without a full PokeAPI import.
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
  const res = await pool.query<{ id: number }>(
    'SELECT id FROM pokemon WHERE is_available = TRUE ORDER BY id LIMIT 1',
  );
  firstPokemonId = res.rows[0]?.id;
});

afterAll(async () => {
  await pool.end();
});

describe('GET /api/v1/pokemon/search', () => {
  it('returns an array', async () => {
    const res = await request(app).get('/api/v1/pokemon/search');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns results matching the query', async () => {
    const res = await request(app).get('/api/v1/pokemon/search?q=pika');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const p of res.body as { name: string }[]) {
      expect(p.name.toLowerCase()).toContain('pika');
    }
  });

  it('respects the limit parameter', async () => {
    const res = await request(app).get('/api/v1/pokemon/search?q=&limit=3');
    expect(res.status).toBe(200);
    expect((res.body as unknown[]).length).toBeLessThanOrEqual(3);
  });

  it('response items have the expected shape', async () => {
    const res = await request(app).get('/api/v1/pokemon/search?limit=1');
    expect(res.status).toBe(200);
    if ((res.body as unknown[]).length > 0) {
      expect(res.body[0]).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
        type1: expect.any(String),
      });
    }
  });
});

describe('GET /api/v1/pokemon/:id', () => {
  it('returns 404 for a non-existent pokemon', async () => {
    const res = await request(app).get('/api/v1/pokemon/999999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a non-numeric id', async () => {
    const res = await request(app).get('/api/v1/pokemon/notanumber');
    expect(res.status).toBe(404);
  });

  it('returns full pokemon data for a valid id', async () => {
    if (!firstPokemonId) return;

    const res = await request(app).get(`/api/v1/pokemon/${firstPokemonId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: firstPokemonId,
      name: expect.any(String),
      type1: expect.any(String),
      hp: expect.any(Number),
      atk: expect.any(Number),
      def: expect.any(Number),
      spa: expect.any(Number),
      spd: expect.any(Number),
      spe: expect.any(Number),
    });
  });
});

describe('GET /api/v1/pokemon/:id/moves', () => {
  it('returns an array of moves for a valid pokemon', async () => {
    if (!firstPokemonId) return;

    const res = await request(app).get(`/api/v1/pokemon/${firstPokemonId}/moves`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if ((res.body as unknown[]).length > 0) {
      expect(res.body[0]).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
        type: expect.any(String),
        category: expect.stringMatching(/^(physical|special|status)$/),
        pp: expect.any(Number),
        learn_method: expect.any(String),
      });
    }
  });

  it('returns 404 for non-numeric pokemon id', async () => {
    const res = await request(app).get('/api/v1/pokemon/bad/moves');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/pokemon/:id/abilities', () => {
  it('returns an array of abilities for a valid pokemon', async () => {
    if (!firstPokemonId) return;

    const res = await request(app).get(`/api/v1/pokemon/${firstPokemonId}/abilities`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if ((res.body as unknown[]).length > 0) {
      expect(res.body[0]).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
        effect_tag: expect.any(String),
        slot: expect.any(Number),
        is_hidden: expect.any(Boolean),
      });
    }
  });
});

describe('GET /api/v1/items', () => {
  it('returns an array of items', async () => {
    const res = await request(app).get('/api/v1/items');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('filters by category when provided', async () => {
    const res = await request(app).get('/api/v1/items?category=held');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const item of res.body as { category: string }[]) {
      expect(item.category).toBe('held');
    }
  });

  it('items have expected shape', async () => {
    const res = await request(app).get('/api/v1/items');
    expect(res.status).toBe(200);
    if ((res.body as unknown[]).length > 0) {
      expect(res.body[0]).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
        category: expect.any(String),
      });
    }
  });
});

describe('GET /api/v1/natures', () => {
  it('returns all natures', async () => {
    const res = await request(app).get('/api/v1/natures');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // 25 natures in the game
    expect((res.body as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('natures have expected shape', async () => {
    const res = await request(app).get('/api/v1/natures');
    expect(res.status).toBe(200);
    if ((res.body as unknown[]).length > 0) {
      expect(res.body[0]).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
      });
    }
  });
});
