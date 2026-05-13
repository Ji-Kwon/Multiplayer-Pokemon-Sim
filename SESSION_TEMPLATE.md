# Claude Code Session Start Template

Use this template at the start of every coding session. Fill in the bracketed fields.
Copy-paste into the Claude Code prompt at session open.

---

## Template

```
Read CLAUDE.md before doing anything else.
[Also read: <spec or CLAUDE.md files relevant to this session>]

## Session goal
<One sentence: what will be built or completed by the end of this session.>

## Entry point
<File path(s) to create or modify. If creating, specify location and what it exports.>

## Context
<2–4 sentences of relevant background. What was decided in the last session?
What interfaces does this session depend on? What should NOT be changed?>

## Done criteria
- <Bullet list of specific, verifiable outcomes>
- <e.g. "damage calc returns correct value for the Showdown test cases below">
- <e.g. "all unit tests pass">
- <e.g. "the API endpoint returns 201 with the team object">

## Do not touch
- <Files or systems out of scope for this session>
```

---

## Filled Examples

### Example: Battle Engine — Damage Calculator
```
Read CLAUDE.md and specs/damage-calc.md before doing anything else.

## Session goal
Implement the damage calculation function with all Gen 9 modifiers, fully unit tested.

## Entry point
Create backend/src/battle-engine/damage.ts — export a single function:
  calcDamage(ctx: DamageContext): number

## Context
The battle state types are defined in backend/src/battle-engine/types.ts (already exists).
The type chart is seeded into the DB but also available as a static import at
backend/src/battle-engine/data/type-chart.ts for performance.
Do not implement ability or item modifier hooks yet — leave those as no-op stubs
with a TODO comment. Those will be wired in a later session.

## Done criteria
- calcDamage passes all test cases in the table at the bottom of specs/damage-calc.md
- Edge cases covered: OHKO moves, fixed-damage moves, 0 damage (type immunity)
- Critical hit logic ignores negative Atk stages and positive Def stages
- All modifiers applied in the order specified in specs/damage-calc.md

## Do not touch
- backend/src/battle-engine/resolver.ts
- database/ directory
```

### Example: Frontend — Team Builder UI
```
Read CLAUDE.md and frontend/CLAUDE.md before doing anything else.

## Session goal
Build the team builder page: Pokemon selection, slot management, and save to API.

## Entry point
Create frontend/src/pages/TeamBuilder.tsx and any components under
frontend/src/components/team-builder/.

## Context
The backend team API is live at /api/v1/teams (GET, POST, PUT).
API types are exported from frontend/src/types/api.ts (already exists, do not modify).
React Query is set up in frontend/src/lib/query-client.ts.
We're using Tailwind for styling. No component library.

## Done criteria
- User can search Pokemon by name with sprite preview
- User can assign moves, ability, item, nature, EVs/IVs per slot
- EV total validation (max 510, max 252 per stat) shown in UI
- Save button calls PUT /api/v1/teams/:id and shows success/error state
- Team import via Showdown paste format works

## Do not touch
- backend/ directory
- frontend/src/pages/Battle.tsx
```

### Example: Battle Engine — Move Effect Handlers (Batch 1)
```
Read CLAUDE.md, specs/battle-engine.md, and specs/move-effects.md before starting.

## Session goal
Implement move effect handlers for categories: DIRECT_DAMAGE, DAMAGE_RECOIL,
DAMAGE_DRAIN, DAMAGE_STATUS_CHANCE, and DAMAGE_STAT_CHANGE_TARGET.

## Entry point
backend/src/battle-engine/effects/moves/ — one file per category.
Handler interface is defined in backend/src/battle-engine/effects/moves/types.ts.

## Context
The moveEffectRegistry is in backend/src/battle-engine/effects/moves/registry.ts.
Damage calculation is already implemented in backend/src/battle-engine/damage.ts.
Effect IDs come from the DB (move.effect_id) and are listed in specs/move-effects.md.

## Done criteria
- All 5 categories have a handler registered in the registry
- Each handler returns correct TurnLogEntry[]
- Sheer Force interaction stubbed (sheer-force flag on move suppresses secondary)
- Unit tests for each category using at least 3 real moves as examples

## Do not touch
- specs/ directory
- database/ directory
- backend/src/battle-engine/resolver.ts (integration comes later)
```

---

## Quick Reference: Which Specs to Load Per Session

| Session focus | Read these |
|---|---|
| Database schema / migrations | `database/CLAUDE.md` |
| PokeAPI data import | `specs/data-import.md` |
| Auth or team CRUD API | `backend/CLAUDE.md` |
| Damage calculation | `specs/damage-calc.md` |
| Turn resolution / battle flow | `specs/battle-engine.md` |
| Move effect handlers | `specs/move-effects.md`, `specs/battle-engine.md` |
| Ability handlers | `specs/ability-effects.md`, `specs/battle-engine.md` |
| Item handlers | `specs/battle-engine.md`, `backend/src/battle-engine/CLAUDE.md` |
| Battle WebSocket protocol | `backend/CLAUDE.md` |
| Team builder UI | `frontend/CLAUDE.md` |
| Battle UI | `frontend/CLAUDE.md`, `specs/battle-engine.md` |
| ML service | `ml/CLAUDE.md`, `specs/ai-opponent.md` |

---

## Session Hygiene Rules

1. **Always specify entry point files** — "implement the damage calc" is ambiguous; "create `backend/src/battle-engine/damage.ts` exporting `calcDamage`" is not.
2. **Always list what NOT to touch** — prevents Claude from helpfully refactoring adjacent files.
3. **Use `/compact`** mid-session before starting a new sub-task if the session is running long.
4. **End long sessions with:** `Update backend/src/battle-engine/CLAUDE.md with any interfaces or conventions established this session.`
5. **For parallel sessions:** ensure both sessions are in different git worktrees on different branches. Never run two sessions in the same worktree simultaneously.
6. **Testing:** always include test requirements in done criteria, not as an afterthought.
