# Move Effects Spec

Moves are grouped into **effect categories**. Each category has one handler function.
A move's `effect_id` column references the category it belongs to.
This avoids implementing ~900 individual move handlers — instead implement ~60 category handlers
that cover all moves.

Before working in `backend/src/battle-engine/effects/moves/`, read `specs/battle-engine.md`
for the handler interface and hook context.

---

## Handler Interface

```typescript
// backend/src/battle-engine/effects/moves/types.ts

interface MoveContext {
  state: Draft<BattleState>        // immer draft — mutate directly
  attackerSide: 0 | 1
  attackerSlot: number             // index into side.active[]
  targets: TargetInfo[]            // resolved targets (1 or 2 in doubles)
  move: Move                       // from DB — power, type, flags, etc.
  effectChance: number             // % for secondary effects (0–100)
  isCrit: boolean
  damageDealt: number              // set by damage handler before secondary effects run
  rng: () => number                // injectable for tests, default Math.random
}

interface TargetInfo {
  side: 0 | 1
  slot: number
  pokemon: ActiveSlot & { party: PartyPokemon }  // convenience access
  typeEffectiveness: number        // pre-computed
  damageTaken: number              // filled in by the handler
}

type MoveEffectHandler = (ctx: MoveContext) => TurnLogEntry[]

// Registry maps effect_id → handler
const moveEffectRegistry = new Map<number, MoveEffectHandler>()
```

Each handler:
1. Mutates `ctx.state` (via immer draft) to apply effects
2. Returns `TurnLogEntry[]` describing what happened
3. Must NOT call other handlers — the resolver calls handlers in sequence
4. Must NOT apply damage to the state — damage is applied by the resolver before calling secondary effect handlers. Exception: fixed-damage moves return their own damage value.

---

## Effect Categories

### Group 1 — Damage Categories

