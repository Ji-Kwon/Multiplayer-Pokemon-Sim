# Damage Calculation Spec

All damage calculations in the battle engine must follow this spec exactly.
Order of operations matters — floor division is applied at each step.

---

## Stat Calculation (computed once at battle start)

Stored in `PartyPokemon.stats` as `ComputedStats`. Recomputed if form changes (Mega, etc.).

```
HP  = floor((2 × BaseStat + IV + floor(EV / 4)) × Level / 100 + Level + 10)
Stat = floor(floor((2 × BaseStat + IV + floor(EV / 4)) × Level / 100 + 5) × NatureMultiplier)
```

- `Level` = always 50 for VGC/competitive formats. Use 100 for singles where applicable.
- `IV` = 0–31
- `EV` = 0–252, total across all stats capped at 510
- `NatureMultiplier` = 1.1 (boosting nature), 0.9 (reducing nature), 1.0 (neutral)

**Shedinja exception:** HP is always 1 regardless of formula.

---

## Effective Attack / Defense

Before plugging into the damage formula, compute the effective Atk and Def values.

```
EffectiveAtk = floor(BaseStat × StageMultiplier × AbilityMultiplier × ItemMultiplier)
EffectiveDef = floor(BaseStat × StageMultiplier × AbilityMultiplier × ItemMultiplier)
```

### Stat Stage Multipliers (Atk / Def / SpA / SpD / Spe)
| Stage | Multiplier |
|---|---|
| +6 | 4.0 (8/2) |
| +5 | 3.5 (7/2) |
| +4 | 3.0 (6/2) |
| +3 | 2.5 (5/2) |
| +2 | 2.0 (4/2) |
| +1 | 1.5 (3/2) |
|  0 | 1.0 (2/2) |
| -1 | 0.667 (2/3) |
| -2 | 0.5 (2/4) |
| -3 | 0.4 (2/5) |
| -4 | 0.333 (2/6) |
| -5 | 0.286 (2/7) |
| -6 | 0.25 (2/8) |

Use exact fraction arithmetic: `(2 + max(stage, 0)) / (2 + max(-stage, 0))`.
Apply as: `floor(stat × numerator / denominator)` — do NOT convert to decimal first.

### Accuracy / Evasion Stage Multipliers
| Stage | Multiplier |
|---|---|
| +6 | 3.0 (9/3) |
| +5 | 2.667 (8/3) |
| +4 | 2.333 (7/3) |
| +3 | 2.0 (6/3) |
| +2 | 1.667 (5/3) |
| +1 | 1.333 (4/3) |
|  0 | 1.0 (3/3) |
| -1 | 0.75 (3/4) |
| -2 | 0.6 (3/5) |
| -3 | 0.5 (3/6) |
| -4 | 0.429 (3/7) |
| -5 | 0.375 (3/8) |
| -6 | 0.333 (3/9) |

### Critical Hits and Stat Stages
When a critical hit occurs:
- Ignore negative Atk/SpA stages on the **attacker**
- Ignore positive Def/SpD stages on the **defender**
- Stat-lowering items/abilities on attacker are still applied
- Stat-raising items/abilities on defender are NOT ignored (only stage modifiers are)

### Moves That Use Non-Standard Stats
| Move | Uses |
|---|---|
| Body Press | User's Def as Atk |
| Psyshock, Psystrike, Secret Sword | User's SpA vs Target's Def |
| Foul Play | Target's Atk (with target's stages) |
| Gyro Ball | Power is dynamic (see move effects spec) |
| Electro Ball | Power is dynamic |

---

## Effective Power

Most moves have fixed power. Dynamic power cases:

| Move | Power Formula |
|---|---|
| Gyro Ball | min(150, floor(25 × TargetSpeed / UserSpeed)) |
| Electro Ball | 40/60/80/120/150 based on speed ratio |
| Low Kick / Grass Knot | 20/40/60/80/100/120 based on target weight (kg) |
| Heat Crash / Heavy Slam | 40/60/80/100/120 based on weight ratio |
| Return | floor(Friendship × 10 / 25), max 102 |
| Frustration | floor((255 - Friendship) × 10 / 25), max 102 |
| Stored Power / Power Trip | 20 + 20 × (sum of positive stat stages) |
| Acrobatics | 55 normally, 110 if no held item |
| Magnitude | 1d8: 10/30/50/70/90/110/150 |
| Eruption / Water Spout | floor(150 × CurrentHP / MaxHP), min 1 |
| Flail / Reversal | depends on HP ratio (see table below) |
| Natural Gift | based on berry type |
| Trump Card | based on PP remaining |

**Flail/Reversal power:**
| Remaining HP % | Power |
|---|---|
| > 68.75% | 20 |
| 35.42–68.75% | 40 |
| 20.84–35.41% | 80 |
| 10.42–20.83% | 100 |
| 4.17–10.41% | 150 |
| ≤ 4.16% | 200 |

---

## Main Damage Formula

Applied in strict order. Each step uses `floor()` where indicated.

```
Step 1:  Base = floor(2 × Level / 5 + 2)               → always 44 at level 100, 24 at level 50
Step 2:  Base = floor(Base × Power × EffectiveAtk / EffectiveDef)
Step 3:  Base = floor(Base / 50) + 2
Step 4:  Base = floor(Base × Spread)                   → 0.75 if hits multiple targets in doubles, else 1
Step 5:  Base = floor(Base × Weather)
Step 6:  Base = floor(Base × GlaiveRush)               → ×2 if target used Glaive Rush last turn
Step 7:  Base = floor(Base × Critical)                 → 1.5 on crit, else 1
Step 8:  Base = Base × Random / 100                    → Random = randInt(85, 100); apply floor after
Step 9:  Base = floor(Base × STAB)
Step 10: Base = floor(Base × TypeEffectiveness)        → combined single multiplier from type chart
Step 11: Base = floor(Base × Burn)                     → 0.5 if burned + physical + not Guts; else 1
Step 12: Damage = max(1, floor(Base × FinalModifier))  → see FinalModifier section below
```

**Minimum damage is always 1**, except for moves blocked by type immunity (returns 0) and OHKO miss.

### Weather Multiplier (Step 5)
| Condition | Fire moves | Water moves | Other |
|---|---|---|---|
| Sun / Harsh Sun | 1.5 | 0.5 | 1.0 |
| Rain / Heavy Rain | 0.5 | 1.5 | 1.0 |
| Sand / Snow | 1.0 | 1.0 | 1.0 |
| Harsh Sun (Water move) | 0 (blocked entirely — skip damage formula) | — | — |
| Heavy Rain (Fire move) | — | 0 (blocked entirely) | — |

### STAB Multiplier (Step 9)
- No STAB: 1.0
- STAB: 1.5
- STAB + Adaptability: 2.0
- Tera STAB (tera type matches original type): 2.0 (stacks multiplicatively with Adaptability → 2.25 is a Showdown quirk, implement as specified there)
- Tera STAB (tera type does not match original type): 1.5 (lose original STAB, gain new STAB)
- Tera + Adaptability: use 2.0 for the tera type

### Type Effectiveness (Step 10)
Compute combined multiplier from the 18×18 type chart:
- Single-type target: one lookup
- Dual-type target: multiply both lookups together
- Possible values: 0, 0.25, 0.5, 1, 2, 4
- Store type chart as `type_chart` table with `(attacker_type, defender_type, multiplier)` rows OR as a static 18×18 matrix in code for performance

**Type immunity (0):** return 0 damage immediately after Step 10. Do not apply min(1).

---

## FinalModifier (Step 12)

All remaining multipliers are combined into a single `FinalModifier` and applied once.
These are multiplicative with each other. Compute as a running product:

```typescript
let mod = 1.0

// Screens (apply only if not a critical hit)
if (reflect && isPhysical && !isCrit)  mod *= (isDoubles ? 2/3 : 0.5)
if (lightScreen && isSpecial && !isCrit) mod *= (isDoubles ? 2/3 : 0.5)
if (auroraVeil && !isCrit)             mod *= (isDoubles ? 2/3 : 0.5)

// Attacker item modifiers
if (item === 'life-orb')               mod *= 1.3
if (item === 'choice-band' && isPhysical) mod *= 1.5
if (item === 'choice-specs' && isSpecial) mod *= 1.5
if (item === 'expert-belt' && typeEffectiveness > 1) mod *= 1.2
if (item === 'metronome-item')         mod *= (1 + 0.2 * consecutiveSameMove)  // max ×2
if (item === 'muscle-band' && isPhysical) mod *= 1.1
if (item === 'wise-glasses' && isSpecial) mod *= 1.1
// Type-boosting items (Mystic Water, Charcoal, etc.): ×1.2 for matching type

// Defender item modifiers
if (defenderItem === 'assault-vest' && isSpecial) mod *= 0.5  // SpD is boosted in stat calc, not here
// Note: Assault Vest is handled in stat calc (×1.5 SpD), not FinalModifier

// Attacker ability modifiers
// (see specs/ability-effects.md for full list)
// Examples:
if (ability === 'technician' && power <= 60)  mod *= 1.5
if (ability === 'tough-claws' && isContact)   mod *= 1.3
if (ability === 'iron-fist' && isPunch)        mod *= 1.2
if (ability === 'reckless' && hasRecoil)       mod *= 1.2
if (ability === 'sheer-force' && hasSecondary) mod *= 1.3  // also suppresses secondary effect
if (ability === 'analytic' && userMovedLast)   mod *= 1.3
if (ability === 'sand-force' && weatherIsSand && (isRock||isGround||isSteel)) mod *= 1.3
if (ability === 'pinch-abilities' && hpBelowThird) mod *= 1.5  // Overgrow/Blaze/Torrent/Swarm

// Defender ability modifiers
if (defAbility === 'multiscale' && defenderAtFullHp) mod *= 0.5
if (defAbility === 'shadow-shield' && defenderAtFullHp) mod *= 0.5
if (defAbility === 'filter' && typeEffectiveness > 1)  mod *= 0.75
if (defAbility === 'solid-rock' && typeEffectiveness > 1) mod *= 0.75
if (defAbility === 'prism-armor' && typeEffectiveness > 1) mod *= 0.75
if (defAbility === 'fur-coat' && isPhysical)           mod *= 0.5
if (defAbility === 'fluffy' && isContact)              mod *= 0.5
if (defAbility === 'fluffy' && isFire)                 mod *= 2.0  // stacks with contact reduction
if (defAbility === 'thick-fat' && (isFire||isIce))     mod *= 0.5
if (defAbility === 'heatproof' && isFire)              mod *= 0.5
if (defAbility === 'dry-skin' && isFire)               mod *= 1.25

// Helping Hand (doubles)
if (helpingHandActive)  mod *= 1.5

// Charge (Electric move after Charge used)
if (charged && isElectric)  mod *= 2.0

// Final modifier cap: no cap, but individual values are as specified
```

**Note:** Apply `FinalModifier` as a single `floor(Base × mod)` operation at Step 12, not incrementally.

---

## Special Damage Cases

### Fixed Damage (skip entire formula)
| Move | Damage |
|---|---|
| Dragon Rage | 40 |
| Sonic Boom | 20 |
| Night Shade / Seismic Toss | Equal to user's level (always 50 or 100) |
| Psywave | Random: floor(Level × (randInt(0,10)+5) / 10) |
| Super Fang / Nature's Madness | floor(target's current HP / 2) |
| Final Gambit | User's current HP (user faints) |
| Endeavor | max(0, targetHP - userHP) |

