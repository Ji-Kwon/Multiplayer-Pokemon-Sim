# Ability Effects Spec

Abilities register handlers at specific **hook points** in the turn resolution pipeline.
Each ability can register at one or more hooks. If no handler is registered for an ability,
it silently does nothing (most abilities have no battle-relevant effect or aren't implemented yet).

Before working in `backend/src/battle-engine/effects/abilities/`, read `specs/battle-engine.md`.

---

## Handler Interface

```typescript
// backend/src/battle-engine/effects/abilities/types.ts

// Context available at every hook point
interface AbilityBaseContext {
  state: Draft<BattleState>
  holderSide: 0 | 1
  holderSlot: number
  holder: ActiveSlot & { party: PartyPokemon }
  rng: () => number
}

// Each hook point extends the base with relevant data
type AbilityContext<T extends HookPoint> =
  T extends 'ON_SWITCH_IN'         ? AbilityBaseContext & { previousOccupant: PartyPokemon | null }
  T extends 'ON_SWITCH_OUT'        ? AbilityBaseContext & {}
  T extends 'PRE_MOVE_USER'        ? AbilityBaseContext & { move: Move; targets: TargetInfo[] }
  T extends 'PRE_MOVE_TARGET'      ? AbilityBaseContext & { move: Move; attacker: ActiveSlot & { party: PartyPokemon }; attackerSide: 0 | 1 }
  T extends 'ON_ACCURACY'          ? AbilityBaseContext & { move: Move; rawAccuracy: number } & { modifiedAccuracy: number }
  T extends 'ON_DAMAGE_CALC'       ? AbilityBaseContext & DamageCalcContext
  T extends 'AFTER_TAKING_DAMAGE'  ? AbilityBaseContext & { damageDealt: number; move: Move; attackerSide: 0 | 1 }
  T extends 'AFTER_DEALING_DAMAGE' ? AbilityBaseContext & { damageDealt: number; move: Move; targetSide: 0 | 1; targetSlot: number }
  T extends 'ON_STAT_STAGE_CHANGE' ? AbilityBaseContext & { stat: Stat; stages: number; sourceIsOpponent: boolean }
  T extends 'ON_STATUS_INFLICT'    ? AbilityBaseContext & { status: PrimaryStatus; sourceIsOpponent: boolean }
  T extends 'END_OF_TURN'          ? AbilityBaseContext & {}
  T extends 'ON_WEATHER'           ? AbilityBaseContext & { weather: Weather }
  T extends 'ON_FAINT'             ? AbilityBaseContext & { cause: 'move' | 'hazard' | 'weather' | 'status' | 'recoil' }
  : never

interface DamageCalcContext {
  move: Move
  isAttacker: boolean              // true when holder is the attacker; false when defender
  attackStat: number               // EffectiveAtk before ability mods
  defenseStat: number              // EffectiveDef before ability mods
  power: number                    // Effective power before ability mods
  // Handlers return multipliers; resolver applies them
  attackMultiplier: number         // modify this
  defenseMultiplier: number        // modify this
  powerMultiplier: number          // modify this
  finalMultiplier: number          // modify this (goes into FinalModifier)
}

type AbilityHookHandler<T extends HookPoint> = (ctx: AbilityContext<T>) => TurnLogEntry[]

// Registry
const abilityRegistry = new Map<string, Partial<Record<HookPoint, AbilityHookHandler<any>>>>()
```

Registration example:
```typescript
abilityRegistry.set('intimidate', {
  ON_SWITCH_IN: (ctx) => {
    // lower both opponents' Atk by 1
  }
})
```

---

## Hook Point Reference

| Hook | When it fires |
|---|---|
| `ON_SWITCH_IN` | After pokemon enters field (post-hazard damage) |
| `ON_SWITCH_OUT` | Before pokemon leaves field |
| `PRE_MOVE_USER` | Before holder uses a move (can prevent the move) |
| `PRE_MOVE_TARGET` | Before holder is targeted by a move (can redirect or absorb) |
| `ON_ACCURACY` | During accuracy check; return modified accuracy |
| `ON_DAMAGE_CALC` | During damage calculation; return stat/power/final multipliers |
| `AFTER_TAKING_DAMAGE` | After holder takes damage from a move |
| `AFTER_DEALING_DAMAGE` | After holder deals damage to a target |
| `ON_STAT_STAGE_CHANGE` | When holder's stat would change; can block or modify |
| `ON_STATUS_INFLICT` | When status would be inflicted on holder; can block |
| `END_OF_TURN` | After all moves resolve, before faints are checked |
| `ON_WEATHER` | When weather applies its effects to holder |
| `ON_FAINT` | When holder faints |

---

## Ability Catalog

Organized by hook point. An ability appears under every hook it registers.

---

### `ON_SWITCH_IN`

#### Intimidate
Lower both opponents' Attack by 1 stage.
Blocked by: Inner Focus, Own Tempo, Oblivious, Scrappy, Rattled (Rattled gets +1 Spe instead).
In doubles: hits both active opponents.
Log: "Intimidate activated! [opponent] lost 1 Attack!"

#### Download
Raise SpA or Atk by 1 depending on opponent's lower defensive stat.
If all opponents' avg Def < avg SpD → +1 Atk; else → +1 SpA.

#### Weather-setting abilities (Drought, Drizzle, Sand Stream, Snow Warning, Desolate Land, Primordial Sea, Delta Stream)
Set weather on switch-in. Lasts indefinitely while holder is active (weather turns = -1).
When holder switches out, revert weather to none (unless another weather-setter is active).

#### Terrain-setting abilities (Electric Surge, Grassy Surge, Psychic Surge, Misty Surge)
Set terrain on switch-in. Lasts indefinitely while holder is active.

#### Trace
Copy the target's ability (random opponent if doubles). Log which ability was copied.
Cannot copy: Trace, Forecast, Flower Gift, Illusion, Imposter, Multitype, Power Construct, Schooling,
Commander, Comatose, Disguise, RKS System, Shields Down, Stance Change, Wonder Guard, Zen Mode.

#### Intimidate (doubles) — handled by standard Intimidate; fires for each opponent.

#### Frisk
Reveal both opponents' held items. Log them.

#### Pressure
Opponent's moves that target holder cost 1 extra PP. Track via `pressureActive` on side state.

#### Mold Breaker / Turboblaze / Teravolt
Suppress target's ability during this holder's moves. Set flag on attacker context before move resolution.

#### Screen Cleaner
Remove Reflect, Light Screen, and Aurora Veil from both sides on switch-in.

#### Orichalcum Pulse
Set harsh sunlight on switch-in (same as Drought but named differently — same mechanic).

#### Hadron Engine
Set electric terrain on switch-in (same as Electric Surge).

---

### `ON_SWITCH_OUT`

#### Natural Cure
Cure holder's primary status when it switches out.

#### Regenerator
Restore 1/3 of max HP when holder switches out.

#### Shed Skin
30% chance to cure status at end of turn — NOT on switch-out. (Listed here for disambiguation — it's actually `END_OF_TURN`.)

---

### `PRE_MOVE_USER` (can prevent or modify the move)

#### Truant
Holder can only move every other turn. Track `volatileData.truantShouldSkip`. Toggle each turn.
If skip turn: emit "loafing around" log, cancel move.

#### Slow Start
First 5 turns: Atk and Spe halved. Track `volatileData.slowStartTurns`. This is implemented
in `ON_DAMAGE_CALC` and speed calculation, not strictly PRE_MOVE_USER, but the 5-turn tracking
should fire here.

#### Stall
Holder always moves last within its priority bracket. Modify speed for ordering purposes.

#### Gorilla Tactics
Lock holder into first move used (like Choice Band). Set `choiceLockedMove` on first use.
Also grants ×1.5 Atk (handled in `ON_DAMAGE_CALC`).

---

### `PRE_MOVE_TARGET` (can redirect, absorb, or block incoming moves)

#### Volt Absorb / Lightning Rod (Electric moves)
Volt Absorb: absorb Electric moves, restore 1/4 max HP. Return damage = 0.
Lightning Rod: absorb Electric moves, +1 SpA. In doubles: redirect single-target Electric moves to self.

#### Water Absorb / Storm Drain (Water moves)
Water Absorb: absorb Water moves, restore 1/4 max HP.
Storm Drain: absorb Water moves, +1 SpA. In doubles: redirect single-target Water moves.

#### Flash Fire (Fire moves)
Absorb Fire moves, power up holder's Fire moves (×1.5) next time. No damage taken.
Track `volatileData.flashFireActive`.

#### Motor Drive (Electric moves)
Absorb Electric moves, +1 Spe.

#### Sap Sipper (Grass moves)
Absorb Grass moves, +1 Atk.

#### Soundproof
Immune to sound-based moves (`move.is_sound = true`). Move fails.

#### Bulletproof
Immune to ball/bomb moves (`move.is_bomb = true`). Move fails.

#### Wonder Guard
Only super effective moves deal damage. All other damaging moves (including neutral and not-very-effective) fail.
Weather damage, status damage, hazard damage still apply.

#### Levitate
Immune to Ground-type moves. Bypassed by: Gravity, Ingrain on holder, Smack Down, Thousand Arrows.

#### Telepathy (doubles)
Immune to ally's spread moves hitting the holder.

#### Queenly Majesty / Dazzling / Armor Tail
Blocks priority moves targeting this side (priority > 0 moves from opponents fail).

---

### `ON_ACCURACY`

#### No Guard
Both holder's moves and moves targeting holder never miss. Return accuracy = ∞.

#### Sand Veil
In sandstorm: holder's evasion +20% (multiply accuracy of incoming moves by 0.8).

#### Snow Cloak
In snow: holder's evasion +20%.

#### Tangled Feet
If confused: evasion +20%.

#### Wonder Skin
Status moves targeting holder have their accuracy halved.

#### Hustle
Physical moves used by holder: Atk ×1.5 but accuracy ×0.8.
Implement Atk boost in `ON_DAMAGE_CALC`, accuracy penalty here.

---

### `ON_DAMAGE_CALC`

Called during damage formula; handler modifies multipliers on the `DamageCalcContext`.

#### When `isAttacker = true` (boosting offense):

**Huge Power / Pure Power**
Attack stat × 2. `ctx.attackMultiplier *= 2`.

**Guts**
If holder has a primary status: Atk ×1.5. Also negates burn's Atk reduction.
`ctx.attackMultiplier *= 1.5` (only for physical moves; burn Atk reduction also negated).

**Hustle** (physical only)
`ctx.attackMultiplier *= 1.5` (accuracy penalty handled in ON_ACCURACY).

**Marvel Scale** (defensive — when `isAttacker = false`)
If holder has a primary status: Def ×1.5.

**Fur Coat** (defensive)
Physical damage taken ×0.5. `ctx.defenseMultiplier *= 2` (doubling def halves physical damage).

**Technician**
If move power ≤ 60 (after dynamic power calculation): `ctx.powerMultiplier *= 1.5`.

**Tough Claws**
Contact moves: `ctx.finalMultiplier *= 1.3`.

**Iron Fist**
Punch moves (`move.is_punch`): `ctx.finalMultiplier *= 1.2`.

**Reckless**
Recoil moves (`move.has_recoil`): `ctx.finalMultiplier *= 1.2`.

**Strong Jaw**
Bite moves (`move.is_bite`): `ctx.finalMultiplier *= 1.5`.

**Mega Launcher**
Pulse moves (`move.is_pulse`): `ctx.finalMultiplier *= 1.5`.

**Sheer Force**
Moves with secondary effects: `ctx.powerMultiplier *= 1.3`. Also suppresses secondary effects.
Track via `attackerHasSheerForce` flag in MoveContext.

**Adaptability**
STAB = 2.0 instead of 1.5. Handled inside damage calc directly, not as a multiplier here.

**Aerilate / Pixilate / Refrigerate / Galvanize / Normalize**
Change Normal-type moves to another type; those moves get ×1.2 power boost.
`ctx.powerMultiplier *= 1.2` and modify move type before damage calc.

**Overgrow / Blaze / Torrent / Swarm**
Matching type moves ×1.5 when HP ≤ 1/3. `ctx.finalMultiplier *= 1.5`.

**Solar Power** (in sun)
SpA ×1.5 in sun, lose 1/8 max HP at end of turn (END_OF_TURN).

**Plus / Minus** (with ally)
SpA ×1.5 if ally has the other (Plus/Minus). Doubles only.

**Protosynthesis** (sun or Booster Energy)
Identify holder's highest stat (HP excluded); boost that stat by ×1.3 (Spe) or ×1.5 (other).
Track `volatileData.protoSynthesisStat`. Activate on switch-in if sun active or Booster Energy held.

**Quark Drive** (electric terrain or Booster Energy)
Same mechanic as Protosynthesis. Activate on switch-in.

**Orichalcum Pulse** (atk boost)
In harsh sun: Atk ×1.3333 (×4/3). Already sets sun on switch-in.

**Hadron Engine** (spa boost)
In electric terrain: SpA ×1.3333 (×4/3). Already sets terrain on switch-in.

**Gorilla Tactics**
Atk ×1.5. (See also PRE_MOVE_USER for choice lock.)

**Sand Force**
In sand: Rock/Ground/Steel moves ×1.3. `ctx.finalMultiplier *= 1.3`.

**Analytic**
If holder moves last: ×1.3. `ctx.finalMultiplier *= 1.3`. Check via speed order in ctx.

#### When `isAttacker = false` (defensive):

**Multiscale / Shadow Shield**
At full HP: damage taken ×0.5. `ctx.finalMultiplier *= 0.5` (from defender's perspective, actually modify attackFinalMult).

**Filter / Solid Rock / Prism Armor**
Super effective moves: damage taken ×0.75.

**Thick Fat**
Fire and Ice moves: damage taken ×0.5.

**Fluffy**
Contact moves: damage taken ×0.5. Fire moves: damage taken ×2 (stacks — Fire + contact = ×1).

**Heatproof**
Fire moves: damage taken ×0.5. Also: burn damage halved (END_OF_TURN).

**Water Bubble**
Water moves used: power ×2. Fire moves taken: damage ×0.5. Cannot be burned.

**Ice Scales**
Special moves: damage taken ×0.5.

**Punk Rock**
Sound moves used: power ×1.3. Sound moves taken: damage ×0.5.

---

### `AFTER_TAKING_DAMAGE`

#### Weak Armor (on physical hit)
−1 Def, +2 Spe.

#### Stamina (on any hit)
+1 Def.

#### Justified (on Dark move hit)
+1 Atk.

#### Rattled (on Bug/Ghost/Dark move hit)
+1 Spe.

#### Water Compaction (on Water move hit)
+2 Def.

#### Steam Engine (on Fire or Water move hit)
+6 Spe.

#### Anger Point (on critical hit)
Raise Atk to +6.

#### Berserk (on HP dropping to ≤ 50%)
+1 SpA (triggers once when threshold crossed, not every hit below 50%).

#### Cursed Body (on contact hit)
30% chance to Disable the attacker's last-used move.

#### Aftermath (on contact hit when holder faints)
Deal 1/4 max HP damage to attacker. Register on `ON_FAINT` instead — see below.

#### Color Change
Holder's type becomes the type of the move that hit it.

#### Pickpocket (on contact hit if holder has no item)
Steal the attacker's item.

#### Wandering Spirit (on contact hit)
Swap abilities with the attacker (if attacker's ability is swappable).

---

### `AFTER_DEALING_DAMAGE`

#### Moxie / Grim Neigh
If target fainted: +1 Atk / +1 SpA.

#### Chilling Neigh
If target fainted: +1 Atk.

#### Beast Boost
If target fainted: +1 to holder's highest stat.

#### Magician
Steal target's held item (if any) on hit.

#### Gooey / Tangling Hair (on contact hit)
Lower attacker's speed by 1.

#### Rough Skin / Iron Barbs (contact only)
Attacker takes 1/8 max HP damage.

#### Poison Point (contact only)
30% chance to poison attacker.

#### Flame Body (contact only)
30% chance to burn attacker.

#### Static (contact only)
30% chance to paralyze attacker.

#### Effect Spore (contact only)
30% chance: 11% paralyze, 11% poison, 10% sleep (random pick from the 30%).

#### Toxic Boost / Anger Point (attacker context)
Not attacker-side; already covered.

---

### `ON_STAT_STAGE_CHANGE`

#### Clear Body / White Smoke / Full Metal Body
Prevent opponent-caused stat drops. Log "[Pokemon]'s [ability] prevents stat reduction!"
Does NOT block: stat drops from the holder's own moves (Close Combat self-drops), Sticky Web, etc.
Blocks: Intimidate, stat-lowering moves targeting holder, certain abilities.

#### Contrary
Invert stat changes (boosts become drops, drops become boosts). Including self-inflicted.

#### Mirror Armor
Reflect any stat-drop attempts back to the source.

#### Defiant / Competitive
When any stat is lowered by an opponent: +2 Atk (Defiant) or +2 SpA (Competitive).
Triggers per stat drop (multiple drops in one turn can trigger multiple times, e.g. Sticky Web + Intimidate).

#### Simple
All stat changes (gains and losses) are doubled.

---

### `ON_STATUS_INFLICT`

#### Immunity
Immune to poison/toxic. Move fails.

#### Limber
Immune to paralysis.

#### Water Veil / Water Bubble
Immune to burn.

#### Vital Spirit / Insomnia
Immune to sleep.

#### Magma Armor
Immune to freeze.

#### Own Tempo
Immune to confusion and infatuation.

#### Oblivious
Immune to infatuation and Taunt.

#### Comatose
Always treated as if asleep but cannot be given a real status. Immune to all other status.

#### Synchronize
When holder is inflicted with burn, paralysis, or poison: inflict the same status on the source.

---

### `END_OF_TURN`

Processed in this order within END_OF_TURN (matches turn resolution order in battle-engine.md):

#### Weather damage abilities
**Sand Rush / Swift Swim / Chlorophyll / Slush Rush / Surge Surfer** — speed multipliers, not END_OF_TURN.
**Sand Force** — damage boost, not END_OF_TURN.

**Dry Skin** — in rain: restore 1/8 max HP. In sun: lose 1/16 max HP. When hit by Water move: absorb (PRE_MOVE_TARGET). When hit by Fire move: extra damage (ON_DAMAGE_CALC).

**Ice Body** — in snow: restore 1/16 max HP.

**Rain Dish** — in rain: restore 1/16 max HP.

**Solar Power** — in sun: lose 1/8 max HP, SpA ×1.5 (the loss is END_OF_TURN; the boost is ON_DAMAGE_CALC).

#### HP restoration
**Leftovers** — restore 1/16 max HP. (Item, not ability, but same timing.)

**Poison Heal** — if holder is poisoned: restore 1/8 max HP instead of taking damage. Suppresses normal poison damage.

**Shed Skin** — 33% chance to cure primary status.

**Hydration** — if rain: cure primary status.

**Healer** — 30% chance to cure adjacent ally's status (doubles only).

#### Stat changes
**Speed Boost** — +1 Spe at end of turn (after first turn on field; does not activate turn switched in).

**Moody** — +2 to a random stat, −1 to a different random stat.

#### Berry consumption (items, but triggered END_OF_TURN or on damage)
**Sitrus Berry** — when HP ≤ 50%: restore 25% max HP. Trigger immediately when threshold crossed (AFTER_TAKING_DAMAGE hook), not strictly END_OF_TURN.
**Oran Berry** — when HP ≤ 50%: restore 10 HP.
**Lum Berry** — when any status inflicted (ON_STATUS_INFLICT): cure it immediately.
**Leppa Berry** — when a move's PP reaches 0: restore 10 PP.
**Pinch Berries** (Salac, Petaya, Apicot, Liechi, Ganlon, Lansat, Starf, Micle, Custap) — trigger at ≤ 25% HP.
**Custap Berry** — at ≤ 25% HP: move with normal priority once moves first (priority +0.5 — implement as a flag).

#### Other END_OF_TURN effects
**Harvest** — in sun: 50% chance to restore a consumed berry. Outside sun: 50% at end of turn.

**Bad Dreams** — opposing sleeping Pokemon lose 1/8 max HP.

**Perish Song counter** decrement — implemented in resolver, not ability.

**Insomnia / Vital Spirit** — prevents sleep. Wakes up holder if asleep upon switch-in (ON_SWITCH_IN).

---

### `ON_WEATHER`

#### Overcoat / Magic Guard
Holder takes no weather damage (sandstorm, hail).

#### Sand Rush
In sand: Spe ×2. Implemented in speed computation, not a hook. But use this hook to log if desired.

**Magic Guard** also prevents: hazard damage, status damage (burn/poison/toxic), recoil, weather damage, curse damage. Implement by checking `holderHasMagicGuard` flag wherever those damage sources are applied.

---

### `ON_FAINT`

#### Aftermath
If holder faints from a contact move: attacker loses 1/4 their max HP.

#### Destiny Bond
If Destiny Bond active and holder faints from a move: attacker also faints.

#### Innards Out
When holder faints from a move: deal damage equal to holder's HP before the final hit.

---

## Priority Between Abilities

When multiple abilities trigger at the same hook point (e.g., both players switch in pokemon with abilities on `ON_SWITCH_IN`), the order is:

1. Weather-setter abilities fire in speed order (faster speed goes first)
2. Intimidate fires after weather (speed order between multiple Intimidates)
3. Other ON_SWITCH_IN abilities fire after Intimidate
4. If still tied: alphabetical by ability name (arbitrary but consistent)

For ability vs ability interactions (e.g., both pokemon have Drought and Drizzle), last one to fire wins. The faster pokemon's ability fires first, so the slower one's weather overrides.

---

## Ability Suppression

These conditions suppress an ability's effect (treat as if no ability):
- **Mold Breaker / Turboblaze / Teravolt** (attacker has this ability): suppress target's ability during move execution
- **Gastro Acid** (move): suppresses target's ability until they switch
- **Neutralizing Gas** (Weezing-Galar ability): while active in field, all other abilities suppressed

When suppressed, skip all hook registrations for that ability.

---

## Unimplemented / Low-Priority Abilities

These exist in the game but are uncommon in competitive play and can be stubbed as no-ops initially:
- Run Away, Stench, Illuminate, Color Change (already listed above, complex), Sticky Hold, Suction Cups, Oblivious (partly listed), Forewarn, Honey Gather, Frisk (already listed), Klutz, Skill Link (item-level), Pickpocket (already listed), Symbiosis, Dancer (complex), Battery (doubles SpA pass), Receiver, Steely Spirit (doubles Steel boost), Tablets of Ruin / Sword of Ruin / Vessel of Ruin / Beads of Ruin (Paradox abilities — reduce relevant stat of all other active Pokemon by 25%).

Mark unimplemented abilities with a comment in the registry:
```typescript
abilityRegistry.set('run-away', {}) // no battle effect
abilityRegistry.set('beads-of-ruin', {
  // TODO: implement — reduce SpD of all other active pokemon by 25%
  ON_SWITCH_IN: (ctx) => []
})
```

---

## Adding a New Ability Handler

1. Find or create the file for the relevant hook group in `backend/src/battle-engine/effects/abilities/`
2. Register the ability in the registry:
   ```typescript
   abilityRegistry.set('ability-name', {
     ON_SWITCH_IN: (ctx) => { /* ... */ return [] },
     END_OF_TURN: (ctx) => { /* ... */ return [] },
   })
   ```
3. Return `TurnLogEntry[]` from each hook handler
4. Write unit tests for edge cases (ability vs ability interactions, ability suppression)

See `specs/battle-engine.md` for TurnLogEntry shape and hook call ordering.
