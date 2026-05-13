# Battle Engine Spec

This document defines the complete battle engine: state machine, state object shape, turn resolution order, and all systems the engine must implement. Read this before working in `backend/src/battle-engine/`.

The engine runs server-side only. Clients send intent; the server resolves all outcomes authoritatively.

---

## State Machine

```
WAITING_FOR_PLAYERS
      │
      ▼
TEAM_PREVIEW          ← both players see each other's teams (timer)
      │
      ▼
LEADING               ← players choose their lead pokemon (doubles: choose 2)
      │
      ▼
AWAITING_INPUT  ◄─────────────────────────────────────────┐
      │                                                    │
      ▼                                                    │
RESOLVING_TURN        ← collect both choices, resolve     │
      │                                                    │
      ├── if faint(s) → AWAITING_REPLACEMENT ─────────────┘
      │
      ├── if win condition met → BATTLE_END
      │
      └── else ──────────────────────────────────────────►┘
```

**State transitions are server-driven.** After resolving a turn, the server determines the next state and emits `battle:state` to both clients with the new state and a list of animation cues.

---

## Battle State Object

This is the canonical shape of the in-memory battle state. It is serialized to JSONB on each turn checkpoint.

```typescript
interface BattleState {
  battleId: string
  format: 'singles' | 'doubles'
  ruleset: RulesetConfig
  turn: number
  phase: BattlePhase

  sides: [SideState, SideState]   // index 0 = player1, index 1 = player2

  field: FieldState

  pendingActions: Map<PlayerId, Action | null>  // null = not yet submitted
  turnLog: TurnLogEntry[]         // ordered list of events this turn (for animation + replay)
}

interface SideState {
  playerId: string
  party: PartyPokemon[]           // full team of 6
  active: ActiveSlot[]            // length 1 (singles) or 2 (doubles)
  conditions: SideCondition[]     // reflect, light screen, aurora veil, spikes, etc.
  tailwindTurns: number
  trickRoomContributor: boolean   // did this side set trick room
}

interface PartyPokemon {
  slot: number                    // 0–5
  speciesId: number
  nickname: string
  currentHp: number
  maxHp: number
  status: PrimaryStatus | null    // burn, paralysis, sleep, freeze, poison, toxic
  toxicCounter: number            // increments each turn for toxic damage
  sleepCounter: number
  fainted: boolean
  stats: ComputedStats            // final stats after nature/EV/IV — computed once at battle start
  moves: BattleMove[]             // PP tracking
  ability: AbilityId
  item: ItemId | null
  teraType: PokemonType | null    // Gen 9: assigned tera type
  isTera: boolean                 // has terastallized this battle
  hasMega: boolean                // for rulesets with mega evolution
  isMega: boolean
}

interface ActiveSlot {
  partyIndex: number              // which party slot is in this active slot
  statStages: StatStages          // { atk, def, spa, spd, spe, acc, eva } each -6 to +6
  volatileStatuses: Set<VolatileStatus>
  volatileData: Map<string, unknown>  // keyed storage for volatile state (e.g. { 'substitute_hp': 45 })
  lastMoveUsed: MoveId | null
  lastMoveFailed: boolean
  mustRecharge: boolean           // after hyper beam etc.
  lockedMove: MoveId | null       // outrage, petal dance, thrash
  lockedMoveCounter: number
  choiceLockedMove: MoveId | null // choice band/specs/scarf lock
  encoreMoveId: MoveId | null
  encoreTurns: number
  attractedBy: number | null      // active slot index of infatuator
  protectState: ProtectState | null
}

interface FieldState {
  weather: Weather | null
  weatherTurns: number            // -1 = indefinite (from ability)
  terrain: Terrain | null
  terrainTurns: number
  trickRoom: boolean
  trickRoomTurns: number
  gravity: boolean
  gravityTurns: number
}

type PrimaryStatus = 'burn' | 'paralysis' | 'sleep' | 'freeze' | 'poison' | 'toxic'
type VolatileStatus = 'confusion' | 'flinch' | 'infatuation' | 'leech-seed' | 'substitute' |
                      'taunt' | 'encore' | 'torment' | 'disable' | 'heal-block' |
                      'aqua-ring' | 'magnet-rise' | 'embargo' | 'ingrain' | 'power-trick' |
                      'curse' | 'nightmare' | 'perish-song' | 'trapped'
type Weather = 'sun' | 'rain' | 'sand' | 'snow' | 'harsh-sun' | 'heavy-rain' | 'strong-winds'
type Terrain = 'electric' | 'grassy' | 'psychic' | 'misty'
```

