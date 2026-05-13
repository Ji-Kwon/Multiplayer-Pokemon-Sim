# Database — CLAUDE.md

PostgreSQL database for the Pokemon Battle Simulator. This document contains the full schema,
migration conventions, seeding approach, and query patterns.

Migration tool: `node-pg-migrate`. All schema changes go through migrations — never modify
tables directly. Migration files live in `database/migrations/`.

---

## Running Migrations

All migration commands are run from the `backend/` directory (that's where `package.json`
and the `node-pg-migrate` config live). The `-m ../database/migrations` flag in each script
points back up to this directory.

```bash
# From backend/

# Apply all pending migrations
npm run migrate:up

# Roll back the most recent migration (one at a time — run 6× to fully revert)
npm run migrate:down

# Create a new migration file in database/migrations/
npm run migrate:create -- --name <descriptive-name>
```

## Migration Files

| File | What it creates |
|---|---|
| `1731000000000_initial-types-and-lookups.js` | `types`, `type_chart`, `natures`, `move_effects` |
| `1731000000001_pokemon-and-move-data.js` | `abilities`, `items`, `pokemon`, `moves`, `pokemon_abilities`, `pokemon_moves`, `pokemon_forms` |
| `1731000000002_user-and-team-data.js` | `users`, `teams`, `team_pokemon` |
| `1731000000003_battle-data.js` | `battles`, `battle_turns`, `battle_chat` |
| `1731000000004_indexes.js` | All indexes listed in the Indexes section below |
| `1731000000005_test-helpers.js` | `truncate_all_tables()` PL/pgSQL function |

### Migration authoring conventions
- Use `pgm.sql(...)` for `CREATE TABLE` statements — raw SQL matches the spec exactly and
  avoids API-translation errors with composite PKs, multi-column CHECK constraints, and
  self-referencing FKs.
- Use `pgm.createIndex()` / `pgm.dropIndex()` for index management (pgm API handles these cleanly).
- Use `pgm.sql(...)` for `CREATE FUNCTION` / `DROP FUNCTION`.
- Every `down()` calls `pgm.dropTable(name, { cascade: true })` in reverse creation order.

---

## Full Schema

### Static Data Tables (seeded from PokeAPI, rarely changed)

