# ML Service — CLAUDE.md

Python FastAPI service. Stateless — Node sends full battle state snapshots, service returns actions.
Pydantic v2 for request/response models. No shared state between requests.

## Running the ML Service

```bash
# Install dependencies (from ml/ directory)
pip install -e ".[dev]"

# Run dev server
uvicorn src.main:app --reload --port 8000

# Run tests
pytest
```

## Key Dependencies

| Package | Purpose |
|---|---|
| fastapi | HTTP API framework |
| uvicorn[standard] | ASGI server |
| pydantic v2 | Request/response models + validation |
| httpx | Async HTTP client (for calling PokeAPI or other services if needed) |
| python-dotenv | Loads `.env` file |
| pytest + pytest-asyncio | Tests |

## Environment Variables

```
PORT=8000
LOG_LEVEL=info
```

## Directory Structure

```
ml/
├── src/
│   ├── __init__.py
│   ├── main.py          ← FastAPI app instance, router registration
│   ├── routes.py        ← /ai/choose-action endpoint (scaffolded)
│   ├── models/          ← Pydantic request/response models
│   ├── agents/          ← AI agent implementations
│   │   ├── heuristic.py ← rule-based fallback agent (implement first)
│   │   ├── mcts.py      ← Monte Carlo Tree Search agent (Phase 2)
│   │   └── rl_agent.py  ← RL-trained agent (Phase 3)
│   └── training/        ← RL training scripts, not part of the live service
├── pyproject.toml
└── .env.example
```

## Current State (after Step 1 scaffolding)

`src/routes.py` has a working `/ai/choose-action` endpoint that accepts a `BattleStateSnapshot`
and returns an `ActionChoice`. Currently a stub that always returns `move_index=0`.

`BattleStateSnapshot.state` is typed as `dict` — will be tightened to a proper Pydantic model
once the battle engine TypeScript types are finalized in Step 7.

## API Contract with Node Backend

Node calls this service via HTTP POST. Timeout: 5 seconds. On timeout, Node falls back to
the rule-based heuristic internally (do not rely on the ML service being available).

### POST /ai/choose-action
**Request:**
```python
class BattleStateSnapshot(BaseModel):
    battle_id: str
    format: Literal["singles", "doubles"]
    turn: int
    player_slot: int   # 0 or 1 — which side the AI is playing
    state: dict        # full BattleState snapshot (see specs/battle-engine.md)
```

**Response:**
```python
class ActionChoice(BaseModel):
    action_type: Literal["move", "switch"]
    move_index: int | None = None     # 0-3 if action_type == "move"
    switch_slot: int | None = None    # 0-5 if action_type == "switch"
    target_slot: int | None = None    # 0-1 in doubles for targeted moves
```

## AI Implementation Progression

Implement in this order (each phase is a drop-in replacement for the endpoint):

### Phase 1 — Rule-based heuristic (`agents/heuristic.py`)
Simple priority-scored decision:
1. If a move is super effective and does not KO self via recoil → use it
2. If user is threatened (will be KO'd next turn) → switch to a resist
3. Otherwise → highest base power move available
No ML, no training data needed. Fast, predictable, decent for casual play.

### Phase 2 — MCTS (`agents/mcts.py`)
Monte Carlo Tree Search over simulated turns. Requires importing the battle state model
and a lightweight Python battle simulator (or calling Node's engine via HTTP, which is simpler).
Returns the action with highest average simulated outcome after N iterations (default: 1000).

### Phase 3 — RL self-play (`agents/rl_agent.py`)
Train a PPO agent via self-play using a `gym.Env` wrapper around the battle engine.
Training scripts live in `ml/training/` — not run as part of the live service.
The trained model weights are loaded at service startup and used for inference.
Framework: Stable Baselines3 (add to dependencies when implementing Phase 3).

## Meta Teams Feature

When implemented, add:
```
GET /meta/teams?format=singles|doubles
```
Returns a list of current top meta team archetypes. These are stored in a local JSON file
updated by a separate scraping/ingestion script, not generated on-the-fly.

## Conventions

- Type hints on all function signatures. No bare `dict` return types.
- Pydantic models for all request/response shapes — no raw `dict` in route handlers.
- Async handlers throughout (`async def`).
- No global mutable state — the service must be restartable without side effects.
- Log using Python's standard `logging` module, level controlled by `LOG_LEVEL` env var.