### OHKO Moves (Fissure, Guillotine, Horn Drill, Sheer Cold)
- Fails if target's speed > user's speed (except Sheer Cold fails if target isn't Ice type)
- Accuracy = (User Level - Target Level) + 30, minimum 1%
- On hit: damage = target's current HP (instant faint, ignores Sturdy and Focus Sash)
- Blocked by: Wonder Guard, type immunity, Protect

### Multi-Hit Moves
Roll number of hits first, then calculate damage per hit independently (separate random roll each hit).
| Distribution | Hits |
|---|---|
| 2–5 hit moves | 2 (35.2%), 3 (35.2%), 4 (14.8%), 5 (14.8%) |
| Always 2 | Double Kick, Bonemerang, etc. |
| Always 3 | Triple Kick (power increases each hit: 10/20/30) |
| Always 5 | Bullet Seed (with Loaded Dice: always max hits) |
| Scale Shot | 2–5 hits, last hit lowers Def −1, raises Spe +1 |

Skill Link ability: always hit maximum times (5 for 2–5 moves).
Loaded Dice item: always hit maximum times.

### Recoil Damage
Applied after damage is dealt. Does not trigger if target had 0 HP before the move.
| Recoil Type | Amount |
|---|---|
| 1/4 recoil (Double-Edge, etc.) | floor(damage dealt / 4) |
| 1/3 recoil (Brave Bird, etc.) | floor(damage dealt / 3) |
| 1/2 recoil (Head Smash, etc.) | floor(damage dealt / 2) |
| Crash damage (High Jump Kick miss) | floor(user max HP / 2) |
| Life Orb recoil | floor(user max HP / 10) |

Rock Head / Magic Guard: no recoil damage.

### HP Drain
Applied after damage is dealt.
| Drain Type | Amount |
|---|---|
| 1/2 drain (Giga Drain, Drain Punch, etc.) | max(1, floor(damage dealt / 2)) |
| 3/4 drain (Draining Kiss) | max(1, floor(damage dealt × 3 / 4)) |

Big Root item: drain amount × 1.3 (apply floor after).
Liquid Ooze on defender: drain becomes recoil instead (user takes the drain amount as damage).

---

## Test Cases

Use these to verify the implementation is correct. All at Level 50, no EVs/IVs unless stated.

| Attacker | Move | Defender | Expected range | Notes |
|---|---|---|---|---|
| Miraidon (135 SpA) | Electro Drift (100 BP, ×1.5 vs any) | Kyogre (100 SpD) | varies | Electric vs Water, neutral |
| Torkoal (85 Atk, Drought) | Flamethrower (90 BP) | Dragapult (75 SpD) | boosted by sun | Special so uses SpA not Atk — this is a trick test |
| Garchomp (130 Atk) | Earthquake (100 BP) | Garchomp (115 Def) | ~90–106 | STAB, neutral |
| Incineroar (115 Atk, Intimidated) | Fake Out (40 BP) | Urshifu (100 Def) | reduced | −1 Atk from Intimidate |
| Calyrex-Shadow (165 SpA) | Astral Barrage (120 BP) | Two targets | ×0.75 spread | Doubles spread |
| Any | Night Shade | Any | 50 | Fixed = level |
| Flutter Mane (135 SpA + Protosynthesis in sun) | Moonblast (95 BP) | Any Steel type | 0 | Type immune |

---

## Implementation Notes

1. **Use integer math throughout.** Never accumulate floating point error. The `floor()` calls at each step are load-bearing.
2. **Type the context object tightly.** The damage function should receive everything it needs — no reaching into global state.
3. **Return 0 for type immunity** before reaching the min(1) guard. The caller checks for 0 and skips secondary effects.
4. **Separation of concerns:** `calcDamage` returns a number. It does not apply damage to the state, does not trigger abilities, does not handle faints. The resolver does that.
5. **The random roll** should be injectable for testing (pass a `rng` function, default to `() => randInt(85, 100)`).