```sql
CREATE TABLE types (
  id         SMALLINT PRIMARY KEY,    -- 1–18, matches PokeAPI IDs
  name       VARCHAR(16) NOT NULL UNIQUE
);

CREATE TABLE type_chart (
  attacker_type_id  SMALLINT REFERENCES types(id),
  defender_type_id  SMALLINT REFERENCES types(id),
  multiplier        REAL NOT NULL,    -- 0, 0.25, 0.5, 1, 2
  PRIMARY KEY (attacker_type_id, defender_type_id)
);

CREATE TABLE natures (
  id               SMALLINT PRIMARY KEY,
  name             VARCHAR(16) NOT NULL UNIQUE,
  boosted_stat     VARCHAR(8),        -- 'atk','def','spa','spd','spe' or NULL (neutral)
  reduced_stat     VARCHAR(8)         -- same or NULL
);

CREATE TABLE pokemon (
  id               INTEGER PRIMARY KEY,   -- national dex number
  name             VARCHAR(64) NOT NULL,
  form_name        VARCHAR(64),           -- NULL for base form; 'alolan', 'galar-zen', etc.
  base_form_id     INTEGER REFERENCES pokemon(id),  -- NULL if this is a base form
  type1_id         SMALLINT NOT NULL REFERENCES types(id),
  type2_id         SMALLINT REFERENCES types(id),   -- NULL if single-typed
  hp               SMALLINT NOT NULL,
  atk              SMALLINT NOT NULL,
  def              SMALLINT NOT NULL,
  spa              SMALLINT NOT NULL,
  spd              SMALLINT NOT NULL,
  spe              SMALLINT NOT NULL,
  weight_kg        REAL NOT NULL,
  sprite_url       TEXT,
  sprite_shiny_url TEXT,
  is_legendary     BOOLEAN NOT NULL DEFAULT FALSE,
  is_mythical      BOOLEAN NOT NULL DEFAULT FALSE,
  generation       SMALLINT NOT NULL,
  is_available     BOOLEAN NOT NULL DEFAULT TRUE   -- FALSE = not in current ruleset
);

CREATE TABLE abilities (
  id          INTEGER PRIMARY KEY,    -- PokeAPI ability ID
  name        VARCHAR(64) NOT NULL UNIQUE,
  effect_tag  VARCHAR(64) NOT NULL,   -- machine-readable key used by ability registry
  description TEXT
);

CREATE TABLE moves (
  id              INTEGER PRIMARY KEY,   -- PokeAPI move ID
  name            VARCHAR(64) NOT NULL UNIQUE,
  type_id         SMALLINT NOT NULL REFERENCES types(id),
  category        VARCHAR(8) NOT NULL CHECK (category IN ('physical','special','status')),
  power           SMALLINT,              -- NULL for status moves
  accuracy        SMALLINT,              -- NULL = never misses (swift, etc.)
  pp              SMALLINT NOT NULL,
  priority        SMALLINT NOT NULL DEFAULT 0,
  effect_id       INTEGER NOT NULL,      -- references move_effects.effect_id
  effect_chance   SMALLINT,              -- % chance for secondary effect, NULL if not applicable
  target          VARCHAR(32) NOT NULL,  -- 'selected-pokemon','all-opponents','user','all-adjacent', etc.
  is_contact      BOOLEAN NOT NULL DEFAULT FALSE,
  is_sound        BOOLEAN NOT NULL DEFAULT FALSE,
  is_punch        BOOLEAN NOT NULL DEFAULT FALSE,
  is_bite         BOOLEAN NOT NULL DEFAULT FALSE,
  is_pulse        BOOLEAN NOT NULL DEFAULT FALSE,
  is_bomb         BOOLEAN NOT NULL DEFAULT FALSE,
  is_powder       BOOLEAN NOT NULL DEFAULT FALSE,
  is_dance        BOOLEAN NOT NULL DEFAULT FALSE,
  is_wind         BOOLEAN NOT NULL DEFAULT FALSE,
  has_recoil      BOOLEAN NOT NULL DEFAULT FALSE,
  has_drain       BOOLEAN NOT NULL DEFAULT FALSE,
  flags           JSONB NOT NULL DEFAULT '{}'  -- overflow for less common flags
);

CREATE TABLE move_effects (
  effect_id    INTEGER PRIMARY KEY,
  name         VARCHAR(64) NOT NULL UNIQUE,  -- e.g. 'DAMAGE_RECOIL_QUARTER'
  description  TEXT
);

CREATE TABLE items (
  id            INTEGER PRIMARY KEY,   -- PokeAPI item ID
  name          VARCHAR(64) NOT NULL UNIQUE,
  category      VARCHAR(32) NOT NULL,  -- 'held','berry','battle','mega-stone','z-crystal', etc.
  effect_tag    VARCHAR(64),           -- machine-readable key, NULL if no held effect
  natural_gift_type_id SMALLINT REFERENCES types(id),  -- for berries
  natural_gift_power   SMALLINT,
  description   TEXT
);

CREATE TABLE pokemon_abilities (
  pokemon_id   INTEGER NOT NULL REFERENCES pokemon(id),
  ability_id   INTEGER NOT NULL REFERENCES abilities(id),
  slot         SMALLINT NOT NULL CHECK (slot IN (1, 2, 3)),  -- 3 = hidden ability
  PRIMARY KEY (pokemon_id, ability_id)
);

CREATE TABLE pokemon_moves (
  pokemon_id    INTEGER NOT NULL REFERENCES pokemon(id),
  move_id       INTEGER NOT NULL REFERENCES moves(id),
  learn_method  VARCHAR(16) NOT NULL,  -- 'level-up','tm','egg','tutor','reminder'
  level_learned SMALLINT,              -- NULL if not level-up
  PRIMARY KEY (pokemon_id, move_id, learn_method)
);

-- Mega evolutions and form changes
CREATE TABLE pokemon_forms (
  id              SERIAL PRIMARY KEY,
  base_pokemon_id INTEGER NOT NULL REFERENCES pokemon(id),
  form_pokemon_id INTEGER NOT NULL REFERENCES pokemon(id),  -- must exist in pokemon table
  trigger         VARCHAR(16) NOT NULL,  -- 'mega','tera','gmax','other'
  required_item_id INTEGER REFERENCES items(id),            -- e.g. mega stone
  UNIQUE (base_pokemon_id, trigger)
);
```

### User Data Tables

```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(254) NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  username        VARCHAR(32) NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(64) NOT NULL,
  format      VARCHAR(16) NOT NULL CHECK (format IN ('singles','doubles')),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE team_pokemon (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slot        SMALLINT NOT NULL CHECK (slot BETWEEN 1 AND 6),
  pokemon_id  INTEGER NOT NULL REFERENCES pokemon(id),
  nickname    VARCHAR(24),
  gender      VARCHAR(8) CHECK (gender IN ('male','female','unknown')),
  ability_id  INTEGER NOT NULL REFERENCES abilities(id),
  item_id     INTEGER REFERENCES items(id),
  nature_id   SMALLINT NOT NULL REFERENCES natures(id),
  move1_id    INTEGER REFERENCES moves(id),
  move2_id    INTEGER REFERENCES moves(id),
  move3_id    INTEGER REFERENCES moves(id),
  move4_id    INTEGER REFERENCES moves(id),
  -- EVs: each 0–252, sum ≤ 510 (enforced in application layer)
  ev_hp       SMALLINT NOT NULL DEFAULT 0,
  ev_atk      SMALLINT NOT NULL DEFAULT 0,
  ev_def      SMALLINT NOT NULL DEFAULT 0,
  ev_spa      SMALLINT NOT NULL DEFAULT 0,
  ev_spd      SMALLINT NOT NULL DEFAULT 0,
  ev_spe      SMALLINT NOT NULL DEFAULT 0,
  -- IVs: each 0–31
  iv_hp       SMALLINT NOT NULL DEFAULT 31,
  iv_atk      SMALLINT NOT NULL DEFAULT 31,
  iv_def      SMALLINT NOT NULL DEFAULT 31,
  iv_spa      SMALLINT NOT NULL DEFAULT 31,
  iv_spd      SMALLINT NOT NULL DEFAULT 31,
  iv_spe      SMALLINT NOT NULL DEFAULT 31,
  -- Gen 9
  tera_type_id SMALLINT REFERENCES types(id),
  UNIQUE (team_id, slot)
);
```

