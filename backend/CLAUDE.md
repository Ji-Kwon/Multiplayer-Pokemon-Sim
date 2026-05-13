# Backend — CLAUDE.md

Node.js + Express + Socket.io API server. TypeScript strict mode throughout.

## Running the Backend

```bash
npm run dev          # tsx watch — hot reload on src/ changes
npm run build        # tsc → dist/
npm run test         # vitest run (single pass)
npm run test:watch   # vitest watch mode
npm run migrate:up   # apply all pending migrations (targets database/migrations/)
npm run migrate:down # roll back one migration
npm run migrate:create -- --name <name>  # create new migration file in database/migrations/
```

## Key Dependencies

| Package | Purpose |
|---|---|
| express 4 | HTTP API server |
| socket.io 4 | WebSocket battle server (shares httpServer with express) |
| pg 8 | PostgreSQL client — use connection pool from `src/db/client.ts` |
| node-pg-migrate 7 | Migrations — files live in `database/migrations/` |
| zod 3 | Input validation on all API boundaries and PokeAPI responses |
| jsonwebtoken 9 | JWT auth — signed with `JWT_SECRET`, stored in httpOnly cookie |
| dotenv | Loaded via `import 'dotenv/config'` at top of `src/index.ts` |
| tsx | Dev runtime — no compile step needed during development |
| vitest | Test runner — config in `vitest.config.ts` |

## Environment Variables

Defined in `.env.example`:
```
DATABASE_URL=postgres://user:password@localhost:5432/pokemon_battle
JWT_SECRET=change_me_in_production
ML_SERVICE_URL=http://localhost:8000
POKEAPI_BASE_URL=https://pokeapi.co/api/v2
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```
Never commit `.env`. Copy `.env.example` to `.env` and fill in real values.

## Directory Structure

```
backend/
├── src/
│   ├── index.ts              ← entry point: Express app + Socket.io server setup
│   ├── db/
│   │   └── client.ts         ← pg Pool singleton (create this)
│   ├── api/                  ← REST route handlers
│   │   ├── auth.ts
│   │   ├── teams.ts
│   │   └── pokemon.ts
│   ├── ws/                   ← WebSocket event handlers
│   │   └── battle.ts
│   ├── battle-engine/        ← all battle logic (see battle-engine/CLAUDE.md)
│   └── scripts/              ← one-off scripts (PokeAPI import, etc.)
├── package.json
├── tsconfig.json
└── vitest.config.ts

# NOTE: migration files live at the PROJECT ROOT under database/migrations/, not inside
# backend/. The migrate:* scripts use -m ../database/migrations to reach them from here.
```

## Server Setup (src/index.ts — already scaffolded)

Express and Socket.io share one `httpServer`. CORS is configured to allow `FRONTEND_URL`
(defaults to `http://localhost:5173`). Cookie parser is registered for JWT cookie reads.

Socket.io currently has a placeholder `battle:join` handler — full protocol implemented in Step 10.

## API Conventions

- All routes under `/api/v1/`
- Auth: JWT in httpOnly cookie named `token`. Middleware reads and verifies it.
- Request bodies validated with Zod. Return 400 with `{ error: { code, message } }` on invalid input.
- Success responses: 200/201 with the resource object. 204 for deletes.
- Error shape: `{ error: { code: string, message: string } }`

## Database Connection

Create `src/db/client.ts` with a single exported `Pool` instance:
```typescript
import { Pool } from 'pg'
export const pool = new Pool({ connectionString: process.env.DATABASE_URL })
```
Import `pool` wherever DB access is needed. Never instantiate `new Client()` in handlers.
All queries use parameterized statements — never string-interpolate user input.

## Auth Approach

- Register: hash password with bcrypt (salt rounds: 12), store in `users` table
- Login: verify hash, sign JWT `{ sub: userId }` with `JWT_SECRET`, set httpOnly cookie
- Protected routes: middleware verifies JWT from cookie, attaches `req.userId`
- JWT expiry: 7 days

### Using auth middleware on a new route

```typescript
import { requireAuth } from '../middleware/auth.js';

router.get('/some-protected-route', requireAuth, async (req, res) => {
  // req.userId is a string (UUID) guaranteed to be set here
});
```

`requireAuth` is exported from `src/middleware/auth.ts`. It reads the httpOnly cookie
named **`token`**, verifies it with `JWT_SECRET`, and attaches `req.userId` (string).
Returns `401` with `{ error: { code: 'UNAUTHORIZED', message } }` if the cookie is
missing or the token is invalid/expired.

The `req.userId` property is declared in `src/types/express.d.ts` via global Express
namespace augmentation — no import needed in route files.

## Implemented API Endpoints

All TypeScript interfaces for every response shape live in `frontend/src/types/api.ts`.
Error responses always have the shape `{ error: { code: string, message: string } }`.

---

### Auth — `/api/v1/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register` | No | Create account |
| POST | `/login` | No | Sign in, sets `token` cookie |
| POST | `/logout` | No | Clears `token` cookie → 204 |
| GET | `/me` | Yes | Returns current user |

**Request body (register):** `{ email: string, username: string (3–32 chars), password: string (≥8 chars) }`

**Request body (login):** `{ email: string, password: string }`

**Response (register 201 / login 200 / me 200):** `User` — `{ id, email, username }`

**Error codes:** `VALIDATION_ERROR` (400), `EMAIL_TAKEN` / `USERNAME_TAKEN` (409), `INVALID_CREDENTIALS` (401), `UNAUTHORIZED` (401)

---

### Teams — `/api/v1/teams` — all routes require auth

| Method | Path | Description |
|---|---|---|
| GET | `/` | List user's teams |
| POST | `/` | Create team |
| GET | `/:id` | Get full team (all 6 slots) |
| PUT | `/:id` | Update team metadata and/or slots |
| DELETE | `/:id` | Delete team → 204 |

