import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POKEAPI_BASE = (process.env.POKEAPI_BASE_URL ?? 'https://pokeapi.co/api/v2').replace(/\/$/, '');
const CACHE_DIR = path.join(__dirname, '.cache');
const CONCURRENCY = 20;
const BATCH_DELAY_MS = 50;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// File cache
// ---------------------------------------------------------------------------

fs.mkdirSync(CACHE_DIR, { recursive: true });

function cacheKey(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex') + '.json';
}

async function cachedFetch(url: string): Promise<unknown> {
  const file = path.join(CACHE_DIR, cacheKey(url));
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const data: unknown = await res.json();
  fs.writeFileSync(file, JSON.stringify(data));
  return data;
}

// ---------------------------------------------------------------------------
// Concurrency limiter (manual p-limit style to avoid ESM interop issues)
// ---------------------------------------------------------------------------

function makeLimit(max: number) {
  let running = 0;
  const queue: Array<() => void> = [];
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        running++;
        fn().then(resolve, reject).finally(() => {
          running--;
          if (queue.length > 0) queue.shift()!();
        });
      };
      if (running < max) run();
      else queue.push(run);
    });
  };
}

const limit = makeLimit(CONCURRENCY);

async function fetchAllConcurrent<T>(
  urls: string[],
  transform: (data: unknown, url: string) => T | null,
  label: string,
): Promise<T[]> {
  const results: T[] = [];
  let done = 0;
  const total = urls.length;
  const tasks = urls.map((url) =>
    limit(async () => {
      const data = await cachedFetch(url);
      const row = transform(data, url);
      if (row !== null) results.push(row);
      done++;
      if (done % 100 === 0 || done === total) process.stdout.write(`\r  ${label}: ${done}/${total}   `);
    }),
  );
  // The limiter controls concurrency; Promise.all starts all tasks but only CONCURRENCY run at once.
  // When hitting a live API we still respect rate limits via the limiter's natural throughput.
  await Promise.all(tasks);
  process.stdout.write('\n');
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractId(url: string): number {
  return parseInt(url.split('/').filter(Boolean).pop()!, 10);
}

function extractGenNumber(name: string): number {
  const map: Record<string, number> = {
    'generation-i': 1, 'generation-ii': 2, 'generation-iii': 3,
    'generation-iv': 4, 'generation-v': 5, 'generation-vi': 6,
    'generation-vii': 7, 'generation-viii': 8, 'generation-ix': 9,
  };
  return map[name] ?? 9;
}

function statName(apiStat: string): string {
  const map: Record<string, string> = {
    'attack': 'atk', 'defense': 'def', 'special-attack': 'spa',
    'special-defense': 'spd', 'speed': 'spe', 'hp': 'hp',
  };
  return map[apiStat] ?? apiStat;
}

// ---------------------------------------------------------------------------
// Resource list pagination
// ---------------------------------------------------------------------------

async function fetchResourceList(endpoint: string): Promise<Array<{ name: string; url: string }>> {
  const items: Array<{ name: string; url: string }> = [];
  let url: string | null = `${POKEAPI_BASE}/${endpoint}?limit=10000`;
  while (url) {
    const page = await cachedFetch(url) as { results: Array<{ name: string; url: string }>; next: string | null };
    items.push(...page.results);
    url = page.next;
  }
  return items;
}

// ---------------------------------------------------------------------------
// Upsert helpers
// ---------------------------------------------------------------------------

async function upsertMany(
  client: { query: Pool['query'] },
  table: string,
  columns: string[],
  rows: unknown[][],
  conflictCol: string,
  updateCols?: string[],
  chunkSize = 1000,
): Promise<void> {
  if (rows.length === 0) return;
  const CHUNK = chunkSize;
  const cols = updateCols ?? columns.filter((c) => c !== conflictCol);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const placeholders = chunk
      .map((row, ri) => {
        row.forEach((v) => values.push(v));
        return `(${row.map((_, ci) => `$${ri * columns.length + ci + 1}`).join(', ')})`;
      })
      .join(', ');
    const setClause = cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}
      ON CONFLICT (${conflictCol}) DO UPDATE SET ${setClause}`;
    await client.query(sql, values);
  }
}

// ---------------------------------------------------------------------------
// 1. Types
// ---------------------------------------------------------------------------

// PokeAPI includes shadow/unknown types we don't want
const SKIP_TYPE_NAMES = new Set(['shadow', 'unknown']);

interface PokeAPIType {
  id: number;
  name: string;
  damage_relations: {
    double_damage_to: Array<{ name: string; url: string }>;
    half_damage_to: Array<{ name: string; url: string }>;
    no_damage_to: Array<{ name: string; url: string }>;
  };
}

async function seedTypes(client: { query: Pool['query'] }): Promise<Map<string, number>> {
  console.log('Seeding types...');
  const list = await fetchResourceList('type');
  const nameToId = new Map<string, number>();

  // Fetch all type details
  const typeData: PokeAPIType[] = [];
  await fetchAllConcurrent(
    list.map((t) => t.url),
    (data) => {
      const t = data as PokeAPIType;
      if (SKIP_TYPE_NAMES.has(t.name)) return null;
      typeData.push(t);
      nameToId.set(t.name, t.id);
      return t;
    },
    'types',
  );

  // Filter to actual 18 battle types (id 1-18)
  const battleTypes = typeData.filter((t) => t.id >= 1 && t.id <= 18);
  await upsertMany(
    client,
    'types',
    ['id', 'name'],
    battleTypes.map((t) => [t.id, t.name]),
    'id',
    ['name'],
  );
  console.log(`  Inserted ${battleTypes.length} types`);

  // Build type_chart 18×18
  console.log('Seeding type_chart...');
  // Initialize all to 1.0
  const chartRows: Array<[number, number, number]> = [];
  for (const atk of battleTypes) {
    const mult = new Map<number, number>();
    for (const def of battleTypes) mult.set(def.id, 1.0);
    for (const rel of atk.damage_relations.double_damage_to) {
      const id = nameToId.get(rel.name);
      if (id && id >= 1 && id <= 18) mult.set(id, 2.0);
    }
    for (const rel of atk.damage_relations.half_damage_to) {
      const id = nameToId.get(rel.name);
      if (id && id >= 1 && id <= 18) mult.set(id, 0.5);
    }
    for (const rel of atk.damage_relations.no_damage_to) {
      const id = nameToId.get(rel.name);
      if (id && id >= 1 && id <= 18) mult.set(id, 0.0);
    }
    for (const [defId, m] of mult) {
      chartRows.push([atk.id, defId, m]);
    }
  }

  // type_chart has composite PK — handle conflict manually
  const CHUNK = 324; // all 324 rows fit in one query (3 params × 324 = 972)
  for (let i = 0; i < chartRows.length; i += CHUNK) {
    const chunk = chartRows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const placeholders = chunk
      .map((row, ri) => {
        row.forEach((v) => values.push(v));
        return `($${ri * 3 + 1}, $${ri * 3 + 2}, $${ri * 3 + 3})`;
      })
      .join(', ');
    await client.query(
      `INSERT INTO type_chart (attacker_type_id, defender_type_id, multiplier) VALUES ${placeholders}
       ON CONFLICT (attacker_type_id, defender_type_id) DO UPDATE SET multiplier = EXCLUDED.multiplier`,
      values,
    );
  }
  console.log(`  Inserted ${chartRows.length} type_chart rows`);

  return nameToId;
}

// ---------------------------------------------------------------------------
// 2. Natures
// ---------------------------------------------------------------------------

interface PokeAPINature {
  id: number;
  name: string;
  increased_stat: { name: string } | null;
  decreased_stat: { name: string } | null;
}

async function seedNatures(client: { query: Pool['query'] }): Promise<void> {
  console.log('Seeding natures...');
  const list = await fetchResourceList('nature');
  const rows: Array<[number, string, string | null, string | null]> = [];
  await fetchAllConcurrent(
    list.map((n) => n.url),
    (data) => {
      const n = data as PokeAPINature;
      rows.push([
        n.id,
        n.name,
        n.increased_stat ? statName(n.increased_stat.name) : null,
        n.decreased_stat ? statName(n.decreased_stat.name) : null,
      ]);
      return n;
    },
    'natures',
  );
  // Neutral natures boost and reduce the same stat — store as null
  const normalized = rows.map(([id, name, boost, reduce]) => [
    id,
    name,
    boost === reduce ? null : boost,
    boost === reduce ? null : reduce,
  ]);
  await upsertMany(client, 'natures', ['id', 'name', 'boosted_stat', 'reduced_stat'], normalized, 'id');
  console.log(`  Inserted ${normalized.length} natures`);
}

// ---------------------------------------------------------------------------
// 3. Move effects (hand-authored from specs/move-effects.md)
// ---------------------------------------------------------------------------

const MOVE_EFFECTS: Array<[number, string, string]> = [
  // Group 1 — Damage
  [1,  'DIRECT_DAMAGE',                     'Deal damage with no secondary effect'],
  [2,  'DAMAGE_RECOIL_QUARTER',              'Deal damage; user takes 1/4 of damage dealt as recoil'],
  [3,  'DAMAGE_RECOIL_THIRD',               'Deal damage; user takes 1/3 of damage dealt as recoil'],
  [4,  'DAMAGE_RECOIL_HALF',                'Deal damage; user takes 1/2 of damage dealt as recoil'],
  [5,  'DAMAGE_CRASH',                      'Miss = user takes floor(MaxHP/2) crash damage'],
  [6,  'DAMAGE_DRAIN_HALF',                 'Deal damage; restore 1/2 of damage dealt as HP'],
  [7,  'DAMAGE_DRAIN_THREE_QUARTERS',       'Deal damage; restore 3/4 of damage dealt as HP'],
  [8,  'DAMAGE_STATUS_CHANCE',              'Deal damage; roll effectChance% to inflict a primary status'],
  [9,  'DAMAGE_FLINCH_CHANCE',              'Deal damage; roll effectChance% to inflict flinch'],
  [10, 'DAMAGE_STAT_CHANGE_TARGET_CHANCE',  'Deal damage; roll effectChance% to lower target stat'],
  [11, 'DAMAGE_STAT_CHANGE_SELF',           'Deal damage; always lower user own stats'],
  [12, 'DAMAGE_STAT_BOOST_SELF_CHANCE',     'Deal damage; roll effectChance% to raise user stat'],
  [13, 'DAMAGE_SELF_STAT_BOOST_GUARANTEED', 'Deal damage; always raise user own stat'],
  [14, 'MULTI_HIT',                         'Hit 2-5 times; each hit rolls damage independently'],
  [15, 'MULTI_HIT_FIXED_2',                 'Always exactly 2 hits'],
  [16, 'MULTI_HIT_TRIPLE',                  'Always 3 hits with increasing power'],
  [17, 'TWO_TURN',                          'Turn 1: charge (possibly semi-invulnerable). Turn 2: attack'],
  [18, 'DAMAGE_FIXED',                      'Deal fixed damage regardless of stats'],
  [19, 'DAMAGE_LEVEL',                      'Damage equals user level'],
  [20, 'DAMAGE_HP_BASED',                   'Damage based on target current HP or user HP'],
  [21, 'OHKO',                              'One-hit KO if it hits'],
  [22, 'ALWAYS_CRIT',                       'Move always results in a critical hit'],
  [23, 'DAMAGE_SPREAD',                     'Hits all opponents with spread modifier if >1 target'],
  // Group 2 — Status-only
  [30, 'INFLICT_STATUS',                    'Inflict a primary status condition'],
  [31, 'INFLICT_CONFUSION',                 'Inflict confusion on target'],
  [32, 'INFLICT_INFATUATION',               'Inflict infatuation if opposite gender'],
  [33, 'LEECH_SEED',                        'Plant Leech Seed on target'],
  [34, 'PERISH_SONG',                       'All active Pokemon faint after 3 turns'],
  [35, 'YAWN',                              'Target falls asleep at end of next turn'],
  // Group 3 — Stat changes
  [40, 'STAT_CHANGE_SELF',                  'Change user own stats with no damage'],
  [41, 'STAT_CHANGE_TARGET',                'Lower target stats with no damage'],
  [42, 'STAT_CHANGE_BOTH',                  'Change stats on multiple targets simultaneously'],
  // Group 4 — Field effects
  [50, 'SET_WEATHER',                       'Set weather for 5 turns (8 with weather rock)'],
  [51, 'SET_TERRAIN',                       'Set terrain for 5 turns (8 with Terrain Extender)'],
  [52, 'SET_ROOM',                          'Set field room effect; toggle if already active'],
  [53, 'SET_TAILWIND',                      'Set Tailwind on user side for 4 turns'],
  [54, 'SET_GRAVITY',                       'Set Gravity on the field for 5 turns'],
  [55, 'SET_ENTRY_HAZARD',                  'Set entry hazard on opponent side'],
  [56, 'CLEAR_HAZARDS',                     'Remove entry hazards (Rapid Spin, Defog, Tidy Up, Court Change)'],
  [57, 'SET_SCREEN',                        'Set Reflect, Light Screen, or Aurora Veil on user side'],
  // Group 5 — Healing
  [60, 'HEAL_HALF',                         'Restore 1/2 of user max HP'],
  [61, 'HEAL_WEATHER_BASED',               'Restore HP based on weather (2/3 sun, 1/4 rain/sand/snow, 1/2 else)'],
  [62, 'HEAL_ROOST',                        'Restore 1/2 HP; user loses Flying type until end of turn'],
  [63, 'HEAL_WISH',                         'Sets Wish; restore 1/2 max HP to slot at end of next turn'],
  [64, 'HEAL_SHORE_UP',                     'Restore 1/2 HP normally, 2/3 HP in sand'],
  [65, 'HEAL_AQUA_RING',                    'Add aqua-ring volatile; restore 1/16 max HP each turn end'],
  [66, 'HEAL_ALLY',                         'Restore 1/2 HP to target ally (doubles only)'],
  [67, 'AROMATHERAPY_BELL',                 'Cure primary status of all party members'],
  [68, 'LUNAR_BLESSING',                    'Cure user and ally status; also restore 25% HP'],
  // Group 6 — Switching
  [70, 'PIVOT_SWITCH',                      'Deal damage then user switches out after move'],
  [71, 'BATON_PASS',                        'Switch user out passing stat stages and certain volatile statuses'],
  [72, 'PARTING_SHOT',                      'Lower target Atk and SpA by 1 then user switches'],
  [73, 'TELEPORT',                          'User switches out at lower priority'],
  [74, 'FORCE_SWITCH_TARGET',               'Force target to switch to a random benched Pokemon'],
  // Group 7 — Complex
  [80, 'PROTECT',                           'Protect user from all moves this turn; success rate halves on consecutive use'],
  [81, 'HELPING_HAND',                      'Boost partner move this turn by x1.5 (doubles only)'],
  [82, 'TRICK_SWAP_ITEM',                   'Swap held items between user and target'],
  [83, 'KNOCK_OFF',                         'Deal damage; remove target held item (x1.5 if removed)'],
  [84, 'TRANSFORM',                         'Copy target form: types, stats, abilities, moves'],
  [85, 'SUBSTITUTE',                        'Use 1/4 max HP to create a Substitute with that HP'],
  [86, 'FOCUS_ENERGY',                      'Increase crit ratio by +2 stages'],
  [87, 'ENCORE',                            'Force target to use their last-used move for 3 turns'],
  [88, 'DISABLE',                           'Disable target last-used move for 4 turns'],
  [89, 'TAUNT',                             'Target cannot use status moves for 3 turns'],
  [90, 'TORMENT',                           'Target cannot use the same move consecutively'],
  [91, 'EMBARGO',                           'Target cannot use held items for 5 turns'],
  [92, 'HEAL_BLOCK',                        'Target cannot use healing moves for 5 turns'],
  [93, 'FUTURE_SIGHT',                      'Deal Psychic-type damage to target 2 turns later'],
  [94, 'DESTINY_BOND',                      'If user faints this turn from a move, the attacker also faints'],
  [95, 'PAIN_SPLIT',                        'Set both user and target HP to average of their current HP'],
  [96, 'PSYCH_UP',                          'Copy target stat stages to user'],
  [97, 'HAZE',                              'Reset all stat stages for all active Pokemon to 0'],
  [98, 'AROMATHERAPY_SELF',                 'Cure user own status condition'],
  [99, 'INGRAIN',                           'Root user in place; restore 1/16 HP per turn'],
  [100, 'MAGNET_RISE',                      'User becomes immune to Ground-type moves for 5 turns'],
  [101, 'TELEKINESIS',                      'Target floats for 3 turns; immune to Ground, all moves auto-hit'],
  [102, 'WEATHER_BALL',                     'Type and power change based on active weather'],
  [103, 'NATURE_POWER',                     'Becomes a different move based on terrain'],
  [104, 'SLEEP_TALK',                       'While asleep, use a random move from user moveset'],
  [105, 'SNORE',                            'Only works while asleep; Normal-type 50 BP with 30% flinch'],
  [106, 'TRICK_ROOM_TOGGLE',               'Toggle Trick Room field effect'],
];

async function seedMoveEffects(client: { query: Pool['query'] }): Promise<void> {
  console.log('Seeding move_effects...');
  await upsertMany(
    client,
    'move_effects',
    ['effect_id', 'name', 'description'],
    MOVE_EFFECTS,
    'effect_id',
  );
  console.log(`  Inserted ${MOVE_EFFECTS.length} move_effects`);
}

// ---------------------------------------------------------------------------
// Effect ID lookup by effect_id name
// ---------------------------------------------------------------------------

const EFFECT_ID: Record<string, number> = Object.fromEntries(MOVE_EFFECTS.map(([id, name]) => [name, id]));

// ---------------------------------------------------------------------------
// 4. Abilities
// ---------------------------------------------------------------------------

interface PokeAPIAbility {
  id: number;
  name: string;
  effect_entries: Array<{ effect: string; short_effect: string; language: { name: string } }>;
}

async function seedAbilities(client: { query: Pool['query'] }): Promise<void> {
  console.log('Seeding abilities...');
  const list = await fetchResourceList('ability');
  const rows: Array<[number, string, string, string | null]> = [];
  await fetchAllConcurrent(
    list.map((a) => a.url),
    (data) => {
      const a = data as PokeAPIAbility;
      const desc = a.effect_entries.find((e) => e.language.name === 'en')?.short_effect ?? null;
      rows.push([a.id, a.name, a.name, desc]);
      return a;
    },
    'abilities',
  );
  await upsertMany(client, 'abilities', ['id', 'name', 'effect_tag', 'description'], rows, 'id');
  console.log(`  Inserted ${rows.length} abilities`);
}

// ---------------------------------------------------------------------------
// 5. Items
// ---------------------------------------------------------------------------

const ITEM_CATEGORIES_KEEP = new Set([
  'held-items', 'choice', 'plates', 'species-specific', 'type-enhancement',
  'mega-stones', 'z-crystals', 'jewels', 'berries', 'bad-held-items',
  'training', 'stat-boosts', 'in-a-pinch', 'picky-healing', 'type-protection',
  'baked-goods', 'effort-drop', 'other',
]);

interface PokeAPIItem {
  id: number;
  name: string;
  category: { name: string };
  effect_entries: Array<{ effect: string; short_effect: string; language: { name: string } }>;
}

interface PokeAPIBerry {
  natural_gift_type: { url: string } | null;
  natural_gift_power: number;
}

async function seedItems(client: { query: Pool['query'] }): Promise<void> {
  console.log('Seeding items...');
  const list = await fetchResourceList('item');

  const allItems: PokeAPIItem[] = [];
  await fetchAllConcurrent(
    list.map((i) => i.url),
    (data) => {
      const item = data as PokeAPIItem;
      allItems.push(item);
      return item;
    },
    'items (fetch)',
  );

  const filtered = allItems.filter((item) => ITEM_CATEGORIES_KEEP.has(item.category.name));
  console.log(`  Keeping ${filtered.length} items after category filter`);

  // For berries, fetch berry data
  const berryItems = filtered.filter((i) => i.category.name === 'berries');
  const berryMap = new Map<number, PokeAPIBerry>();

  // Build berry name→id lookup from berry list
  const berryList = await fetchResourceList('berry');
  const berryNameToId = new Map<string, number>();
  for (const b of berryList) {
    const berryId = extractId(b.url);
    // berry names in PokeAPI are like "cheri" while items are "cheri-berry"
    berryNameToId.set(b.name + '-berry', berryId);
  }

  const berryUrls = berryItems.map((item) => {
    const berryId = berryNameToId.get(item.name);
    return berryId ? `${POKEAPI_BASE}/berry/${berryId}` : null;
  }).filter(Boolean) as string[];

  await fetchAllConcurrent(
    berryUrls,
    (data, url) => {
      const b = data as PokeAPIBerry;
      // extract item id by reverse-mapping berry url's id to item
      const berryApiId = extractId(url);
      // find item with matching name
      const berryName = berryList.find((b2) => extractId(b2.url) === berryApiId)?.name + '-berry';
      const item = filtered.find((i) => i.name === berryName);
      if (item) berryMap.set(item.id, b);
      return b;
    },
    'berries (fetch)',
  );

  const rows = filtered.map((item) => {
    const berry = berryMap.get(item.id);
    const desc = item.effect_entries.find((e) => e.language.name === 'en')?.short_effect ?? null;
    const effectTag = item.name; // use name as effect_tag key; engine registry uses this
    const naturalGiftTypeId = berry?.natural_gift_type
      ? extractId(berry.natural_gift_type.url)
      : null;
    const naturalGiftPower = berry?.natural_gift_power ?? null;
    return [item.id, item.name, item.category.name, effectTag, naturalGiftTypeId, naturalGiftPower, desc];
  });

  await upsertMany(
    client,
    'items',
    ['id', 'name', 'category', 'effect_tag', 'natural_gift_type_id', 'natural_gift_power', 'description'],
    rows,
    'id',
  );
  console.log(`  Inserted ${rows.length} items`);
}

// ---------------------------------------------------------------------------
// 6. Pokemon
// ---------------------------------------------------------------------------

interface PokeAPIStats { base_stat: number; stat: { name: string } }
interface PokeAPITypeSlot { slot: number; type: { name: string; url: string } }
interface PokeAPIAbilitySlot { ability: { name: string; url: string }; is_hidden: boolean; slot: number }
interface PokeAPIMoveDetail {
  move: { name: string; url: string };
  version_group_details: Array<{
    level_learned_at: number;
    move_learn_method: { name: string };
    version_group: { name: string };
  }>;
}
interface PokeAPIPokemon {
  id: number;
  name: string;
  is_default: boolean;
  weight: number;
  sprites: { front_default: string | null; front_shiny: string | null };
  types: PokeAPITypeSlot[];
  stats: PokeAPIStats[];
  abilities: PokeAPIAbilitySlot[];
  moves: PokeAPIMoveDetail[];
  species: { url: string };
}
interface PokeAPISpecies {
  id: number;
  name: string;
  is_legendary: boolean;
  is_mythical: boolean;
  generation: { name: string };
  varieties: Array<{ is_default: boolean; pokemon: { name: string; url: string } }>;
}

function getStat(stats: PokeAPIStats[], name: string): number {
  return stats.find((s) => s.stat.name === name)?.base_stat ?? 0;
}

function spriteUrl(pokemon: PokeAPIPokemon): string {
  return (
    pokemon.sprites.front_default ??
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.id}.png`
  );
}