---

## Action Types

```typescript
type Action =
  | { type: 'move'; moveIndex: 0 | 1 | 2 | 3; targetSlot?: number; isTera?: boolean; isMega?: boolean; isZMove?: boolean }
  | { type: 'switch'; partyIndex: number; activeSlot?: number }  // activeSlot only for doubles
  | { type: 'forfeit' }
```

Both players must submit an action before resolution begins. In doubles, each player submits two actions (one per active slot), ordered.

---

## Turn Resolution Order

This is the exact sequence the resolver follows every turn. Do not deviate from this order.

### Step 0 — Validate and lock actions
- Reject illegal actions (switching a trapped pokemon, using a move with 0 PP, using a disabled move, choice-locked to a different move, etc.)
- If a player's action is invalid, replace with Struggle (for moves) or forfeit if no valid action exists.

### Step 1 — Resolve pre-turn switches
Switches are resolved before moves, in speed order (faster pokemon's trainer switches first).
- Pivot moves (U-turn, Volt Switch, Flip Turn, Teleport) are NOT resolved here — they trigger after the move lands.
- Baton Pass is resolved here as a special switch.
- Entry hazards apply when pokemon enters (Stealth Rock damage, Spikes, etc.).
- Switch-in abilities trigger (Intimidate, Download, Drizzle, etc.).

### Step 2 — Build the action queue
Collect all remaining move actions and sort by **effective priority** then **effective speed**.

**Priority bracket** (higher = moves first):
```
+6  Helping Hand
+5  (unused in Gen 9)
+4  Protect, Detect, King's Shield, Baneful Bunker, Spiky Shield, Silk Trap, Burning Bulwark
+4  Endure, Max Guard
+3  Fake Out, Spotlight, Wide Guard, Quick Guard
+2  Extreme Speed, Feint, First Impression
+1  Aqua Jet, Baby-Doll Eyes, Bullet Punch, Ice Shard, Mach Punch, Quick Attack,
    Shadow Sneak, Sucker Punch (conditional), Vacuum Wave, Water Shuriken
 0  (most moves)
-1  Vital Throw
-3  Focus Punch, Beak Blast, Shell Trap
-5  Counter, Mirror Coat, Metal Burst
-6  (unused in Gen 9)
-7  Trick Room (sets/unsets)
```

Within the same priority bracket, speed order applies:
- Higher effective speed goes first.
- Trick Room inverts speed order (lower speed goes first).
- Speed tie: random 50/50.
- Paralysis: 25% chance to be fully paralyzed (skip action entirely).

**Effective speed** = base speed stat × stage multiplier × item multiplier × ability multiplier × condition multiplier
- Paralysis: ×0.5
- Tailwind: ×2
- Trick Room: invert order (do not multiply)
- Speed-boosting items: Choice Scarf ×1.5, Iron Ball ×0.5, etc.
- Speed-boosting abilities: Swift Swim (rain) ×2, Chlorophyll (sun) ×2, Sand Rush (sand) ×2, Slush Rush (snow) ×2, Surge Surfer (electric terrain) ×2, Quick Feet (status) ×1.5, Unburden (item consumed) ×2

### Step 3 — Execute each action in queue order

For each action, before executing, check:
1. Is the acting pokemon still alive? If not, skip.
2. Is the acting pokemon fully paralyzed this turn? If yes, skip.
3. Is the acting pokemon frozen? 20% chance to thaw, then skip if still frozen.
4. Is the acting pokemon asleep? Decrement counter. If counter > 0, skip (unless Sleep Talk / Snore).
5. Is the acting pokemon confused? 33% chance to hurt itself (typeless, 40 power, hits self using Atk/Def). If self-hurt, skip the move.
6. Is the acting pokemon infatuated? 50% chance to skip if target is still on the field.

Then execute the move:

```
a. Ability pre-move checks (Truant skip, Gorilla Tactics lock, etc.)
b. Check if target is valid (may have switched out in doubles)
c. Check if move is blocked (Taunt blocks status moves, Heal Block blocks recovery, Gravity blocks airborne moves)
d. Check if move will miss:
   - If move has accuracy = ∞ (never misses), skip accuracy check
   - Accuracy = move_accuracy × stage_multiplier(user_acc - target_eva) × ability_mods × item_mods
   - Roll 0–100. If roll > accuracy, move misses. Apply miss effects (High Jump Kick crash, etc.)
e. Check Protect variants — if target is protected, apply protect break logic
f. Calculate damage (if damaging move) — see specs/damage-calc.md
g. Apply damage to target — trigger Focus Sash, Sturdy, etc.
h. Apply move secondary effects (see specs/move-effects.md):
   - Stat changes to target or user
   - Status conditions
   - Flinch chance
   - Recoil damage
   - HP drain
   - Field effects (weather, terrain, trick room)
   - Entry hazards
i. Ability post-move triggers on attacker (Moxie, Beast Boost, Anger Point, etc.)
j. Ability post-move triggers on defender (Weak Armor, Stamina, Justified, etc.)
k. Item triggers on attacker (Life Orb recoil, etc.)
l. Item triggers on defender (Rocky Helmet, Rough Skin via contact check, etc.)
m. Pivot move triggers: if U-turn/Volt Switch/Flip Turn landed, resolve the switch now
n. Check for faints
```

### Step 4 — End of turn effects
Applied in this order (each can cause faints, check after each):
1. Weather damage (Sand: non-Rock/Ground/Steel take 1/16 max HP; Snow: no damage in Gen 9)
2. Abilities that activate at end of turn (Dry Skin, Hydration, Healer, Ice Body, Rain Dish, Speed Boost, Moody, Harvest, Power Construct)
3. Held item effects (Leftovers +1/16, Black Sludge +1/16 for Poison/−1/8 for others, Poison Orb, Flame Orb)
4. Burn damage (1/16 max HP)
5. Poison damage (1/8 max HP)
6. Toxic damage (N/16 max HP, N = toxic counter)
7. Leech Seed drain (1/8 max HP to holder of seed)
8. Aqua Ring (+1/16 HP)
9. Ingrain (+1/16 HP)
10. Curse damage (if cursed, −1/4 max HP)
11. Nightmare damage (if asleep and nightmared, −1/4 max HP)
12. Perish Song counter — faint at 0
13. Wish healing
14. Future Sight / Doom Desire landing
15. Terrain + weather duration decrement
16. Trick Room, Tailwind, Gravity, screen duration decrement

### Step 5 — Faint replacement
- If any pokemon fainted, transition to `AWAITING_REPLACEMENT`.
- Players with fainted active pokemon must choose a replacement before the next turn begins.
- In doubles, if both active pokemon of a player faint simultaneously, they choose replacements for both slots.
- Replacement switches do NOT re-trigger entry hazards check — wait, actually they do. Entry hazards trigger on all switches including faint replacements.
- After all replacements are in, return to `AWAITING_INPUT`.

### Step 6 — Win condition check
A player loses when all 6 of their pokemon have fainted. Check after every faint event.
If both sides' last pokemon faint simultaneously (e.g., both use explosion), it is a draw.

---

## Damage Calculation

See `specs/damage-calc.md` for the complete formula with every modifier. Summary:

```
Damage = floor(floor(floor(2×Level/5 + 2) × Power × Atk/Def / 50 + 2)
              × Targets × Weather × Critical × Random × STAB × Type1 × Type2 × Burn × Other)
```

Key points:
- `Random` = uniform random integer 85–100, divided by 100. Roll once per hit.
- `STAB` = 1.5 normally, 2.0 if attacker has Adaptability.
- `Type1 × Type2` = combined type effectiveness from type chart (can be 0, 0.25, 0.5, 1, 2, or 4).
- `Critical` = 1.5 (Gen 6+). Ignores negative stat stages on attacker and positive stat stages on defender.
- All multipliers are applied as fractions using floor division at each step in the exact order specified in `specs/damage-calc.md` — order matters.

---

## Systems Overview

### Weather
| Weather | Setter Moves | Setter Abilities | Effect |
|---|---|---|---|
| Sun | Sunny Day | Drought, Orichalcum Pulse | Fire ×1.5, Water ×0.5, Solar Beam/Blade 1-turn, Growth +2 |
| Rain | Rain Dance | Drizzle, Cloud Nine suppress | Water ×1.5, Fire ×0.5, Thunder 100% acc, Hurricane 100% acc |
| Sand | Sandstorm | Sand Stream, Sand Spit | non-Rock/Ground/Steel take 1/16/turn; SpDef +50% for Rock types |
| Snow | Snowscape | Snow Warning | Defense +50% for Ice types; Blizzard 100% acc |
| Harsh Sun | (Primal Groudon) | Desolate Land | Fire ×1.5, Water = 0, cannot change weather |
| Heavy Rain | (Primal Kyogre) | Primordial Sea | Water ×1.5, Fire = 0, cannot change weather |
| Strong Winds | (Mega Rayquaza) | Delta Stream | Flying's weaknesses become neutral |

Normal weather lasts 5 turns (8 with weather rock items). Primal/extreme weather lasts until the setter leaves the field.

### Terrain
| Terrain | Setter | Effect |
|---|---|---|
| Electric | Electric Terrain, Pincurchin | Grounded: Electric ×1.3, immune to sleep |
| Grassy | Grassy Terrain | Grounded: Grass ×1.3, +1/16 HP/turn, Earthquake/Bulldoze/Magnitude ×0.5 |
| Psychic | Psychic Terrain | Grounded: Psychic ×1.3, immune to priority moves from opponents |
| Misty | Misty Terrain | Grounded: immune to status + confusion, Dragon ×0.5 |

"Grounded" = not Flying type and not holding Air Balloon and not under Magnet Rise and not under Levitate and Gravity is not active (Gravity overrides). Terrain lasts 5 turns (8 with Terrain Extender).

### Entry Hazards
| Hazard | Damage on Switch-In | Conditions |
|---|---|---|
| Stealth Rock | 1/8 HP × type effectiveness vs Rock | Always triggers |
| Spikes (1 layer) | 1/8 HP | Not Flying/Levitate/Air Balloon |
| Spikes (2 layers) | 1/6 HP | Same |
| Spikes (3 layers) | 1/4 HP | Same |
| Toxic Spikes (1) | Poison status | Not Flying/Poison/Steel; Poison type absorbs them |
| Toxic Spikes (2) | Toxic status | Same |
| Sticky Web | −1 Speed stage | Not Flying/Levitate/Air Balloon |

Hazards are removed by: Rapid Spin (user's side), Defog (both sides), Court Change (swaps sides).

### Side Conditions (Screens)
- **Reflect**: Physical damage ×0.5 (×0.66 in doubles). Lasts 5 turns (8 with Light Clay).
- **Light Screen**: Special damage ×0.5 (×0.66 in doubles). Same duration.
- **Aurora Veil**: Both physical and special ×0.5 (×0.66 in doubles). Requires snow. Same duration.
- Screens are bypassed by: critical hits, Infiltrator ability, Brick Break / Psychic Fangs / Defog (removes them).

### Status Conditions
| Status | Effect | Cure |
|---|---|---|
| Burn | Atk ×0.5; −1/16 HP/turn | Fire type immune; Heal Bell, Aromatherapy, Lum Berry |
| Paralysis | Speed ×0.5; 25% chance to be fully paralyzed | Electric type immune (Gen 6+); same cures |
| Sleep | Cannot act (Sleep Talk/Snore exception); 1–3 turns | Same cures; Early Bird halves duration |
| Freeze | Cannot act; 20% thaw chance per turn; Fire moves always thaw | Ice type immune; same cures |
| Poison | −1/8 HP/turn | Poison/Steel immune; same cures |
| Toxic | −N/16 HP/turn, N increments each turn | Poison/Steel immune; same cures; N resets on switch |

Only one primary status at a time. Electric Terrain prevents sleep for grounded Pokemon.

---

## 1v1 vs 2v2 Differences

### Doubles-only mechanics
- **Spread moves**: Target `all-adjacent` or `all-opponents`. Damage reduced to ×0.75.
- **Ally targeting**: Some moves can target your own partner (e.g., Helping Hand, Aromatic Mist, Heal Pulse). Attack moves that can hit any adjacent target can also target the ally.
- **Redirection**: Follow Me, Rage Powder, and Storm Drain redirect single-target moves to the user.
- **Helping Hand**: Boosts partner's move damage ×1.5 that turn.
- **Wide Guard**: Protects both ally pokemon from spread moves that turn.
- **Quick Guard**: Protects both ally pokemon from priority moves that turn.
- **Intimidate**: Lowers both opposing pokemon's Attack when switching in.
- **Earthquake, Surf, Discharge**: Hit all adjacent pokemon including ally (×0.75 damage to all).

### Team Preview & Lead Selection
- **Singles**: Bring 6, no preview required (can add preview as optional feature), send 1.
- **Doubles (VGC-style)**: Both players see each other's full 6 during team preview. Each player then selects which 4 (or 6 — confirm with ruleset config) to bring, then selects which 2 to lead with.

---

## How to Add a New Move Handler

Moves are organized into **effect categories** (not individual moves). Each category has one handler function. A move references its category via `effect_id`.

1. Find or create the effect category in `backend/src/battle-engine/effects/moves/`.
2. The handler signature is:
```typescript
type MoveEffectHandler = (ctx: MoveContext) => TurnLogEntry[]
```
3. `MoveContext` contains: attacker, defender(s), the move used, current battle state, and a mutable state draft.
4. Return an array of log entries describing what happened.
5. Register the handler in `moveEffectRegistry`.
6. Unit test it in isolation — see `backend/src/battle-engine/effects/moves/__tests__/`.

See `specs/move-effects.md` for the full category taxonomy.

## How to Add a New Ability Handler

Abilities trigger at specific **hook points** during turn resolution. Each ability registers handlers at one or more hook points.

Hook points:
```
ON_SWITCH_IN, ON_SWITCH_OUT, ON_TURN_START,
PRE_MOVE (attacker), PRE_MOVE_HIT (defender — can redirect, block),
ON_DAMAGE_CALC (attacker and defender both), ON_HIT (attacker), ON_HIT (defender),
POST_MOVE, END_OF_TURN, ON_WEATHER, ON_STAT_CHANGE
```

1. Create handler in `backend/src/battle-engine/effects/abilities/`.
2. Handler signature:
```typescript
type AbilityHook<T extends HookPoint> = (ctx: AbilityContext<T>) => TurnLogEntry[]
```
3. Register in `abilityRegistry` with the ability ID and hook point(s).
4. Unit test edge cases — ability interactions are the most common source of bugs.

See `specs/ability-effects.md` for trigger taxonomy and priority ordering between abilities.

---

## Gimmick Handlers

### Terastallization (Gen 9)
- Each pokemon has a `teraType` assigned at team-building time.
- A player may Terastallize one pokemon per battle during the move selection phase.
- On Tera: the pokemon's type changes to `teraType`. If `teraType` matches an original type, STAB = 2.0; otherwise original STAB is lost, new STAB = 1.5.
- Stellar Tera type: STAB boost for all types that turn, then regular for subsequent turns.
- Track with `isTera: boolean` on `PartyPokemon`. Once used, `teraType` is locked — cannot un-Tera.

### Mega Evolution (for Pokemon Champions / future rulesets)
- Triggered via `action.isMega = true` during move action.
- Mega Evolution happens before the move, in speed order with other Mega Evolutions (if doubles).
- Changes: species form, ability, base stats (recompute `ComputedStats`). Type may change.
- One Mega per player per battle. Track with `hasMega` (has the item) and `isMega` (has used it).
- Mega Stone is consumed (item slot = null) after Mega Evolution.
- Implement via `rulesetConfig.gimmick === 'mega'` guard — engine skips Mega logic for non-mega rulesets.

---

## Battle Log / Replay Format

Every state change produces a `TurnLogEntry`:
```typescript
interface TurnLogEntry {
  type: LogEntryType      // 'damage', 'heal', 'status', 'stat_change', 'faint', 'move_use', etc.
  sourceSlot?: number
  targetSlot?: number
  payload: Record<string, unknown>  // e.g. { amount: 45, percentHp: 0.28 }
  message: string         // human-readable, e.g. "Gholdengo used Make It Rain!"
}
```

The full `turnLog` array for each turn is stored in `battle_turns.actions` (JSONB). Replays reconstruct battle state by replaying these logs against the initial state.