#### `DIRECT_DAMAGE` (effect_id: 1)
Deal damage, no secondary effect.
**Examples:** Tackle, Crunch (this is a separate category — Crunch has a secondary), Hyper Voice, Iron Head
Actually, Crunch has defense drop chance — use `DAMAGE_STAT_CHANGE_TARGET_CHANCE`.
Pure direct: Scratch, Ember (wait — Ember has burn chance), Pound, Cut, Strength...
Most "pure" moves: Body Slam (paralysis chance), Flamethrower (burn chance), etc. True pure moves are rare.
**Pure examples:** Mega Punch, Karate Chop (crit boost but that's a flag not an effect), Submission (recoil).
**Implementation:** Calculate damage, apply to target, return damage log entry.

#### `DAMAGE_RECOIL_QUARTER` (effect_id: 2)
Deal damage, user takes 1/4 of damage dealt as recoil.
**Examples:** Double-Edge, Submission
**Implementation:** `calcDamage` → apply to target → `recoil = floor(damageDealt / 4)` → apply to user.

#### `DAMAGE_RECOIL_THIRD` (effect_id: 3)
Deal damage, user takes 1/3 of damage dealt as recoil.
**Examples:** Brave Bird, Flare Blitz, Volt Tackle, Wood Hammer, Head Charge, Wild Charge

#### `DAMAGE_RECOIL_HALF` (effect_id: 4)
Deal damage, user takes 1/2 of damage dealt as recoil.
**Examples:** Head Smash

#### `DAMAGE_CRASH` (effect_id: 5)
Miss = user takes `floor(MaxHP / 2)` crash damage.
**Examples:** High Jump Kick, Jump Kick
**Implementation:** On miss, apply crash damage to user instead of move miss log.

#### `DAMAGE_DRAIN_HALF` (effect_id: 6)
Deal damage, restore HP equal to 1/2 of damage dealt.
**Examples:** Giga Drain, Mega Drain, Drain Punch, Leech Life, Absorb, Horn Leech, Draining Kiss (3/4 — see below)
**Implementation:** `heal = max(1, floor(damageDealt / 2))` → restore to user (capped at max HP).
Check: if target has Liquid Ooze, user takes `heal` as damage instead.
Big Root item: `heal = floor(heal × 1.3)`.

#### `DAMAGE_DRAIN_THREE_QUARTERS` (effect_id: 7)
Deal damage, restore 3/4 of damage dealt.
**Examples:** Draining Kiss

#### `DAMAGE_STATUS_CHANCE` (effect_id: 8)
Deal damage, roll `effectChance`% to inflict a primary status.
Specific status is encoded in `move.flags.inflicts_status`.
**Examples:**
- Flamethrower / Fire Blast / Ember → burn (10% / 10% / 10%)
- Thunderbolt / Thunder → paralysis (10% / 30%)
- Blizzard / Ice Beam / Ice Punch → freeze (10%)
- Poison Jab / Sludge Bomb → poison (30% / 30%)
- Body Slam → paralysis (30%)
- Tri Attack → burn OR freeze OR paralysis (20%, pick randomly)
**Implementation:**
```
if (rng() * 100 < effectChance && !sheerForce) {
  tryInflictStatus(target, move.flags.inflicts_status)
}
```
`tryInflictStatus` checks: already has status? type immune? ability immune (e.g. Flame Body target doesn't prevent being frozen)?

#### `DAMAGE_FLINCH_CHANCE` (effect_id: 9)
Deal damage, roll `effectChance`% to inflict flinch on target (if target hasn't moved yet this turn).
**Examples:** Air Slash (30%), Iron Head (30%), Bite (30%), Rock Slide (30%), Zen Headbutt (20%)
**Implementation:** Add `FLINCH` to target's volatile statuses. Flinch is cleared at start of next turn.
Flinch only works if target hasn't moved yet this turn (checked in resolver).
Inner Focus / Shield Dust / Steadfast immunity.

#### `DAMAGE_STAT_CHANGE_TARGET_CHANCE` (effect_id: 10)
Deal damage, roll `effectChance`% to change target's stat by `move.flags.stat_change`.
**Examples:**
- Crunch: −1 Def (20%)
- Shadow Ball: −1 SpD (20%)
- Moonblast: −1 SpA (30%)
- Bubble Beam: −1 Spe (10%)
- Snarl: −1 SpA (100% — this is guaranteed, effectChance = 100)
**Implementation:** Roll, then call `applyStatChange(target, stat, stages)`.

#### `DAMAGE_STAT_CHANGE_SELF` (effect_id: 11)
Deal damage, always change user's own stat (guaranteed, no roll).
**Examples:**
- Close Combat: −1 Def, −1 SpD (self, always)
- Superpower: −1 Atk, −1 Def (self, always)
- Draco Meteor: −2 SpA (self, always)
- Overheat: −2 SpA (self, always)
- Leaf Storm: −2 SpA (self, always)
- Psycho Boost: −2 SpA (self, always)
- V-create: −1 Def, −1 SpD, −1 Spe (self, always)

#### `DAMAGE_STAT_BOOST_SELF_CHANCE` (effect_id: 12)
Deal damage, roll `effectChance`% to raise user's own stat.
**Examples:**
- Meteor Mash: +1 Atk (20%)
- Rage: +1 Atk when hit (handled differently — triggered by taking damage, not on use)
- Charge Beam: +1 SpA (70%)

#### `DAMAGE_SELF_STAT_BOOST_GUARANTEED` (effect_id: 13)
Deal damage, always raise user's own stat.
**Examples:** Nuzzle (paralysis + self nothing, actually Nuzzle is status-only... skip)
Power-Up Punch: always +1 Atk to self if it hits

#### `MULTI_HIT` (effect_id: 14)
Hit 2–5 times. Each hit rolls damage independently.
**Examples:** Bullet Seed, Rock Blast, Icicle Spear, Pin Missile, Tail Slap, Population Bomb
**Implementation:** Roll hit count (or use Skill Link / Loaded Dice). Loop calcDamage per hit.
Each hit can independently crit (rare — usually only first hit crits in implementation).
Stop early if target faints.

#### `MULTI_HIT_FIXED_2` (effect_id: 15)
Always exactly 2 hits.
**Examples:** Double Kick, Bonemerang, Dual Wingbeat, Dragon Darts (targets in doubles)

#### `MULTI_HIT_TRIPLE` (effect_id: 16)
Always 3 hits with increasing power (10 / 20 / 30).
**Examples:** Triple Kick, Triple Axel (also increasing power, 20/40/60)

#### `TWO_TURN` (effect_id: 17)
Turn 1: charge (semi-invulnerable or not). Turn 2: attack.
**Examples:**
- Fly, Dig, Bounce, Dive: semi-invulnerable during charge (can't be targeted except by specific moves)
- Solar Beam, Solar Blade: skips charge in sun; half power in rain/sand/snow
- Sky Attack, Razor Wind, Skull Bash: not semi-invulnerable; Skull Bash raises Def on charge
- Freeze Shock, Ice Burn: status inflict on turn 2
- Phantom Force, Shadow Force: semi-invulnerable, bypasses Protect
**State:** set `activeSlot.lockedMove = moveId`, `activeSlot.volatileData.twoTurnCharge = true`.
On turn 2, clear the charge state and execute the move.

#### `DAMAGE_FIXED` (effect_id: 18)
Deal fixed damage regardless of stats.
**Examples:** Dragon Rage (40), Sonic Boom (20)
Store fixed amount in `move.flags.fixed_damage`.

#### `DAMAGE_LEVEL` (effect_id: 19)
Damage = user's level.
**Examples:** Night Shade, Seismic Toss
Skip type effectiveness — Night Shade is blocked by Normal immunity, Seismic Toss by Ghost immunity.

#### `DAMAGE_HP_BASED` (effect_id: 20)
Damage based on target's current HP.
**Examples:**
- Super Fang / Nature's Madness: floor(target HP / 2), minimum 1
- Final Gambit: user's current HP; user faints regardless of outcome
- Endeavor: max(0, targetHP - userHP); fails if userHP ≥ targetHP

#### `OHKO` (effect_id: 21)
One-hit KO if it hits. See `specs/damage-calc.md` for accuracy formula.
**Examples:** Fissure, Guillotine, Horn Drill, Sheer Cold
Sheer Cold fails against non-Ice types (in Gen 7+, actually it works against Ice types always and misses against non-ice... verify exact Gen 9 rule).

#### `ALWAYS_CRIT` (effect_id: 22)
Move always results in a critical hit.
**Examples:** Frost Breath, Storm Throw (these always crit)
Set `isCrit = true` unconditionally before damage calc.

#### `DAMAGE_SPREAD` (effect_id: 23)
Hits all opponents (and sometimes ally). Uses ×0.75 spread modifier if >1 target.
Handled by resolver target resolution — individual moves just need target type `all-opponents` in DB.
No special handler needed beyond `DIRECT_DAMAGE`; the resolver handles spread multiplier.

---

### Group 2 — Status-Only Categories

#### `INFLICT_STATUS` (effect_id: 30)
Inflict a primary status condition. `move.flags.inflicts_status` specifies which.
**Examples:** Thunder Wave (paralysis), Will-O-Wisp (burn), Toxic (badly poisoned), Spore / Sleep Powder (sleep), Glare (paralysis, hits Ground types), Stun Spore
**Implementation:** call `tryInflictStatus(target, status)`.
Powder moves blocked by Grass types and Overcoat ability.

#### `INFLICT_CONFUSION` (effect_id: 31)
Inflict confusion on target.
**Examples:** Confuse Ray, Sweet Kiss, Supersonic, Swagger (also raises Atk), Flatter (also raises SpA)
Swagger/Flatter: also call `applyStatChange` for +2 Atk / +2 SpA.

#### `INFLICT_INFATUATION` (effect_id: 32)
Inflict infatuation if opposite gender.
**Examples:** Attract

#### `LEECH_SEED` (effect_id: 33)
Plant Leech Seed on target.
Fails on Grass types. Fails if already seeded.

#### `PERISH_SONG` (effect_id: 34)
All active Pokemon (including user) faint after 3 turns.
Track `perish_song_counter` in volatile data.

#### `YAWN` (effect_id: 35)
Target falls asleep at end of next turn. Volatile status `yawn` with 1-turn delay.

---

### Group 3 — Stat Change Categories

#### `STAT_CHANGE_SELF` (effect_id: 40)
Change user's own stats (no damage).
`move.flags.stat_changes` = `[{ stat, stages }, ...]`
**Examples:**
- Swords Dance: +2 Atk
- Nasty Plot: +2 SpA
- Dragon Dance: +1 Atk, +1 Spe
- Calm Mind: +1 SpA, +1 SpD
- Iron Defense: +2 Def
- Amnesia: +2 SpD
- Agility / Autotomize: +2 Spe
- Bulk Up: +1 Atk, +1 Def
- Hone Claws: +1 Atk, +1 Acc
- Cotton Guard: +3 Def
- Quiver Dance: +1 SpA, +1 SpD, +1 Spe
- Shell Smash: −1 Def, −1 SpD, +2 Atk, +2 SpA, +2 Spe

#### `STAT_CHANGE_TARGET` (effect_id: 41)
Lower target's stats (no damage).
**Examples:**
- Growl: −1 Atk
- Leer: −1 Def
- Charm: −2 Atk
- Baby-Doll Eyes: −1 Atk (priority +1)
- Fake Tears: −2 SpD
- Metal Sound: −2 SpD
- Screech: −2 Def
- String Shot: −2 Spe
- Parting Shot: −1 Atk, −1 SpA, then user switches
- Snarl: −1 SpA (hits all opponents, handled via target)

#### `STAT_CHANGE_BOTH` (effect_id: 42)
Change stats on multiple targets simultaneously (doubles-specific support moves).
**Examples:** Icy Wind (damage + −1 Spe, hits all opponents — this is `DAMAGE_STAT_CHANGE_TARGET_CHANCE` with 100% really)

---

### Group 4 — Field Effect Categories

#### `SET_WEATHER` (effect_id: 50)
Set weather for 5 turns (8 with weather rock items).
**Examples:** Sunny Day, Rain Dance, Sandstorm, Snowscape
`move.flags.weather_type` specifies which weather.

#### `SET_TERRAIN` (effect_id: 51)
Set terrain for 5 turns (8 with Terrain Extender).
**Examples:** Electric Terrain, Grassy Terrain, Psychic Terrain, Misty Terrain

#### `SET_ROOM` (effect_id: 52)
Set field room effect.
**Examples:** Trick Room, Magic Room, Wonder Room
`move.flags.room_type`. Toggle if already active.

#### `SET_TAILWIND` (effect_id: 53)
Set Tailwind on user's side for 4 turns.

#### `SET_GRAVITY` (effect_id: 54)
Set Gravity on the field for 5 turns.
Grounds all airborne Pokemon. Cancels/prevents Magnet Rise, Sky Drop, Bounce, Fly, etc.

#### `SET_ENTRY_HAZARD` (effect_id: 55)
Set entry hazard on opponent's side.
`move.flags.hazard_type` = `'stealth-rock' | 'spikes' | 'toxic-spikes' | 'sticky-web'`.
Spikes/Toxic Spikes stack (max 3 / 2 layers). Fail if already at max.

#### `CLEAR_HAZARDS` (effect_id: 56)
Remove entry hazards.
- Rapid Spin: removes hazards from user's side, +1 Spe to self (Gen 9)
- Defog: removes hazards from both sides, also removes Reflect/Light Screen/Aurora Veil from both, removes terrain
- Tidy Up: removes hazards from user's side, removes Substitutes, +1 Atk +1 Spe to self
- Court Change: swaps both sides' hazards and screens

#### `SET_SCREEN` (effect_id: 57)
Set Reflect, Light Screen, or Aurora Veil on user's side.
`move.flags.screen_type`. Duration 5 turns (8 with Light Clay).
Aurora Veil: fails if weather is not snow/hail.

---

### Group 5 — Healing Categories

#### `HEAL_HALF` (effect_id: 60)
Restore 1/2 of user's max HP.
**Examples:** Recover, Slack Off, Soft-Boiled, Milk Drink, Heal Order

#### `HEAL_WEATHER_BASED` (effect_id: 61)
Restore HP based on weather. 
- Sun: 2/3 max HP
- Rain / Sand / Snow: 1/4 max HP  
- No weather: 1/2 max HP
**Examples:** Moonlight, Morning Sun, Synthesis

#### `HEAL_ROOST` (effect_id: 62)
Like `HEAL_HALF` but user loses Flying type until end of turn.
Becomes Normal if mono-Flying. Becomes pure non-Flying type if dual-typed.

#### `HEAL_WISH` (effect_id: 63)
Sets Wish; at end of NEXT turn, restore 1/2 of user's max HP to whoever is in that slot.
Track in `sideState.wish[slot] = { turnsRemaining: 1, amount }`.

#### `HEAL_SHORE_UP` (effect_id: 64)
Restore 1/2 HP normally, 2/3 HP in sand.

#### `HEAL_AQUA_RING` (effect_id: 65)
Add `aqua-ring` volatile; restore 1/16 max HP at end of each turn.

#### `HEAL_ALLY` (effect_id: 66)
Restore 1/2 HP to target ally (doubles only).
**Examples:** Heal Pulse

#### `AROMATHERAPY_BELL` (effect_id: 67)
Cure primary status of all party members (including benched).
**Examples:** Heal Bell, Aromatherapy

#### `LUNAR_BLESSING` (effect_id: 68)
Cure user and ally's status condition. Also restore 25% HP.
**Examples:** Lunar Blessing (Umbreon's signature)

---

### Group 6 — Switching / Pivoting Categories

#### `PIVOT_SWITCH` (effect_id: 70)
Deal damage, then user switches out after the move. Switch happens AFTER damage/effects resolve.
**Examples:** U-turn, Volt Switch, Flip Turn
Blocked by trapping (Arena Trap, Shadow Tag, etc.) — if trapped, still deals damage but no switch.

#### `BATON_PASS` (effect_id: 71)
Switch user out, passing stat stages, substitute HP, and certain volatile statuses to replacement.
Passes: stat stages, Aqua Ring, Ingrain, Magnet Rise, Power Trick, substitute HP.
Does NOT pass: Leech Seed, confusion, infatuation, Perish Song counter, taunt, encore.

#### `PARTING_SHOT` (effect_id: 72)
Lower target's Atk and SpA by 1, then user switches.
Blocked by Dark type (bounced back? No — Parting Shot fails against Dark types as a whole).

#### `TELEPORT` (effect_id: 73)
In battle: user switches out (lower priority than Parting Shot). Gen 8+ only.

#### `FORCE_SWITCH_TARGET` (effect_id: 74)
Force target to switch to a random benched Pokemon.
**Examples:** Roar, Whirlwind (priority −6), Dragon Tail, Circle Throw (with damage)
Fails if target is last Pokemon. Ignores Substitute (Dragon Tail/Circle Throw hit through sub).

---

### Group 7 — Unique Complex Categories

#### `PROTECT` (effect_id: 80)
Protect user from all moves this turn. Success rate halves each consecutive use (Gen 6+ mechanics).
`move.flags.protect_type` specifies subtype (Protect, Detect, Endure, Baneful Bunker, etc.)
- Protect/Detect: standard protect
- Endure: survive any hit with at least 1 HP
- Baneful Bunker: protect + poison contact attackers
- Spiky Shield: protect + 1/8 HP damage to contact attackers
- King's Shield: protect + −2 Atk to contact attackers (or −1 in Gen 8+... check Gen 9 ruling)
- Silk Trap: protect + −1 Spe to contact attackers
- Burning Bulwark: protect + burn contact attackers
- Wide Guard: protect entire side from spread moves (doubles)
- Quick Guard: protect entire side from priority moves
- Mat Block: protect entire side from damaging moves on turn 1 only

Consecutive protect success rate: 1, 1/3, 1/9, etc. Track `consecutiveProtects` in volatile data.
Feint and certain moves break Protect.

#### `HELPING_HAND` (effect_id: 81)
Boost partner's move this turn by ×1.5. Doubles only.
Add `helpingHandActive: true` to ally's volatile data for this turn.

#### `TRICK_SWAP_ITEM` (effect_id: 82)
Swap held items between user and target.
**Examples:** Trick, Switcheroo
Fails if either has no item, or if target has a Mail.

#### `KNOCK_OFF` (effect_id: 83)
Deal damage. If target is holding an item, remove it. Damage is ×1.5 if item is removed.
Check item removal eligibility before damage (Mega Stones, Z-Crystals, form-linked items can't be knocked off).

#### `TRANSFORM` (effect_id: 84)
Copy target's form: types, stats (except HP), abilities, moves (with 5 PP each), stat stages.
**Examples:** Transform, Imposter (ability — not a move)

#### `SUBSTITUTE` (effect_id: 85)
Use 1/4 max HP to create a Substitute with that HP. Substitute takes damage instead of user.
Fails if user HP ≤ 1/4 max HP. Fails if Substitute already active.
Track `activeSlot.volatileData.substitute_hp`.

#### `FOCUS_ENERGY` (effect_id: 86)
Increase crit ratio by +2 stages. Track in volatile data `critBoost`.
Scope Lens / Razor Claw: +1 crit stage. Super Luck: +1 crit stage.
Crit stage table: 0=1/24, 1=1/8, 2=1/2, 3+=always crit.

#### `ENCORE` (effect_id: 87)
Force target to use their last-used move for 2–6 turns (Gen 5+: 3 turns in competitive).
Fails if last move was Encore, Mimic, Mirror Move, Sketch, Struggle, Transform.
Track `activeSlot.encoreMoveId` and `activeSlot.encoreTurns`.

#### `DISABLE` (effect_id: 88)
Disable target's last-used move for 4 turns. Track in volatile data.

#### `TAUNT` (effect_id: 89)
Target cannot use status moves for 2–4 turns (3 in competitive).
Track `activeSlot.volatileData.tauntTurns`. Decrement at end of turn.

#### `TORMENT` (effect_id: 90)
Target cannot use the same move consecutively.

#### `EMBARGO` (effect_id: 91)
Target cannot use held items for 5 turns.

#### `HEAL_BLOCK` (effect_id: 92)
Target cannot use healing moves for 5 turns.

#### `FUTURE_SIGHT` (effect_id: 93)
Deal Psychic-type damage to target 2 turns later (at end of the second turn after use).
Damage is calculated at the time of impact, not at use. Uses original user's SpA.
Track in side state: `futureSightQueue: [{ turnsRemaining, damage, targetSlot }]`.

#### `DESTINY_BOND` (effect_id: 94)
If user faints this turn from a move, the attacker also faints.
Track `activeSlot.volatileData.destinyBond = true`. Clear at start of user's next turn.

#### `PAIN_SPLIT` (effect_id: 95)
Set both user and target HP to `floor((user.currentHp + target.currentHp) / 2)`.
Capped at each pokemon's max HP.

#### `PSYCH_UP` (effect_id: 96)
Copy target's stat stages to user.

#### `HAZE` (effect_id: 97)
Reset all stat stages for all active Pokemon to 0.

#### `AROMATHERAPY_SELF` (effect_id: 98)
Cure user's own status condition.
**Examples:** Refresh

#### `INGRAIN` (effect_id: 99)
Root user in place (can't switch), restore 1/16 HP per turn.
Grounded while Ingrained (Flying type loses immunity to ground).

#### `MAGNET_RISE` (effect_id: 100)
User becomes immune to Ground-type moves for 5 turns.

#### `TELEKINESIS` (effect_id: 101)
Target floats for 3 turns (immune to Ground, all moves auto-hit it except OHKO).

#### `WEATHER_BALL` (effect_id: 102)
Type and power change based on weather. If weather active: 100 BP + matching type. Else: 50 BP + Normal type.

#### `NATURE_POWER` (effect_id: 103)
Becomes a different move based on terrain (or Tri Attack if no terrain).

#### `SLEEP_TALK` (effect_id: 104)
While asleep, use a random move from user's moveset (excluding Sleep Talk, Chatter, and two-turn moves).

#### `SNORE` (effect_id: 105)
Only works while user is asleep. Normal-type, 50 BP, 30% flinch chance.

#### `TRICK_ROOM_TOGGLE` (effect_id: 106)
Toggle Trick Room. Use SET_ROOM with room_type='trick-room' — same handler.

---

## Adding a New Handler

1. Create `backend/src/battle-engine/effects/moves/{category-name}.ts`
2. Implement `MoveEffectHandler`
3. Register in `backend/src/battle-engine/effects/moves/registry.ts`:
   ```typescript
   moveEffectRegistry.set(EFFECT_IDS.YOUR_CATEGORY, yourHandler)
   ```
4. Add the effect_id constant to `backend/src/battle-engine/effects/moves/effect-ids.ts`
5. Write unit tests in `__tests__/{category-name}.test.ts` using at least 3 real move examples

---

## Sheer Force Interaction

Sheer Force suppresses secondary effects (anything beyond dealing damage) for a 1.3× power boost.
The handler should check `ctx.attackerPokemon.ability === 'sheer-force' && move.hasSecondaryEffect` 
before applying any secondary. The power boost is applied in the damage calc (FinalModifier), not here.
Affected by Sheer Force: status chance, flinch chance, stat change on target chance.
NOT affected: self-stat drops (Close Combat −Def), recoil, drain, weather/terrain setting.

---

## Move Flag Reference

Flags stored in `moves` table or `moves.flags` JSONB, used by handlers:

| Flag | Used by |
|---|---|
| `is_contact` | Rough Skin, Rocky Helmet, Iron Barbs, Poison Point, etc. |
| `is_sound` | Soundproof immunity, Throat Spray boost |
| `is_punch` | Iron Fist, Punching Glove |
| `is_bite` | Strong Jaw |
| `is_pulse` | Mega Launcher |
| `is_bomb` | Bulletproof |
| `is_powder` | Overcoat, Grass type immunity |
| `is_dance` | Dancer ability |
| `is_wind` | Wind Rider, Wind Power |
| `has_recoil` | Reckless boost, Rock Head negation |
| `has_drain` | Big Root, Liquid Ooze interaction |
| `inflicts_status` | Status effect type for INFLICT_STATUS, DAMAGE_STATUS_CHANCE |
| `stat_changes` | Array of {stat, stages} for stat-change categories |
| `weather_type` | Weather to set for SET_WEATHER |
| `hazard_type` | Hazard type for SET_ENTRY_HAZARD |
| `screen_type` | Screen type for SET_SCREEN |
| `protect_type` | Protect variant for PROTECT |
| `fixed_damage` | Amount for DAMAGE_FIXED |
