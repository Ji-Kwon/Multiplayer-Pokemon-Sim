# Data Import Spec

This document covers the one-time PokeAPI import pipeline that seeds the database,
the transform logic for each entity, update strategy, and known data gaps.

The import script lives at `backend/src/scripts/import-pokeapi.ts`.
Run it with: `npm run db:seed`

---

## PokeAPI Overview

Base URL: `https://pokeapi.co/api/v2/`
Set `POKEAPI_BASE_URL` env var to override (use a local PokeAPI mirror during development).

**Rate limiting:** PokeAPI has no auth but enforces rate limits (~100 req/s). The import script
must respect this. Use a concurrency limiter (e.g., `p-limit`) with max 20 concurrent requests
and 50ms between batches. A full import takes ~10–20 minutes at safe concurrency.

**Local mirror (recommended for dev):** Run PokeAPI locally via Docker.
```bash
docker run -p 8000:80 registry.hub.docker.com/phalt/pokeapi
# Then set POKEAPI_BASE_URL=http://localhost:8000/api/v2
```

---

## Import Pipeline Architecture

```
fetchAllResourceLists()
    │
    ├── fetchAndTransform(types)        → seed types + type_chart
    ├── fetchAndTransform(natures)      → seed natures
    ├── fetchAndTransform(move-effects) → seed move_effects  (effect categories)
    ├── fetchAndTransform(abilities)    → seed abilities
    ├── fetchAndTransform(items)        → seed items
    ├── fetchAndTransform(pokemon)      → seed pokemon (base forms, then alternates)
    ├── fetchAndTransform(moves)        → seed moves
    ├── linkPokemonAbilities()          → seed pokemon_abilities
    ├── linkPokemonMoves()              → seed pokemon_moves
    └── linkPokemonForms()              → seed pokemon_forms
```

Each step is idempotent — use `INSERT ... ON CONFLICT DO UPDATE` (upsert) so the script
can be re-run to pick up new Pokemon/moves added to PokeAPI in future updates.

---

## Entity Transform Logic

### Types (`/type/{id}`)

Fetch all 18 types. For the type chart, PokeAPI provides `damage_relations` on each type:
```json
{
  "damage_relations": {
    "double_damage_to": [...],
    "half_damage_to": [...],
    "no_damage_to": [...],
    "double_damage_from": [...],
    ...
  }
}
```

Build the 18×18 matrix from the `double_damage_to`, `half_damage_to`, `no_damage_to` arrays
on each type. Default all cells to 1.0 then apply overrides.

**Known gap:** PokeAPI type chart reflects the current game but may lag behind. Verify against
Bulbapedia after import. Particularly verify: Fairy added in Gen 6, Steel lost Ghost/Dark immunity in Gen 6.

### Natures (`/nature/`)

25 natures. PokeAPI provides `increased_stat` and `decreased_stat` fields.
Neutral natures (Hardy, Docile, Serious, Bashful, Quirky) have null for both.
Map stat names: `attack`→`atk`, `defense`→`def`, `special-attack`→`spa`, `special-defense`→`spd`, `speed`→`spe`.

### Move Effects (`/move-ailment/` + custom list)

PokeAPI has move ailments (status effects) but not a clean "effect category" taxonomy.
Define the `move_effects` table entries manually using the effect categories in `specs/move-effects.md`.
These are hand-authored, not imported from PokeAPI.

Assign `effect_id` to each move during the moves import by matching PokeAPI's `effect_entries`
and `meta` fields to the appropriate category. This is the most manual part of the import.

### Abilities (`/ability/`)

~300+ abilities. PokeAPI provides:
- `name`
- `effect_entries[].effect` (English prose description)
- `effect_entries[].short_effect`

Transform:
```typescript
{
  id: ability.id,
  name: ability.name,
  effect_tag: toEffectTag(ability.name),  // kebab-case name → same string, used as registry key
  description: ability.effect_entries.find(e => e.language.name === 'en')?.short_effect
}
```

`effect_tag` is just the ability name kebab-cased. The ability registry in the battle engine
uses this tag to look up the handler. If no handler exists, the ability is a no-op (silently).

### Items (`/item/`)

~700+ items. Most are not held items used in battle. Filter to relevant categories:

PokeAPI item categories to include:
- `held-items` — general held items
- `choice` — choice band/specs/scarf
- `plates` — Arceus plates
- `species-specific` — soul dew etc.
- `type-enhancement` — charcoal, mystic water, etc.
- `mega-stones`
- `z-crystals`
- `berries` — ALL berries (they have battle effects)
- `vitamins` — not needed for battle, skip
- `medicine` — not needed for battle, skip
- `other` — check individually

For berries, also fetch `/berry/{id}` to get `natural_gift_type` and `natural_gift_power`.

Transform:
```typescript
{
  id: item.id,
  name: item.name,
  category: item.category.name,
  effect_tag: hasBattleEffect(item) ? item.name : null,
  natural_gift_type_id: berry?.natural_gift_type?.url ? extractIdFromUrl(url) : null,
  natural_gift_power: berry?.natural_gift_power ?? null,
  description: item.effect_entries.find(e => e.language.name === 'en')?.short_effect
}
```

### Pokemon (`/pokemon/` + `/pokemon-species/`)

This is the largest import. ~1,025 base pokemon + ~800+ alternate forms.

**Two-pass approach:**
1. First pass: import base forms (where `is_default = true` in PokeAPI)
2. Second pass: import alternate forms (regional variants, mega forms, gmax, etc.)

PokeAPI `/pokemon/{id}` provides battle stats, types, sprites, abilities (with is_hidden flag), moves (with method).
PokeAPI `/pokemon-species/{id}` provides: is_legendary, is_mythical, generation, base_form_species.

```typescript
interface PokeAPITransform {
  id: pokemon.id,                          // national dex number
  name: pokemon.name,                      // 'bulbasaur', 'gardevoir-mega', etc.
  form_name: extractFormName(pokemon.name),// null for base, 'mega', 'alolan', etc.
  base_form_id: species.evolves_from_species? ... // complex — see note below
  type1_id: pokemon.types[0].type.id,
  type2_id: pokemon.types[1]?.type.id ?? null,
  hp: pokemon.stats.find(s => s.stat.name === 'hp').base_stat,
  // ... same for all 6 stats
  weight_kg: pokemon.weight / 10,          // PokeAPI uses hectograms
  sprite_url: pokemon.sprites.front_default,
  sprite_shiny_url: pokemon.sprites.front_shiny,
  is_legendary: species.is_legendary,
  is_mythical: species.is_mythical,
  generation: extractGenNumber(species.generation.name),
  is_available: true                       // default all to true; filter by ruleset config later
}
```

**Form name extraction:** Strip the base species name from the full form name.
`'gardevoir-mega'` → form_name `'mega'`, base species `'gardevoir'`.
`'raticate-alola'` → form_name `'alolan'`, base `'raticate'`.

**`base_form_id` for alternate forms:** Look up the base form pokemon ID by species name.
This requires species data (`/pokemon-species/{name}`). The `varieties` array on the species
lists all forms; the one with `is_default: true` is the base.

**Sprite handling:** PokeAPI sprites may be null for newer pokemon. Fall back to:
`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/{id}.png`

### Moves (`/move/`)

~900+ moves. PokeAPI `/move/{id}` provides:

```typescript
{
  id: move.id,
  name: move.name,
  type_id: move.type.id,
  category: move.damage_class.name,        // 'physical', 'special', 'status'
  power: move.power,                       // null for status
  accuracy: move.accuracy,                 // null = never misses
  pp: move.pp,
  priority: move.priority,
  effect_id: resolveEffectId(move),        // MANUAL mapping — see below
  effect_chance: move.effect_chance,
  target: move.target.name,
  // Flags come from move.meta and move.learned_by_pokemon context
  is_contact: move.meta?.flags?.includes('contact') ?? false,
  // ... other flags
}
```

**Effect ID mapping (the hard part):**
PokeAPI provides `effect_entries` (prose) and `meta.ailment`, `meta.category`, `meta.stat_changes`.
Use a combination to map to your `move_effects.effect_id`:

```typescript
function resolveEffectId(move: PokeAPIMove): number {
  const category = move.meta?.category?.name      // 'damage', 'ailment', 'net-good-stats', etc.
  const ailment = move.meta?.ailment?.name        // 'burn', 'paralysis', 'sleep', etc.
  const statChanges = move.meta?.stat_changes     // array of { change, stat }
  const drain = move.meta?.drain                  // % HP drained (negative = recoil)
  const healing = move.meta?.healing              // % HP healed

  // Map to your effect categories — see specs/move-effects.md for full category list
  // Example:
  if (category === 'damage' && drain < 0)      return EFFECT_IDS.DAMAGE_RECOIL
  if (category === 'damage' && drain > 0)      return EFFECT_IDS.DAMAGE_DRAIN
  if (category === 'damage' && ailment !== 'none') return EFFECT_IDS.DAMAGE_STATUS_CHANCE
  // etc.
}
```