### Battle Data Tables

```sql
CREATE TABLE battles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  format        VARCHAR(16) NOT NULL CHECK (format IN ('singles','doubles')),
  ruleset_name  VARCHAR(64) NOT NULL,      -- e.g. 'Gen9VGC2025'
  player1_id    UUID NOT NULL REFERENCES users(id),
  player2_id    UUID REFERENCES users(id), -- NULL if vs AI
  winner_id     UUID REFERENCES users(id), -- NULL if draw or in progress
  result        VARCHAR(16) CHECK (result IN ('player1','player2','draw','forfeit','timeout')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  -- Team snapshots at battle start (denormalized for replay integrity)
  player1_team  JSONB NOT NULL,
  player2_team  JSONB NOT NULL
);

CREATE TABLE battle_turns (
  id             SERIAL,
  battle_id      UUID NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  turn_number    SMALLINT NOT NULL,
  -- Full battle state snapshot at END of this turn (before replacement switches)
  state_snapshot JSONB NOT NULL,
  -- Ordered array of TurnLogEntry objects
  turn_log       JSONB NOT NULL,
  -- Both players' submitted actions this turn
  actions        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (battle_id, turn_number)
);

CREATE TABLE battle_chat (
  id          SERIAL PRIMARY KEY,
  battle_id   UUID NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  message     VARCHAR(256) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Indexes

```sql
-- Team queries
CREATE INDEX idx_teams_user_id ON teams(user_id);
CREATE INDEX idx_team_pokemon_team_id ON team_pokemon(team_id);

-- Learnset lookups (team builder autocomplete)
CREATE INDEX idx_pokemon_moves_pokemon_id ON pokemon_moves(pokemon_id);
CREATE INDEX idx_pokemon_moves_move_id ON pokemon_moves(move_id);
CREATE INDEX idx_pokemon_abilities_pokemon_id ON pokemon_abilities(pokemon_id);

-- Battle lookups
CREATE INDEX idx_battles_player1 ON battles(player1_id);
CREATE INDEX idx_battles_player2 ON battles(player2_id);
CREATE INDEX idx_battle_turns_battle_id ON battle_turns(battle_id);

-- Pokemon search
CREATE INDEX idx_pokemon_name ON pokemon(name);
CREATE INDEX idx_pokemon_available ON pokemon(is_available) WHERE is_available = TRUE;
```

---

## Seeding Order

Due to foreign key constraints, seed in this order:
1. `types` (no dependencies)
2. `type_chart` (depends on types)
3. `natures` (no dependencies)
4. `move_effects` (no dependencies)
5. `abilities` (no dependencies)
6. `items` (depends on types for natural_gift)
7. `pokemon` — base forms first, then alternate forms (self-referencing FK)
8. `moves` (depends on types, move_effects)
9. `pokemon_abilities` (depends on pokemon, abilities)
10. `pokemon_moves` (depends on pokemon, moves)
11. `pokemon_forms` (depends on pokemon, items)

See `specs/data-import.md` for the import pipeline that produces this seed data.

---

## JSONB Conventions

Fields stored as JSONB:
- `battles.player1_team` / `player2_team` — snapshot of team at battle start; typed as `TeamSnapshot`
- `battle_turns.state_snapshot` — full `BattleState` object serialized
- `battle_turns.turn_log` — `TurnLogEntry[]` array
- `battle_turns.actions` — `{ player1: Action, player2: Action }` (or array for doubles)
- `moves.flags` — additional boolean flags not common enough to warrant columns

JSONB fields are not queried in hot paths — they're for storage and replay. If you find yourself filtering on JSONB fields, add a typed column instead.

---

## Connection & Config

```typescript
// backend/src/db/client.ts
import { Pool } from 'pg'
export const pool = new Pool({ connectionString: process.env.DATABASE_URL })
```

Use a connection pool. Never create single-use `Client` objects in request handlers.
All queries use parameterized statements — no string interpolation with user input.

---

## Test Database

Integration tests run against a separate DB: `DATABASE_URL_TEST` env var.
Tests call `truncate_all_tables()` (created by migration `1731000000005_test-helpers.js`) in
`beforeEach`, not `DROP` / recreate.

`truncate_all_tables()` truncates **only** the user and battle tables:
`battle_chat`, `battle_turns`, `battles`, `team_pokemon`, `teams`, `users` — with
`RESTART IDENTITY CASCADE`. Static data tables (`types`, `type_chart`, `natures`,
`move_effects`, `abilities`, `items`, `pokemon`, `moves`, `pokemon_abilities`,
`pokemon_moves`, `pokemon_forms`) are intentionally excluded and survive between test runs.