function spriteShinyUrl(pokemon: PokeAPIPokemon): string {
  return (
    pokemon.sprites.front_shiny ??
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${pokemon.id}.png`
  );
}

function extractFormName(pokemonName: string, speciesName: string): string | null {
  if (pokemonName === speciesName) return null;
  const suffix = pokemonName.slice(speciesName.length + 1); // strip "species-" prefix
  if (!suffix) return null;
  // Map raw PokeAPI suffixes to consistent form names
  const formMap: Record<string, string> = {
    'alola': 'alolan', 'galar': 'galarian', 'hisui': 'hisuian', 'paldea': 'paldean',
  };
  return formMap[suffix] ?? suffix;
}

async function seedPokemon(
  client: { query: Pool['query'] },
  typeNameToId: Map<string, number>,
): Promise<{ pokemonList: PokeAPIPokemon[]; speciesMap: Map<number, PokeAPISpecies> }> {
  console.log('Seeding pokemon (base forms)...');

  const pokemonList2 = await fetchResourceList('pokemon');
  // Also get species list for the species IDs
  const speciesList = await fetchResourceList('pokemon-species');

  // Fetch all pokemon details
  const allPokemon: PokeAPIPokemon[] = [];
  await fetchAllConcurrent(
    pokemonList2.map((p) => p.url),
    (data) => {
      const p = data as PokeAPIPokemon;
      allPokemon.push(p);
      return p;
    },
    'pokemon (fetch)',
  );

  // Fetch all species details
  const speciesMap = new Map<number, PokeAPISpecies>();
  await fetchAllConcurrent(
    speciesList.map((s) => s.url),
    (data) => {
      const s = data as PokeAPISpecies;
      speciesMap.set(s.id, s);
      return s;
    },
    'species (fetch)',
  );

  // Build species-name → base pokemon id map
  const speciesNameToBaseId = new Map<string, number>();
  for (const pokemon of allPokemon) {
    if (pokemon.is_default) {
      const speciesId = extractId(pokemon.species.url);
      const species = speciesMap.get(speciesId);
      if (species) speciesNameToBaseId.set(species.name, pokemon.id);
    }
  }

  // Pass 1: base forms (is_default = true)
  const baseForms = allPokemon.filter((p) => p.is_default);
  const baseRows = baseForms.map((p) => {
    const speciesId = extractId(p.species.url);
    const species = speciesMap.get(speciesId)!;
    const type1Id = typeNameToId.get(p.types.find((t) => t.slot === 1)!.type.name)!;
    const type2 = p.types.find((t) => t.slot === 2);
    const type2Id = type2 ? (typeNameToId.get(type2.type.name) ?? null) : null;
    return [
      p.id, p.name, null, null,
      type1Id, type2Id,
      getStat(p.stats, 'hp'), getStat(p.stats, 'attack'), getStat(p.stats, 'defense'),
      getStat(p.stats, 'special-attack'), getStat(p.stats, 'special-defense'), getStat(p.stats, 'speed'),
      p.weight / 10,
      spriteUrl(p), spriteShinyUrl(p),
      species?.is_legendary ?? false, species?.is_mythical ?? false,
      extractGenNumber(species?.generation?.name ?? 'generation-ix'),
      true,
    ];
  });

  await upsertMany(
    client,
    'pokemon',
    ['id', 'name', 'form_name', 'base_form_id',
     'type1_id', 'type2_id', 'hp', 'atk', 'def', 'spa', 'spd', 'spe',
     'weight_kg', 'sprite_url', 'sprite_shiny_url',
     'is_legendary', 'is_mythical', 'generation', 'is_available'],
    baseRows,
    'id',
  );
  console.log(`  Inserted ${baseRows.length} base-form pokemon`);

  // Pass 2: alternate forms (is_default = false)
  console.log('Seeding pokemon (alternate forms)...');
  const altForms = allPokemon.filter((p) => !p.is_default);
  const altRows: unknown[][] = [];
  for (const p of altForms) {
    const speciesId = extractId(p.species.url);
    const species = speciesMap.get(speciesId);
    const speciesName = species?.name ?? '';
    const formName = extractFormName(p.name, speciesName);
    const baseFormId = speciesNameToBaseId.get(speciesName) ?? null;
    const type1Slot = p.types.find((t) => t.slot === 1);
    if (!type1Slot) continue;
    const type1Id = typeNameToId.get(type1Slot.type.name);
    if (!type1Id) continue;
    const type2 = p.types.find((t) => t.slot === 2);
    const type2Id = type2 ? (typeNameToId.get(type2.type.name) ?? null) : null;
    altRows.push([
      p.id, p.name, formName, baseFormId,
      type1Id, type2Id,
      getStat(p.stats, 'hp'), getStat(p.stats, 'attack'), getStat(p.stats, 'defense'),
      getStat(p.stats, 'special-attack'), getStat(p.stats, 'special-defense'), getStat(p.stats, 'speed'),
      p.weight / 10,
      spriteUrl(p), spriteShinyUrl(p),
      species?.is_legendary ?? false, species?.is_mythical ?? false,
      extractGenNumber(species?.generation?.name ?? 'generation-ix'),
      true,
    ]);
  }
  if (altRows.length > 0) {
    await upsertMany(
      client,
      'pokemon',
      ['id', 'name', 'form_name', 'base_form_id',
       'type1_id', 'type2_id', 'hp', 'atk', 'def', 'spa', 'spd', 'spe',
       'weight_kg', 'sprite_url', 'sprite_shiny_url',
       'is_legendary', 'is_mythical', 'generation', 'is_available'],
      altRows,
      'id',
    );
  }
  console.log(`  Inserted ${altRows.length} alternate-form pokemon`);

  return { pokemonList: allPokemon, speciesMap };
}

// ---------------------------------------------------------------------------
// 7. Moves — effect ID mapping
// ---------------------------------------------------------------------------

interface PokeAPIMove {
  id: number;
  name: string;
  type: { name: string; url: string };
  damage_class: { name: string };
  power: number | null;
  accuracy: number | null;
  pp: number;
  priority: number;
  effect_chance: number | null;
  target: { name: string };
  meta: {
    category: { name: string } | null;
    ailment: { name: string } | null;
    drain: number;
    healing: number;
    stat_changes: Array<{ change: number; stat: { name: string } }>;
  } | null;
  contest_combos: unknown;
  learned_by_pokemon: Array<{ name: string; url: string }>;
  flags: Record<string, { name: string }> | undefined;
}

// Manual overrides: move name → effect_id
// These cover moves where PokeAPI meta doesn't cleanly map
const MOVE_EFFECT_OVERRIDES: Record<string, number> = {
  // Crash moves
  'high-jump-kick': EFFECT_ID.DAMAGE_CRASH,
  'jump-kick': EFFECT_ID.DAMAGE_CRASH,
  // Fixed damage
  'dragon-rage': EFFECT_ID.DAMAGE_FIXED,
  'sonic-boom': EFFECT_ID.DAMAGE_FIXED,
  'seismic-toss': EFFECT_ID.DAMAGE_LEVEL,
  'night-shade': EFFECT_ID.DAMAGE_LEVEL,
  // HP based
  'super-fang': EFFECT_ID.DAMAGE_HP_BASED,
  "nature's-madness": EFFECT_ID.DAMAGE_HP_BASED,
  'final-gambit': EFFECT_ID.DAMAGE_HP_BASED,
  'endeavor': EFFECT_ID.DAMAGE_HP_BASED,
  // OHKO
  'fissure': EFFECT_ID.OHKO,
  'guillotine': EFFECT_ID.OHKO,
  'horn-drill': EFFECT_ID.OHKO,
  'sheer-cold': EFFECT_ID.OHKO,
  // Always crit
  'frost-breath': EFFECT_ID.ALWAYS_CRIT,
  'storm-throw': EFFECT_ID.ALWAYS_CRIT,
  // Multi-hit
  'triple-kick': EFFECT_ID.MULTI_HIT_TRIPLE,
  'triple-axel': EFFECT_ID.MULTI_HIT_TRIPLE,
  'double-kick': EFFECT_ID.MULTI_HIT_FIXED_2,
  'bonemerang': EFFECT_ID.MULTI_HIT_FIXED_2,
  'dual-wingbeat': EFFECT_ID.MULTI_HIT_FIXED_2,
  'dragon-darts': EFFECT_ID.MULTI_HIT_FIXED_2,
  'double-hit': EFFECT_ID.MULTI_HIT_FIXED_2,
  'twineedle': EFFECT_ID.MULTI_HIT_FIXED_2,
  // Two-turn
  'fly': EFFECT_ID.TWO_TURN, 'dig': EFFECT_ID.TWO_TURN,
  'bounce': EFFECT_ID.TWO_TURN, 'dive': EFFECT_ID.TWO_TURN,
  'solar-beam': EFFECT_ID.TWO_TURN, 'solar-blade': EFFECT_ID.TWO_TURN,
  'sky-attack': EFFECT_ID.TWO_TURN, 'razor-wind': EFFECT_ID.TWO_TURN,
  'skull-bash': EFFECT_ID.TWO_TURN, 'phantom-force': EFFECT_ID.TWO_TURN,
  'shadow-force': EFFECT_ID.TWO_TURN, 'freeze-shock': EFFECT_ID.TWO_TURN,
  'ice-burn': EFFECT_ID.TWO_TURN, 'sky-drop': EFFECT_ID.TWO_TURN,
  // Stat-change self (guaranteed)
  'close-combat': EFFECT_ID.DAMAGE_STAT_CHANGE_SELF,
  'superpower': EFFECT_ID.DAMAGE_STAT_CHANGE_SELF,
  'draco-meteor': EFFECT_ID.DAMAGE_STAT_CHANGE_SELF,
  'overheat': EFFECT_ID.DAMAGE_STAT_CHANGE_SELF,
  'leaf-storm': EFFECT_ID.DAMAGE_STAT_CHANGE_SELF,
  'psycho-boost': EFFECT_ID.DAMAGE_STAT_CHANGE_SELF,
  'v-create': EFFECT_ID.DAMAGE_STAT_CHANGE_SELF,
  'bleakwind-storm': EFFECT_ID.DAMAGE_STAT_CHANGE_SELF,
  // Pivot
  'u-turn': EFFECT_ID.PIVOT_SWITCH, 'volt-switch': EFFECT_ID.PIVOT_SWITCH,
  'flip-turn': EFFECT_ID.PIVOT_SWITCH, 'chilly-reception': EFFECT_ID.PIVOT_SWITCH,
  // Baton Pass
  'baton-pass': EFFECT_ID.BATON_PASS,
  // Parting Shot
  'parting-shot': EFFECT_ID.PARTING_SHOT,
  // Teleport
  'teleport': EFFECT_ID.TELEPORT,
  // Force switch
  'roar': EFFECT_ID.FORCE_SWITCH_TARGET, 'whirlwind': EFFECT_ID.FORCE_SWITCH_TARGET,
  'dragon-tail': EFFECT_ID.FORCE_SWITCH_TARGET, 'circle-throw': EFFECT_ID.FORCE_SWITCH_TARGET,
  // Protect variants
  'protect': EFFECT_ID.PROTECT, 'detect': EFFECT_ID.PROTECT,
  'endure': EFFECT_ID.PROTECT, 'baneful-bunker': EFFECT_ID.PROTECT,
  'spiky-shield': EFFECT_ID.PROTECT, "king's-shield": EFFECT_ID.PROTECT,
  'silk-trap': EFFECT_ID.PROTECT, 'burning-bulwark': EFFECT_ID.PROTECT,
  'wide-guard': EFFECT_ID.PROTECT, 'quick-guard': EFFECT_ID.PROTECT,
  'mat-block': EFFECT_ID.PROTECT,
  // Field effects
  'helping-hand': EFFECT_ID.HELPING_HAND,
  'trick': EFFECT_ID.TRICK_SWAP_ITEM, 'switcheroo': EFFECT_ID.TRICK_SWAP_ITEM,
  'knock-off': EFFECT_ID.KNOCK_OFF,
  'transform': EFFECT_ID.TRANSFORM,
  'substitute': EFFECT_ID.SUBSTITUTE,
  'focus-energy': EFFECT_ID.FOCUS_ENERGY,
  'encore': EFFECT_ID.ENCORE,
  'disable': EFFECT_ID.DISABLE,
  'taunt': EFFECT_ID.TAUNT,
  'torment': EFFECT_ID.TORMENT,
  'embargo': EFFECT_ID.EMBARGO,
  'heal-block': EFFECT_ID.HEAL_BLOCK,
  'future-sight': EFFECT_ID.FUTURE_SIGHT,
  'doom-desire': EFFECT_ID.FUTURE_SIGHT,
  'destiny-bond': EFFECT_ID.DESTINY_BOND,
  'pain-split': EFFECT_ID.PAIN_SPLIT,
  'psych-up': EFFECT_ID.PSYCH_UP,
  'haze': EFFECT_ID.HAZE,
  'refresh': EFFECT_ID.AROMATHERAPY_SELF,
  'ingrain': EFFECT_ID.INGRAIN,
  'magnet-rise': EFFECT_ID.MAGNET_RISE,
  'telekinesis': EFFECT_ID.TELEKINESIS,
  'weather-ball': EFFECT_ID.WEATHER_BALL,
  'nature-power': EFFECT_ID.NATURE_POWER,
  'sleep-talk': EFFECT_ID.SLEEP_TALK,
  'snore': EFFECT_ID.SNORE,
  'trick-room': EFFECT_ID.TRICK_ROOM_TOGGLE,
  // Leech Seed / status
  'leech-seed': EFFECT_ID.LEECH_SEED,
  'perish-song': EFFECT_ID.PERISH_SONG,
  'yawn': EFFECT_ID.YAWN,
  'confuse-ray': EFFECT_ID.INFLICT_CONFUSION,
  'sweet-kiss': EFFECT_ID.INFLICT_CONFUSION,
  'supersonic': EFFECT_ID.INFLICT_CONFUSION,
  'swagger': EFFECT_ID.INFLICT_CONFUSION,
  'flatter': EFFECT_ID.INFLICT_CONFUSION,
  'attract': EFFECT_ID.INFLICT_INFATUATION,
  // Screens
  'reflect': EFFECT_ID.SET_SCREEN, 'light-screen': EFFECT_ID.SET_SCREEN,
  'aurora-veil': EFFECT_ID.SET_SCREEN,
  // Weather
  'sunny-day': EFFECT_ID.SET_WEATHER, 'rain-dance': EFFECT_ID.SET_WEATHER,
  'sandstorm': EFFECT_ID.SET_WEATHER, 'snowscape': EFFECT_ID.SET_WEATHER,
  'hail': EFFECT_ID.SET_WEATHER, 'chilly-reception-weather': EFFECT_ID.SET_WEATHER,
  // Terrain
  'electric-terrain': EFFECT_ID.SET_TERRAIN, 'grassy-terrain': EFFECT_ID.SET_TERRAIN,
  'psychic-terrain': EFFECT_ID.SET_TERRAIN, 'misty-terrain': EFFECT_ID.SET_TERRAIN,
  // Room
  'magic-room': EFFECT_ID.SET_ROOM, 'wonder-room': EFFECT_ID.SET_ROOM,
  // Tailwind / Gravity
  'tailwind': EFFECT_ID.SET_TAILWIND,
  'gravity': EFFECT_ID.SET_GRAVITY,
  // Hazards
  'stealth-rock': EFFECT_ID.SET_ENTRY_HAZARD, 'spikes': EFFECT_ID.SET_ENTRY_HAZARD,
  'toxic-spikes': EFFECT_ID.SET_ENTRY_HAZARD, 'sticky-web': EFFECT_ID.SET_ENTRY_HAZARD,
  // Clear hazards
  'rapid-spin': EFFECT_ID.CLEAR_HAZARDS, 'defog': EFFECT_ID.CLEAR_HAZARDS,
  'tidy-up': EFFECT_ID.CLEAR_HAZARDS, 'court-change': EFFECT_ID.CLEAR_HAZARDS,
  // Drain
  'giga-drain': EFFECT_ID.DAMAGE_DRAIN_HALF, 'mega-drain': EFFECT_ID.DAMAGE_DRAIN_HALF,
  'drain-punch': EFFECT_ID.DAMAGE_DRAIN_HALF, 'leech-life': EFFECT_ID.DAMAGE_DRAIN_HALF,
  'absorb': EFFECT_ID.DAMAGE_DRAIN_HALF, 'horn-leech': EFFECT_ID.DAMAGE_DRAIN_HALF,
  'parabolic-charge': EFFECT_ID.DAMAGE_DRAIN_HALF, 'strength-sap': EFFECT_ID.DAMAGE_DRAIN_HALF,
  'draining-kiss': EFFECT_ID.DAMAGE_DRAIN_THREE_QUARTERS,
  // Recoil
  'double-edge': EFFECT_ID.DAMAGE_RECOIL_QUARTER, 'submission': EFFECT_ID.DAMAGE_RECOIL_QUARTER,
  'brave-bird': EFFECT_ID.DAMAGE_RECOIL_THIRD, 'flare-blitz': EFFECT_ID.DAMAGE_RECOIL_THIRD,
  'volt-tackle': EFFECT_ID.DAMAGE_RECOIL_THIRD, 'wood-hammer': EFFECT_ID.DAMAGE_RECOIL_THIRD,
  'head-charge': EFFECT_ID.DAMAGE_RECOIL_THIRD, 'wild-charge': EFFECT_ID.DAMAGE_RECOIL_THIRD,
  'take-down': EFFECT_ID.DAMAGE_RECOIL_QUARTER, 'struggle': EFFECT_ID.DAMAGE_RECOIL_QUARTER,
  'head-smash': EFFECT_ID.DAMAGE_RECOIL_HALF,
  // Heal
  'recover': EFFECT_ID.HEAL_HALF, 'slack-off': EFFECT_ID.HEAL_HALF,
  'soft-boiled': EFFECT_ID.HEAL_HALF, 'milk-drink': EFFECT_ID.HEAL_HALF,
  'heal-order': EFFECT_ID.HEAL_HALF, 'rest': EFFECT_ID.HEAL_HALF,
  'moonlight': EFFECT_ID.HEAL_WEATHER_BASED, 'morning-sun': EFFECT_ID.HEAL_WEATHER_BASED,
  'synthesis': EFFECT_ID.HEAL_WEATHER_BASED,
  'roost': EFFECT_ID.HEAL_ROOST,
  'wish': EFFECT_ID.HEAL_WISH,
  'shore-up': EFFECT_ID.HEAL_SHORE_UP,
  'aqua-ring': EFFECT_ID.HEAL_AQUA_RING,
  'heal-pulse': EFFECT_ID.HEAL_ALLY,
  'heal-bell': EFFECT_ID.AROMATHERAPY_BELL, 'aromatherapy': EFFECT_ID.AROMATHERAPY_BELL,
  'lunar-blessing': EFFECT_ID.LUNAR_BLESSING,
  // Self stat-boost (status)
  'swords-dance': EFFECT_ID.STAT_CHANGE_SELF, 'nasty-plot': EFFECT_ID.STAT_CHANGE_SELF,
  'dragon-dance': EFFECT_ID.STAT_CHANGE_SELF, 'calm-mind': EFFECT_ID.STAT_CHANGE_SELF,
  'iron-defense': EFFECT_ID.STAT_CHANGE_SELF, 'amnesia': EFFECT_ID.STAT_CHANGE_SELF,
  'agility': EFFECT_ID.STAT_CHANGE_SELF, 'autotomize': EFFECT_ID.STAT_CHANGE_SELF,
  'bulk-up': EFFECT_ID.STAT_CHANGE_SELF, 'hone-claws': EFFECT_ID.STAT_CHANGE_SELF,
  'cotton-guard': EFFECT_ID.STAT_CHANGE_SELF, 'quiver-dance': EFFECT_ID.STAT_CHANGE_SELF,
  'shell-smash': EFFECT_ID.STAT_CHANGE_SELF, 'coil': EFFECT_ID.STAT_CHANGE_SELF,
  'growth': EFFECT_ID.STAT_CHANGE_SELF, 'charge': EFFECT_ID.STAT_CHANGE_SELF,
  'minimize': EFFECT_ID.STAT_CHANGE_SELF, 'curse': EFFECT_ID.STAT_CHANGE_SELF,
  'cosmic-power': EFFECT_ID.STAT_CHANGE_SELF, 'geomancy': EFFECT_ID.STAT_CHANGE_SELF,
  'power-trick': EFFECT_ID.STAT_CHANGE_SELF, 'acupressure': EFFECT_ID.STAT_CHANGE_SELF,
  'stockpile': EFFECT_ID.STAT_CHANGE_SELF,
  // Target stat drop
  'growl': EFFECT_ID.STAT_CHANGE_TARGET, 'leer': EFFECT_ID.STAT_CHANGE_TARGET,
  'charm': EFFECT_ID.STAT_CHANGE_TARGET, 'baby-doll-eyes': EFFECT_ID.STAT_CHANGE_TARGET,
  'fake-tears': EFFECT_ID.STAT_CHANGE_TARGET, 'metal-sound': EFFECT_ID.STAT_CHANGE_TARGET,
  'screech': EFFECT_ID.STAT_CHANGE_TARGET, 'string-shot': EFFECT_ID.STAT_CHANGE_TARGET,
  'snarl': EFFECT_ID.STAT_CHANGE_TARGET, 'tickle': EFFECT_ID.STAT_CHANGE_TARGET,
  'noble-roar': EFFECT_ID.STAT_CHANGE_TARGET, 'spicy-extract': EFFECT_ID.STAT_CHANGE_TARGET,
  // Inflict status (pure)
  'thunder-wave': EFFECT_ID.INFLICT_STATUS, 'will-o-wisp': EFFECT_ID.INFLICT_STATUS,
  'toxic': EFFECT_ID.INFLICT_STATUS, 'spore': EFFECT_ID.INFLICT_STATUS,
  'sleep-powder': EFFECT_ID.INFLICT_STATUS, 'glare': EFFECT_ID.INFLICT_STATUS,
  'stun-spore': EFFECT_ID.INFLICT_STATUS, 'hypnosis': EFFECT_ID.INFLICT_STATUS,
  'sing': EFFECT_ID.INFLICT_STATUS, 'nuzzle': EFFECT_ID.INFLICT_STATUS,
  'dark-void': EFFECT_ID.INFLICT_STATUS, 'lovely-kiss': EFFECT_ID.INFLICT_STATUS,
  'poison-powder': EFFECT_ID.INFLICT_STATUS,
  // Self stat boost on damage
  'power-up-punch': EFFECT_ID.DAMAGE_SELF_STAT_BOOST_GUARANTEED,
  'charge-beam': EFFECT_ID.DAMAGE_STAT_BOOST_SELF_CHANCE,
  'meteor-mash': EFFECT_ID.DAMAGE_STAT_BOOST_SELF_CHANCE,
};

function resolveEffectId(move: PokeAPIMove): number {
  // Check manual overrides first
  const override = MOVE_EFFECT_OVERRIDES[move.name];
  if (override !== undefined) return override;

  const category = move.meta?.category?.name ?? 'damage';
  const ailment = move.meta?.ailment?.name ?? 'none';
  const drain = move.meta?.drain ?? 0;
  const healing = move.meta?.healing ?? 0;
  const statChanges = move.meta?.stat_changes ?? [];
  const damageClass = move.damage_class.name; // 'physical', 'special', 'status'

  // Status moves
  if (damageClass === 'status') {
    if (healing > 0) return EFFECT_ID.HEAL_HALF;
    if (ailment !== 'none' && ailment !== 'unknown') return EFFECT_ID.INFLICT_STATUS;
    if (statChanges.length > 0) {
      const allNegative = statChanges.every((sc) => sc.change < 0);
      const allSelfBoosting = statChanges.every((sc) => sc.change > 0);
      if (allSelfBoosting) return EFFECT_ID.STAT_CHANGE_SELF;
      if (allNegative) return EFFECT_ID.STAT_CHANGE_TARGET;
      return EFFECT_ID.STAT_CHANGE_SELF; // mixed (shell smash etc)
    }
    return EFFECT_ID.DIRECT_DAMAGE; // fallback — should be caught by overrides
  }

  // Damage moves
  if (drain < 0) return EFFECT_ID.DAMAGE_RECOIL_THIRD; // default recoil
  if (drain > 0) return EFFECT_ID.DAMAGE_DRAIN_HALF;

  if (statChanges.length > 0) {
    const targetsself = statChanges.every((sc) => sc.change < 0);
    if (targetsself) return EFFECT_ID.DAMAGE_STAT_CHANGE_SELF;
    return EFFECT_ID.DAMAGE_STAT_CHANGE_TARGET_CHANCE;
  }

  if (ailment !== 'none' && ailment !== 'unknown') return EFFECT_ID.DAMAGE_STATUS_CHANCE;

  if (category === 'ailment') return EFFECT_ID.INFLICT_STATUS;
  if (category === 'net-good-stats') return EFFECT_ID.STAT_CHANGE_SELF;
  if (category === 'heal') return EFFECT_ID.HEAL_HALF;
  if (category === 'damage+raise') return EFFECT_ID.DAMAGE_STAT_BOOST_SELF_CHANCE;
  if (category === 'damage+lower') return EFFECT_ID.DAMAGE_STAT_CHANGE_TARGET_CHANCE;
  if (category === 'damage+ailment') return EFFECT_ID.DAMAGE_STATUS_CHANCE;
  if (category === 'damage+heal') return EFFECT_ID.DAMAGE_DRAIN_HALF;
  if (category === 'whole-field-effect') return EFFECT_ID.SET_WEATHER;
  if (category === 'field-effect') return EFFECT_ID.SET_ENTRY_HAZARD;
  if (category === 'force-switch') return EFFECT_ID.FORCE_SWITCH_TARGET;
  if (category === 'unique') return EFFECT_ID.DIRECT_DAMAGE;

  return EFFECT_ID.DIRECT_DAMAGE;
}

async function seedMoves(
  client: { query: Pool['query'] },
  typeNameToId: Map<string, number>,
): Promise<void> {
  console.log('Seeding moves...');
  const list = await fetchResourceList('move');
  const rows: unknown[][] = [];

  await fetchAllConcurrent(
    list.map((m) => m.url),
    (data) => {
      const m = data as PokeAPIMove;
      const typeId = typeNameToId.get(m.type.name);
      if (!typeId) return null;

      const category = m.damage_class.name;
      if (!['physical', 'special', 'status'].includes(category)) return null;

      // Parse flags from PokeAPI flags object (if present)
      const flags = (m as unknown as { flags?: Record<string, unknown> }).flags ?? {};
      const flagNames = Object.keys(flags);

      const effectId = resolveEffectId(m);

      rows.push([
        m.id, m.name, typeId, category,
        m.power ?? null, m.accuracy ?? null, m.pp, m.priority,
        effectId, m.effect_chance ?? null,
        m.target?.name ?? 'selected-pokemon',
        flagNames.includes('contact'), flagNames.includes('sound'),
        flagNames.includes('punch'), flagNames.includes('bite'),
        flagNames.includes('pulse'), flagNames.includes('ballistics'),
        flagNames.includes('powder'), flagNames.includes('dance'),
        flagNames.includes('wind'),
        // has_recoil / has_drain — derive from meta
        (m.meta?.drain ?? 0) < 0,
        (m.meta?.drain ?? 0) > 0,
        '{}', // flags JSONB — extended flags can be added later
      ]);
      return m;
    },
    'moves',
  );

  await upsertMany(
    client,
    'moves',
    [
      'id', 'name', 'type_id', 'category',
      'power', 'accuracy', 'pp', 'priority',
      'effect_id', 'effect_chance', 'target',
      'is_contact', 'is_sound', 'is_punch', 'is_bite',
      'is_pulse', 'is_bomb', 'is_powder', 'is_dance', 'is_wind',
      'has_recoil', 'has_drain', 'flags',
    ],
    rows,
    'id',
  );
  console.log(`  Inserted ${rows.length} moves`);
}

// ---------------------------------------------------------------------------
// 8. Pokemon abilities (linking)
// ---------------------------------------------------------------------------

async function seedPokemonAbilities(
  client: { query: Pool['query'] },
  pokemonList: PokeAPIPokemon[],
): Promise<void> {
  console.log('Seeding pokemon_abilities...');

  // Fetch all ability IDs so we can cross-reference by name
  const abilityList = await fetchResourceList('ability');
  const abilityNameToId = new Map<string, number>();
  for (const a of abilityList) {
    abilityNameToId.set(a.name, extractId(a.url));
  }

  const rows: Array<[number, number, number]> = [];
  for (const p of pokemonList) {
    for (const slot of p.abilities) {
      const abilityId = abilityNameToId.get(slot.ability.name) ?? extractId(slot.ability.url);
      const slotNum: 1 | 2 | 3 = slot.is_hidden ? 3 : (slot.slot as 1 | 2);
      rows.push([p.id, abilityId, slotNum]);
    }
  }

  // pokemon_abilities has composite PK (pokemon_id, ability_id)
  const CHUNK = 2000; // 3 params × 2000 = 6000 — well within pg limit of 65535
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const placeholders = chunk
      .map((row, ri) => {
        row.forEach((v) => values.push(v));
        return `($${ri * 3 + 1}, $${ri * 3 + 2}, $${ri * 3 + 3})`;
      })
      .join(', ');
    await client.query(
      `INSERT INTO pokemon_abilities (pokemon_id, ability_id, slot) VALUES ${placeholders}
       ON CONFLICT (pokemon_id, ability_id) DO UPDATE SET slot = EXCLUDED.slot`,
      values,
    );
    if (i % 5000 === 0) process.stdout.write(`\r  pokemon_abilities: ${Math.min(i + CHUNK, rows.length)}/${rows.length}   `);
  }
  process.stdout.write('\n');
  console.log(`  Inserted ${rows.length} pokemon_abilities rows`);
}

// ---------------------------------------------------------------------------
// 9. Pokemon moves (linking) — scarlet-violet learnset only
// ---------------------------------------------------------------------------

const SV_VERSION_GROUPS = new Set(['scarlet-violet']);

async function seedPokemonMoves(
  client: { query: Pool['query'] },
  pokemonList: PokeAPIPokemon[],
): Promise<void> {
  console.log('Seeding pokemon_moves...');

  // Fetch move name→id mapping
  const moveList = await fetchResourceList('move');
  const moveNameToId = new Map<string, number>();
  for (const m of moveList) {
    moveNameToId.set(m.name, extractId(m.url));
  }

  const rows: Array<[number, number, string, number | null]> = [];
  for (const p of pokemonList) {
    for (const moveEntry of p.moves) {
      const moveId = moveNameToId.get(moveEntry.move.name) ?? extractId(moveEntry.move.url);
      for (const vgd of moveEntry.version_group_details) {
        if (!SV_VERSION_GROUPS.has(vgd.version_group.name)) continue;
        const method = vgd.move_learn_method.name;
        // Normalize learn method to our supported values
        const learnMethod = normalizeLearnMethod(method);
        const level = method === 'level-up' ? (vgd.level_learned_at || null) : null;
        rows.push([p.id, moveId, learnMethod, level]);
      }
    }
  }

  // Deduplicate — same (pokemon_id, move_id, learn_method) combo
  const seen = new Set<string>();
  const dedupedRows = rows.filter(([pid, mid, method]) => {
    const key = `${pid}:${mid}:${method}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // pokemon_moves has composite PK (pokemon_id, move_id, learn_method)
  const CHUNK = 2000; // 4 params × 2000 = 8000 — well within pg limit of 65535
  for (let i = 0; i < dedupedRows.length; i += CHUNK) {
    const chunk = dedupedRows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const placeholders = chunk
      .map((row, ri) => {
        row.forEach((v) => values.push(v));
        return `($${ri * 4 + 1}, $${ri * 4 + 2}, $${ri * 4 + 3}, $${ri * 4 + 4})`;
      })
      .join(', ');
    await client.query(
      `INSERT INTO pokemon_moves (pokemon_id, move_id, learn_method, level_learned) VALUES ${placeholders}
       ON CONFLICT (pokemon_id, move_id, learn_method) DO UPDATE SET level_learned = EXCLUDED.level_learned`,
      values,
    );
    if (i % 10000 === 0) process.stdout.write(`\r  pokemon_moves: ${Math.min(i + CHUNK, dedupedRows.length)}/${dedupedRows.length}   `);
  }
  process.stdout.write('\n');
  console.log(`  Inserted ${dedupedRows.length} pokemon_moves rows`);
}

function normalizeLearnMethod(method: string): string {
  const map: Record<string, string> = {
    'level-up': 'level-up',
    'machine': 'tm',
    'tutor': 'tutor',
    'egg': 'egg',
    'reminder': 'reminder',
    'light-ball-egg': 'egg',
    'form-change': 'reminder',
    'zygarde-cube': 'tutor',
  };
  return map[method] ?? 'reminder';
}

// ---------------------------------------------------------------------------
// 10. Pokemon forms (mega evolutions etc.)
// ---------------------------------------------------------------------------

// Mega stone name → species base name
// Each entry: megaStoneName → speciesName
const MEGA_STONE_MAP: Record<string, string> = {
  'venusaurite': 'venusaur', 'charizardite-x': 'charizard', 'charizardite-y': 'charizard',
  'blastoisinite': 'blastoise', 'beedrillite': 'beedrill', 'pidgeotite': 'pidgeot',
  'alakazite': 'alakazam', 'slowbronite': 'slowbro', 'gengarite': 'gengar',
  'kangaskhanite': 'kangaskhan', 'pinsirite': 'pinsir', 'gyaradosite': 'gyarados',
  'aerodactylite': 'aerodactyl', 'mewtwonite-x': 'mewtwo', 'mewtwonite-y': 'mewtwo',
  'ampharosite': 'ampharos', 'steelixite': 'steelix', 'scizorite': 'scizor',
  'heracronite': 'heracross', 'houndoominite': 'houndoom', 'manectite': 'manectric',
  'sharpedonite': 'sharpedo', 'cameruptite': 'camerupt', 'altarianite': 'altaria',
  'banettite': 'banette', 'absolite': 'absol', 'glalitite': 'glalie',
  'salamencite': 'salamence', 'metagrossite': 'metagross', 'latiasite': 'latias',
  'latiosite': 'latios', 'lopunnite': 'lopunny', 'garchompite': 'garchomp',
  'lucarionite': 'lucario', 'abomasite': 'abomasnow', 'galladite': 'gallade',
  'audinite': 'audino', 'mawilite': 'mawile', 'aggronite': 'aggron',
  'medichamite': 'medicham', 'gardevoirite': 'gardevoir', 'sablenite': 'sableye',
  'tyranitarite': 'tyranitar', 'diancite': 'diancie', 'swampertite': 'swampert',
  'sceptilite': 'sceptile', 'blazikenite': 'blaziken',
};

async function seedPokemonForms(
  client: { query: Pool['query'] },
): Promise<void> {
  console.log('Seeding pokemon_forms...');

  // Fetch existing pokemon names and IDs
  const result = await client.query<{ id: number; name: string }>('SELECT id, name FROM pokemon');
  const pokemonNameToId = new Map<string, number>();
  for (const row of result.rows) {
    pokemonNameToId.set(row.name, row.id);
  }

  // Fetch item name → id mapping (for mega stones)
  const itemResult = await client.query<{ id: number; name: string }>('SELECT id, name FROM items');
  const itemNameToId = new Map<string, number>();
  for (const row of itemResult.rows) {
    itemNameToId.set(row.name, row.id);
  }

  const rows: Array<[number, number, string, number | null]> = [];

  // Process mega stones from the map
  for (const [stoneName, speciesName] of Object.entries(MEGA_STONE_MAP)) {
    const baseId = pokemonNameToId.get(speciesName);
    if (!baseId) continue;

    // Find the mega form pokemon (e.g., 'charizard-mega-x', 'charizard-mega')
    const stoneHandle = stoneName.replace('ite', '').replace('-x', '-x').replace('-y', '-y');
    let formPokemonId: number | undefined;

    // Try common naming patterns
    const candidates = [
      `${speciesName}-mega`,
      `${speciesName}-mega-x`,
      `${speciesName}-mega-y`,
    ];
    // For stones like charizardite-x → charizard-mega-x
    if (stoneName.endsWith('-x')) {
      formPokemonId = pokemonNameToId.get(`${speciesName}-mega-x`);
    } else if (stoneName.endsWith('-y')) {
      formPokemonId = pokemonNameToId.get(`${speciesName}-mega-y`);
    } else {
      formPokemonId = pokemonNameToId.get(`${speciesName}-mega`);
    }

    if (!formPokemonId) continue;

    const stoneItemId = itemNameToId.get(stoneName) ?? null;
    const trigger = stoneName.endsWith('-x') ? 'mega' : stoneName.endsWith('-y') ? 'mega' : 'mega';

    // Use base_pokemon_id + trigger as unique key — but charizard has two megas
    // The UNIQUE constraint is (base_pokemon_id, trigger) — so for charizard we can only store one per trigger
    // We use a different trigger name for x/y variants
    const triggerName = stoneName.endsWith('-x') ? 'mega-x' : stoneName.endsWith('-y') ? 'mega-y' : 'mega';
    rows.push([baseId, formPokemonId, triggerName, stoneItemId]);
    void stoneHandle; // suppress unused warning
  }

  // Insert pokemon_forms
  for (const row of rows) {
    await client.query(
      `INSERT INTO pokemon_forms (base_pokemon_id, form_pokemon_id, trigger, required_item_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (base_pokemon_id, trigger) DO UPDATE
         SET form_pokemon_id = EXCLUDED.form_pokemon_id,
             required_item_id = EXCLUDED.required_item_id`,
      row,
    );
  }
  console.log(`  Inserted ${rows.length} pokemon_forms rows`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== PokeAPI Import Pipeline ===');
  console.log(`  Base URL: ${POKEAPI_BASE}`);
  console.log(`  Cache:    ${CACHE_DIR}`);
  console.log(`  DB:       ${process.env.DATABASE_URL}`);
  console.log('');

  const client = pool;

  try {
    const typeNameToId = await seedTypes(client);
    await seedNatures(client);
    await seedMoveEffects(client);
    await seedAbilities(client);
    await seedItems(client);
    const { pokemonList, speciesMap: _speciesMap } = await seedPokemon(client, typeNameToId);
    await seedMoves(client, typeNameToId);
    await seedPokemonAbilities(client, pokemonList);
    await seedPokemonMoves(client, pokemonList);
    await seedPokemonForms(client);

    console.log('\n=== Validation ===');
    const checks = await Promise.all([
      client.query<{ count: string }>('SELECT COUNT(*)::text FROM pokemon'),
      client.query<{ count: string }>('SELECT COUNT(*)::text FROM moves'),
      client.query<{ count: string }>('SELECT COUNT(*)::text FROM type_chart'),
      client.query<{ count: string }>('SELECT COUNT(*)::text FROM natures'),
      client.query<{ count: string }>('SELECT COUNT(*)::text FROM move_effects'),
      client.query<{ count: string }>('SELECT COUNT(*)::text FROM moves WHERE effect_id IS NULL'),
    ]);
    console.log(`  pokemon:      ${checks[0].rows[0].count}`);
    console.log(`  moves:        ${checks[1].rows[0].count}`);
    console.log(`  type_chart:   ${checks[2].rows[0].count}`);
    console.log(`  natures:      ${checks[3].rows[0].count}`);
    console.log(`  move_effects: ${checks[4].rows[0].count}`);
    console.log(`  moves NULL effect_id: ${checks[5].rows[0].count}`);

    // Garchomp spot checks
    const garchompAbilities = await client.query(
      `SELECT a.name, pa.slot FROM pokemon_abilities pa
       JOIN abilities a ON a.id = pa.ability_id
       JOIN pokemon p ON p.id = pa.pokemon_id
       WHERE p.name = 'garchomp'`,
    );
    console.log(`  Garchomp abilities (expect 3): ${garchompAbilities.rowCount}`);
    garchompAbilities.rows.forEach((r: { name: string; slot: number }) =>
      console.log(`    slot ${r.slot}: ${r.name}`),
    );

    const garchompEQ = await client.query(
      `SELECT pm.learn_method FROM pokemon_moves pm
       JOIN pokemon p ON p.id = pm.pokemon_id
       JOIN moves m ON m.id = pm.move_id
       WHERE p.name = 'garchomp' AND m.name = 'earthquake'`,
    );
    console.log(`  Garchomp can learn Earthquake (expect ≥1): ${garchompEQ.rowCount}`);

    console.log('\n=== Import complete ===');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