**GET /** response: `TeamSummary[]`
```typescript
{ id, name, format, pokemon_count: number, updated_at }
```

**POST /** request body:
```typescript
{ name: string (1–64), format: 'singles' | 'doubles' }
```
Response 201: `Team` (slots array is all-null on creation)

**GET /:id** response: `Team`
```typescript
{
  id, user_id, name, format, notes: string | null,
  created_at, updated_at,
  slots: (TeamPokemon | null)[]   // always length 6; index = slot - 1
}
```

**PUT /:id** request body (all fields optional):
```typescript
{
  name?: string,
  format?: 'singles' | 'doubles',
  slots?: TeamPokemonSlot[]   // replaces ALL team_pokemon rows when provided
}
```
Response 200: `Team` (same shape as GET /:id)

**`TeamPokemonSlot` (sent by client) and `TeamPokemon` (returned by server) field list:**
```
slot (1–6), pokemon_id, nickname?, gender? ('male'|'female'|'unknown'),
ability_id, item_id?, nature_id,
move1_id?, move2_id?, move3_id?, move4_id?,
ev_hp, ev_atk, ev_def, ev_spa, ev_spd, ev_spe  (each 0–252, sum ≤ 510; default 0)
iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe  (each 0–31; default 31)
tera_type_id?
```
Server adds `id` and `team_id` to each row in the response.

**PUT behaviour:** if `slots` is provided, the full set of team_pokemon is replaced atomically (DELETE + INSERT in a transaction). Omit `slots` to update name/format only.

**Error codes:** `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `FORBIDDEN` (403 — accessing another user's team)

---

### Pokemon — `/api/v1/pokemon` — no auth required

| Method | Path | Description |
|---|---|---|
| GET | `/search?q=&limit=20` | Search by name (ILIKE, is_available only) |
| GET | `/:id` | Full pokemon detail |
| GET | `/:id/moves` | Learnset for this pokemon |
| GET | `/:id/abilities` | Abilities available to this pokemon |

**GET /search** query params: `q` (partial name, case-insensitive), `limit` (1–100, default 20)
Response: `PokemonSummary[]` — `{ id, name, form_name, type1, type2, sprite_url }`

**GET /:id** response: `PokemonDetail`
```typescript
{
  id, name, form_name, base_form_id,
  type1, type2,
  hp, atk, def, spa, spd, spe,
  weight_kg, sprite_url, sprite_shiny_url,
  is_legendary, is_mythical, generation, is_available
}
```
Returns 404 if not found or `is_available = false`.

**GET /:id/moves** response: `Move[]`
```typescript
{ id, name, type, category, power, accuracy, pp, priority, learn_method, level_learned }
```
`level_learned` is `null` for non-level-up learn methods.

**GET /:id/abilities** response: `Ability[]`
```typescript
{ id, name, effect_tag, description, slot, is_hidden }
```
`is_hidden` is `true` when `slot === 3`.

---

### Items — `/api/v1/items` — no auth required

| Method | Path | Description |
|---|---|---|
| GET | `/?category=held` | List items, optionally filtered by category |

Response: `Item[]` — `{ id, name, category, effect_tag, description }`

Common `category` values: `'held'`, `'berry'`, `'battle'`, `'mega-stone'`, `'z-crystal'`

---

### Natures — `/api/v1/natures` — no auth required

| Method | Path | Description |
|---|---|---|
| GET | `/` | All 25 natures |

Response: `Nature[]` — `{ id, name, boosted_stat, reduced_stat }`

`boosted_stat` and `reduced_stat` are `null` for neutral natures (e.g., Hardy). Values: `'atk'`, `'def'`, `'spa'`, `'spd'`, `'spe'`.

---

## WebSocket Protocol (placeholder — full spec in Step 10)

Socket.io namespace: default (`/`). Battle rooms are identified by `battleId` string.
Current events:
- `battle:join` (client→server): join a battle room by ID

Full event protocol (move/switch submission, state broadcast, turn results) defined in Step 10.

## TypeScript Config

- Target: ES2022, module: Node16
- Strict mode on — no `any` except at PokeAPI response parse boundaries
- Path: `src/` → `dist/` for compiled output
- Source maps enabled for debugging

## Testing

- Test files: `src/**/__tests__/*.test.ts` or `*.test.ts` co-located with source
- Integration tests: use `DATABASE_URL_TEST` env var pointing at a test DB
- Unit tests (battle engine): no DB needed — pure function tests
- Never mock the DB in integration tests — use the real test DB and truncate between tests

### Important: test file isolation

`vitest.config.ts` sets `fileParallelism: false`. All test files share the same test DB, so running them in parallel causes cross-file truncation races. Keep this setting when adding new test files.

### Integration test boilerplate

`src/test-setup.ts` (loaded via `vitest.config.ts` `setupFiles`) loads dotenv and
overwrites `DATABASE_URL` with `DATABASE_URL_TEST` before any test module imports run.
This means the `pool` singleton in `src/db/client.ts` automatically connects to the
test DB during all test runs — no extra wiring needed in test files.

Standard pattern for route integration tests:

```typescript
import { pool } from '../db/client.js';

beforeEach(async () => {
  await pool.query('SELECT truncate_all_tables()');
});

afterAll(async () => {
  await pool.end();
});
```

`truncate_all_tables()` clears only user/battle tables and leaves static Pokémon data
intact. It lives in migration `1731000000005_test-helpers.js`.

**First-time test DB setup:** run migrations once against the test DB:
```bash
DATABASE_URL=postgres://user@localhost:5432/pokemon_battle_test npm run migrate:up
```
