# Pokemon Battle Simulator — Project Root

## What This Is
A full-stack competitive Pokemon battle simulator with a team builder, live battles in two formats (1v1 and 2v2/Doubles), and an AI opponent trained on current competitive meta. Built for Gen 9 (Scarlet/Violet) as the baseline, designed to stay current with whatever the active competitive ruleset is (e.g., Pokemon Champions with Mega Evolutions).

## Tech Stack
| Layer | Technology |
|---|---|
| Database | PostgreSQL |
| Backend API + Battle Server | Node.js + Express + Socket.io |
| Frontend | React (Vite), Zustand, React Query, Socket.io-client |
| ML / AI Service | Python (FastAPI) |
| Data Source | PokeAPI (one-time import + periodic updates) |

## Architecture Overview

```
React Client
  │
  ├── REST (React Query) ──────► Express API ──── PostgreSQL
  │                                  │
  └── WebSocket (Socket.io) ────► Battle Server ── In-memory battle state
                                      │
                                      └── HTTP ──► Python ML Service (FastAPI)
```

- **Express API** handles auth, team CRUD, Pokemon/move/item lookups, and battle creation.
- **Battle Server** (same Node process, separate namespace) manages live battle state via WebSocket rooms. Battle state is held in memory during a fight and checkpointed to PostgreSQL each turn.
- **Python ML Service** is stateless — Node sends it the full relevant battle state snapshot, it returns an action. No shared state between services.

## Directory Structure
```
/
├── CLAUDE.md                    ← this file
├── specs/
│   ├── battle-engine.md         ← turn resolution, state machine, priority, damage calc
│   ├── damage-calc.md           ← full damage formula with every modifier
│   ├── move-effects.md          ← move effect categories and handler patterns
│   ├── ability-effects.md       ← ability trigger taxonomy and interaction rules
│   ├── data-import.md           ← PokeAPI → DB transform and seeding logic
│   └── ai-opponent.md           ← ML service contract, RL environment spec
├── database/
│   ├── CLAUDE.md
│   └── migrations/
├── backend/
│   ├── CLAUDE.md
│   └── src/
│       ├── battle-engine/
│       │   └── CLAUDE.md
│       ├── api/
│       ├── ws/
│       └── ...
├── frontend/
│   ├── CLAUDE.md
│   └── src/
└── ml/
    ├── CLAUDE.md
    └── ...
```

## Database Schema (Overview)

Full schema lives in `database/CLAUDE.md`. Key tables:

**Static data (seeded from PokeAPI):**
- `pokemon` — national dex number, name, types, base stats, sprite URLs
- `moves` — power, accuracy, PP, type, category (physical/special/status), priority, effect_id, target
- `abilities` — name, machine-readable effect flags
- `items` — name, category, held-item effect flags
- `type_chart` — 18×18 effectiveness multiplier table
- `pokemon_moves` — learnset join table (pokemon_id, move_id, learn_method)
- `pokemon_abilities` — join table (pokemon_id, ability_id, slot, is_hidden)
- `natures` — 25 natures with stat modifier pairs

**User data:**
- `users` — id, email, hashed_password, created_at
- `teams` — id, user_id, name, format (singles | doubles), created_at
- `team_pokemon` — id, team_id, slot (1–6), pokemon_id, ability_id, item_id, nature_id, move_1..4, evs (JSON), ivs (JSON), nickname

**Battle data:**
- `battles` — id, format, player1_id, player2_id, winner_id, started_at, ended_at
- `battle_turns` — id, battle_id, turn_number, state_snapshot (JSONB), actions (JSONB)

## How Services Communicate

### REST API (Express → PostgreSQL)
Standard JSON REST. Auth via JWT (httpOnly cookie). All endpoints under `/api/v1/`.

### WebSocket Protocol (Client ↔ Battle Server)
See `backend/CLAUDE.md` for event names and payloads. Key events:
- `battle:join` — player connects to battle room
- `battle:state` — server broadcasts full state to both clients
- `battle:choose_action` — client submits move or switch choice
- `battle:turn_result` — server broadcasts resolved turn with animation cues

### Node → Python ML Service
HTTP POST to `http://ml-service:8000/ai/choose-action` with battle state snapshot. Returns `{ action_type, move_index | switch_slot, target_slot? }`. Timeout: 5s with rule-based fallback.

## Ruleset / Mechanic Layer
The battle engine references a `RulesetConfig` object (not hardcoded Gen 9 assumptions):
```typescript
interface RulesetConfig {
  name: string                    // e.g. "Gen9VGC2025", "PokemonChampions"
  gimmick: 'tera' | 'mega' | 'zmove' | 'dynamax' | 'none'
  bringCount: number              // how many pokemon to bring to team preview
  activeCount: 1 | 2             // 1 for singles, 2 for doubles
  timerSeconds: number
  legalPokemon: Set<number>       // dex IDs, empty = all legal
  legalItems: Set<number>
  clauseList: string[]            // e.g. ['sleep-clause', 'species-clause']
}
```
Adding a new format = adding a new config object + a mechanic handler if the gimmick is new. The engine itself does not change.

## Global Conventions

### TypeScript (backend + frontend)
- Strict mode on. No `any` except at PokeAPI response boundaries.
- Zod for all API input validation and PokeAPI response parsing.
- Result types (`{ ok: true, data }` | `{ ok: false, error }`) for battle engine functions that can fail — no throwing inside turn resolution.

### Python (ml service)
- Type hints everywhere. Pydantic for request/response models.
- FastAPI with async handlers.

### Database
- All migrations via a migration tool (e.g., `node-pg-migrate`). Never modify schema by hand in prod.
- Snake_case column names. Timestamps always UTC.
- JSONB for flexible battle state snapshots; typed columns for anything queried/indexed.

### Error Handling
- API errors: `{ error: { code: string, message: string } }` with appropriate HTTP status.
- Battle engine: never throw — return `Result` types so turn resolution can't crash a live battle.
- WebSocket errors: emit `battle:error` event with code + message before disconnecting if fatal.

### Testing
- Battle engine (damage calc, turn resolution, individual move/ability handlers): unit tested with Vitest.
- API routes: integration tested against a real test DB (no mocks).
- Frontend: component tests for team builder; no tests required for battle UI until engine is stable.

## Key Reference Documents
Before working on a specific system, read the relevant spec:
- Battle turn resolution → `specs/battle-engine.md`
- Damage formula → `specs/damage-calc.md`
- Adding a move effect handler → `specs/move-effects.md`
- Adding an ability handler → `specs/ability-effects.md`
- PokeAPI data import → `specs/data-import.md`
- AI opponent / ML service → `specs/ai-opponent.md`

## Environment Variables
Documented in `.env.example` at each service root. Never commit `.env` files. Key vars:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — auth token signing key
- `ML_SERVICE_URL` — URL of Python FastAPI service
- `POKEAPI_BASE_URL` — default `https://pokeapi.co/api/v2` (override for local cache)
