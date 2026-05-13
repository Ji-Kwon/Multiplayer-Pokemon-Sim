import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/client.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

interface TeamRow {
  id: string;
  user_id: string;
  name: string;
  format: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

interface TeamPokemonRow {
  id: string;
  team_id: string;
  slot: number;
  pokemon_id: number;
  nickname: string | null;
  gender: string | null;
  ability_id: number;
  item_id: number | null;
  nature_id: number;
  move1_id: number | null;
  move2_id: number | null;
  move3_id: number | null;
  move4_id: number | null;
  ev_hp: number;
  ev_atk: number;
  ev_def: number;
  ev_spa: number;
  ev_spd: number;
  ev_spe: number;
  iv_hp: number;
  iv_atk: number;
  iv_def: number;
  iv_spa: number;
  iv_spd: number;
  iv_spe: number;
  tera_type_id: number | null;
}

const evField = z.number().int().min(0).max(252).default(0);
const ivField = z.number().int().min(0).max(31).default(31);

const SlotSchema = z
  .object({
    slot: z.number().int().min(1).max(6),
    pokemon_id: z.number().int().positive(),
    nickname: z.string().max(24).nullish(),
    gender: z.enum(['male', 'female', 'unknown']).nullish(),
    ability_id: z.number().int().positive(),
    item_id: z.number().int().positive().nullish(),
    nature_id: z.number().int().positive(),
    move1_id: z.number().int().positive().nullish(),
    move2_id: z.number().int().positive().nullish(),
    move3_id: z.number().int().positive().nullish(),
    move4_id: z.number().int().positive().nullish(),
    ev_hp: evField,
    ev_atk: evField,
    ev_def: evField,
    ev_spa: evField,
    ev_spd: evField,
    ev_spe: evField,
    iv_hp: ivField,
    iv_atk: ivField,
    iv_def: ivField,
    iv_spa: ivField,
    iv_spd: ivField,
    iv_spe: ivField,
    tera_type_id: z.number().int().positive().nullish(),
  })
  .refine(
    (d) => d.ev_hp + d.ev_atk + d.ev_def + d.ev_spa + d.ev_spd + d.ev_spe <= 510,
    { message: 'Total EVs cannot exceed 510' },
  );

const CreateTeamSchema = z.object({
  name: z.string().min(1).max(64),
  format: z.enum(['singles', 'doubles']),
});

const UpdateTeamSchema = z
  .object({
    name: z.string().min(1).max(64).optional(),
    format: z.enum(['singles', 'doubles']).optional(),
    slots: z.array(SlotSchema).max(6).optional(),
  })
  .refine(
    (d) => {
      if (!d.slots) return true;
      const nums = d.slots.map((s) => s.slot);
      return new Set(nums).size === nums.length;
    },
    { message: 'Duplicate slot numbers are not allowed', path: ['slots'] },
  );

function buildSlots(rows: TeamPokemonRow[]): (TeamPokemonRow | null)[] {
  const slots: (TeamPokemonRow | null)[] = Array(6).fill(null);
  for (const row of rows) {
    slots[row.slot - 1] = row;
  }
  return slots;
}

// GET / — list current user's teams
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query<{
      id: string;
      name: string;
      format: string;
      updated_at: Date;
      pokemon_count: number;
    }>(
      `SELECT t.id, t.name, t.format, t.updated_at, COUNT(tp.id)::int AS pokemon_count
       FROM teams t
       LEFT JOIN team_pokemon tp ON tp.team_id = t.id
       WHERE t.user_id = $1
       GROUP BY t.id
       ORDER BY t.updated_at DESC`,
      [req.userId],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List teams error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } });
  }
});

// POST / — create team
router.post('/', requireAuth, async (req, res) => {
  const parsed = CreateTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'Invalid input' } });
    return;
  }
  const { name, format } = parsed.data;
  try {
    const result = await pool.query<TeamRow>(
      `INSERT INTO teams (user_id, name, format)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, name, format, notes, created_at, updated_at`,
      [req.userId, name, format],
    );
    res.status(201).json({ ...result.rows[0], slots: Array(6).fill(null) });
  } catch (err) {
    console.error('Create team error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } });
  }
});