This mapping will need manual review and correction for ~50 unique/complex moves.
Keep a list of manually overridden effect_ids in `backend/src/scripts/move-effect-overrides.ts`.

### Pokemon Abilities (linking)

From the `/pokemon/{id}` response, `abilities` array provides:
```json
{ "ability": { "name": "...", "url": "..." }, "is_hidden": false, "slot": 1 }
```

Map slot: 1 = slot 1, 2 = slot 2, hidden = slot 3.

### Pokemon Moves (linking)

From `/pokemon/{id}`, `moves` array provides learn methods and levels.
PokeAPI has moves for all games; filter to Gen 9 only:
- Keep `version_group_details` where `version_group.name` is in `['scarlet-violet']`
- If a move has multiple learn methods for the same game, keep all (insert one row per method)

### Pokemon Forms (mega, gmax, etc.)

This requires cross-referencing:
- The `pokemon_forms` table in PokeAPI (`/pokemon-form/{id}`)
- The item that triggers the form (mega stone, etc.) — look up by name pattern: `'{species}-ite'` for mega stones

Mega stones: map `'venusaurite'` → triggers mega for `'venusaur'`, etc.
Build this mapping manually in `backend/src/scripts/mega-stone-map.ts`.

---

## Known PokeAPI Data Gaps

These require manual supplementation or cross-referencing with Bulbapedia / Smogon:

| Gap | Workaround |
|---|---|
| Move contact flag is inconsistently populated | Cross-reference Bulbapedia move flag tables |
| Ability effect descriptions are prose only | Hand-code `effect_tag` to battle engine behavior |
| Item battle effects not structured | Hand-code item effect handlers using item name as key |
| Exact ability interaction priority | Reference Pokémon Showdown source for edge cases |
| Scarlet/Violet move tutor learnsets incomplete | Supplement from Bulbapedia |
| Paradox Pokemon stats may update with DLC | Re-run import after DLC drops |

---

## Update Strategy

When a new game/DLC drops:
1. Update `POKEAPI_BASE_URL` to include new data (PokeAPI usually updates within weeks)
2. Re-run `npm run db:seed` — idempotent upserts handle new rows
3. New moves/abilities/items need effect handlers written in the battle engine
4. Update `RulesetConfig` to include new Pokemon/items/mechanics
5. Bump the `ruleset_name` on new battles

For Pokemon Champions or other format rule changes:
- Update `is_available` flags via a migration
- Add any new mechanic handlers (mega evolution, etc.) to the battle engine

---

## Helper Utilities

```typescript
// Extract numeric ID from PokeAPI resource URL
// e.g. 'https://pokeapi.co/api/v2/type/10/' → 10
function extractIdFromUrl(url: string): number {
  return parseInt(url.split('/').filter(Boolean).pop()!)
}

// Fetch with retry + exponential backoff
async function fetchWithRetry(url: string, retries = 3): Promise<unknown>

// Batch insert with ON CONFLICT DO UPDATE
async function upsertBatch<T>(table: string, rows: T[], conflictColumn: string): Promise<void>
```

---

## Validation After Import

Run these queries after seeding to sanity-check:

```sql
-- Expect ~1025+ pokemon
SELECT COUNT(*) FROM pokemon;

-- Expect ~900+ moves  
SELECT COUNT(*) FROM moves;

-- Expect 0 moves with NULL effect_id (all moves should be mapped)
SELECT COUNT(*) FROM moves WHERE effect_id IS NULL;

-- Expect type chart to be complete (18×18 = 324 rows)
SELECT COUNT(*) FROM type_chart;

-- Spot check: Garchomp should have 2 abilities + 1 hidden
SELECT a.name, pa.slot FROM pokemon_abilities pa
JOIN abilities a ON a.id = pa.ability_id
JOIN pokemon p ON p.id = pa.pokemon_id
WHERE p.name = 'garchomp';

-- Spot check: Earthquake should be learnable by Garchomp
SELECT * FROM pokemon_moves pm
JOIN pokemon p ON p.id = pm.pokemon_id
JOIN moves m ON m.id = pm.move_id
WHERE p.name = 'garchomp' AND m.name = 'earthquake';
```
