import { Router } from 'express';
import { pool } from '../db/client.js';

const pokemonRouter = Router();
const itemsRouter = Router();
const naturesRouter = Router();

// GET /search?q=&limit=20
pokemonRouter.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 20), 100);

  try {
    const result = await pool.query<{
      id: number;
      name: string;
      form_name: string | null;
      type1: string;
      type2: string | null;
      sprite_url: string | null;
    }>(
      `SELECT p.id, p.name, p.form_name, t1.name AS type1, t2.name AS type2, p.sprite_url
       FROM pokemon p
       JOIN types t1 ON t1.id = p.type1_id
       LEFT JOIN types t2 ON t2.id = p.type2_id
       WHERE p.is_available = TRUE AND p.name ILIKE $1
       ORDER BY p.id
       LIMIT $2`,
      [`%${q}%`, limit],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Pokemon search error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } });
  }
});

// GET /:id — full pokemon data including base stats
pokemonRouter.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pokemon not found' } });
    return;
  }

  try {
    const result = await pool.query<{
      id: number;
      name: string;
      form_name: string | null;
      base_form_id: number | null;
      type1: string;
      type2: string | null;
      hp: number;
      atk: number;
      def: number;
      spa: number;
      spd: number;
      spe: number;
      weight_kg: number;
      sprite_url: string | null;
      sprite_shiny_url: string | null;
      is_legendary: boolean;
      is_mythical: boolean;
      generation: number;
      is_available: boolean;
    }>(
      `SELECT p.id, p.name, p.form_name, p.base_form_id,
              t1.name AS type1, t2.name AS type2,
              p.hp, p.atk, p.def, p.spa, p.spd, p.spe,
              p.weight_kg, p.sprite_url, p.sprite_shiny_url,
              p.is_legendary, p.is_mythical, p.generation, p.is_available
       FROM pokemon p
       JOIN types t1 ON t1.id = p.type1_id
       LEFT JOIN types t2 ON t2.id = p.type2_id
       WHERE p.id = $1 AND p.is_available = TRUE`,
      [id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pokemon not found' } });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get pokemon error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } });
  }
});

// GET /:id/moves — learnset for this pokemon
pokemonRouter.get('/:id/moves', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pokemon not found' } });
    return;
  }

  try {
    const result = await pool.query<{
      id: number;
      name: string;
      type: string;
      category: string;
      power: number | null;
      accuracy: number | null;
      pp: number;
      priority: number;
      learn_method: string;
      level_learned: number | null;
    }>(
      `SELECT m.id, m.name, t.name AS type, m.category, m.power, m.accuracy, m.pp, m.priority,
              pm.learn_method, pm.level_learned
       FROM pokemon_moves pm
       JOIN moves m ON m.id = pm.move_id
       JOIN types t ON t.id = m.type_id
       WHERE pm.pokemon_id = $1
       ORDER BY m.name`,
      [id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get pokemon moves error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } });
  }
});

// GET /:id/abilities — abilities available to this pokemon
pokemonRouter.get('/:id/abilities', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pokemon not found' } });
    return;
  }

  try {
    const result = await pool.query<{
      id: number;
      name: string;
      effect_tag: string;
      description: string | null;
      slot: number;
      is_hidden: boolean;
    }>(
      `SELECT a.id, a.name, a.effect_tag, a.description, pa.slot, (pa.slot = 3) AS is_hidden
       FROM pokemon_abilities pa
       JOIN abilities a ON a.id = pa.ability_id
       WHERE pa.pokemon_id = $1
       ORDER BY pa.slot`,
      [id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get pokemon abilities error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } });
  }
});

// GET /items?category=held — list items, optionally filtered by category
itemsRouter.get('/', async (req, res) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const result = await pool.query<{
      id: number;
      name: string;
      category: string;
      effect_tag: string | null;
      description: string | null;
    }>(
      category
        ? 'SELECT id, name, category, effect_tag, description FROM items WHERE category = $1 ORDER BY name'
        : 'SELECT id, name, category, effect_tag, description FROM items ORDER BY name',
      category ? [category] : [],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get items error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } });
  }
});

// GET /natures — all 25 natures
naturesRouter.get('/', async (_req, res) => {
  try {
    const result = await pool.query<{
      id: number;
      name: string;
      boosted_stat: string | null;
      reduced_stat: string | null;
    }>('SELECT id, name, boosted_stat, reduced_stat FROM natures ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('Get natures error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } });
  }
});

export { pokemonRouter, itemsRouter, naturesRouter };