// GET /:id — get full team with all 6 slots
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const teamResult = await pool.query<TeamRow>(
      'SELECT id, user_id, name, format, notes, created_at, updated_at FROM teams WHERE id = $1',
      [req.params.id],
    );
    if (teamResult.rows.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Team not found' } });
      return;
    }
    const team = teamResult.rows[0];
    if (team.user_id !== req.userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
      return;
    }

    const pokemonResult = await pool.query<TeamPokemonRow>(
      'SELECT * FROM team_pokemon WHERE team_id = $1 ORDER BY slot',
      [req.params.id],
    );

    res.json({ ...team, slots: buildSlots(pokemonResult.rows) });
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr.code === '22P02') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Team not found' } });
      return;
    }
    console.error('Get team error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } });
  }
});

// PUT /:id — update team fields and/or replace all pokemon slots
router.put('/:id', requireAuth, async (req, res) => {
  const parsed = UpdateTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'Invalid input' } });
    return;
  }
  const { name, format, slots } = parsed.data;

  try {
    const teamResult = await pool.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM teams WHERE id = $1',
      [req.params.id],
    );
    if (teamResult.rows.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Team not found' } });
      return;
    }
    if (teamResult.rows[0].user_id !== req.userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const setClauses: string[] = ['updated_at = NOW()'];
      const values: unknown[] = [];
      let paramIdx = 1;

      if (name !== undefined) {
        setClauses.push(`name = $${paramIdx++}`);
        values.push(name);
      }
      if (format !== undefined) {
        setClauses.push(`format = $${paramIdx++}`);
        values.push(format);
      }
      values.push(req.params.id);

      await client.query(
        `UPDATE teams SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
        values,
      );

      if (slots !== undefined) {
        await client.query('DELETE FROM team_pokemon WHERE team_id = $1', [req.params.id]);

        for (const slot of slots) {
          await client.query(
            `INSERT INTO team_pokemon
             (team_id, slot, pokemon_id, nickname, gender, ability_id, item_id, nature_id,
              move1_id, move2_id, move3_id, move4_id,
              ev_hp, ev_atk, ev_def, ev_spa, ev_spd, ev_spe,
              iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe, tera_type_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
            [
              req.params.id,
              slot.slot,
              slot.pokemon_id,
              slot.nickname ?? null,
              slot.gender ?? null,
              slot.ability_id,
              slot.item_id ?? null,
              slot.nature_id,
              slot.move1_id ?? null,
              slot.move2_id ?? null,
              slot.move3_id ?? null,
              slot.move4_id ?? null,
              slot.ev_hp,
              slot.ev_atk,
              slot.ev_def,
              slot.ev_spa,
              slot.ev_spd,
              slot.ev_spe,
              slot.iv_hp,
              slot.iv_atk,
              slot.iv_def,
              slot.iv_spa,
              slot.iv_spd,
              slot.iv_spe,
              slot.tera_type_id ?? null,
            ],
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const updatedTeam = await pool.query<TeamRow>(
      'SELECT id, user_id, name, format, notes, created_at, updated_at FROM teams WHERE id = $1',
      [req.params.id],
    );
    const updatedPokemon = await pool.query<TeamPokemonRow>(
      'SELECT * FROM team_pokemon WHERE team_id = $1 ORDER BY slot',
      [req.params.id],
    );

    res.json({ ...updatedTeam.rows[0], slots: buildSlots(updatedPokemon.rows) });
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr.code === '22P02') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Team not found' } });
      return;
    }
    console.error('Update team error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } });
  }
});

// DELETE /:id — delete team (cascade removes team_pokemon)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const teamResult = await pool.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM teams WHERE id = $1',
      [req.params.id],
    );
    if (teamResult.rows.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Team not found' } });
      return;
    }
    if (teamResult.rows[0].user_id !== req.userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
      return;
    }

    await pool.query('DELETE FROM teams WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr.code === '22P02') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Team not found' } });
      return;
    }
    console.error('Delete team error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An error occurred' } });
  }
});

export default router;
