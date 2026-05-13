// Shapes returned by the backend REST API at /api/v1/

export interface User {
  id: string;
  email: string;
  username: string;
}

export interface TeamSummary {
  id: string;
  name: string;
  format: 'singles' | 'doubles';
  pokemon_count: number;
  updated_at: string;
}

export interface TeamPokemon {
  id: string;
  team_id: string;
  slot: number;
  pokemon_id: number;
  nickname: string | null;
  gender: 'male' | 'female' | 'unknown' | null;
  ability_id: number;
  item_id: number | null;
  nature_id: number;
  move1_id: number | null;
  move2_id: number | null;
  move3_id: number | null;
  move4_id: number | null;
  ev_hp: number;
  ev_atk: number;
  ev_def: number;
  ev_spa: number;
  ev_spd: number;
  ev_spe: number;
  iv_hp: number;
  iv_atk: number;
  iv_def: number;
  iv_spa: number;
  iv_spd: number;
  iv_spe: number;
  tera_type_id: number | null;
}

export interface Team {
  id: string;
  user_id: string;
  name: string;
  format: 'singles' | 'doubles';
  notes: string | null;
  created_at: string;
  updated_at: string;
  slots: (TeamPokemon | null)[];  // always length 6; null = empty slot
}

export interface PokemonSummary {
  id: number;
  name: string;
  form_name: string | null;
  type1: string;
  type2: string | null;
  sprite_url: string | null;
}

export interface PokemonDetail {
  id: number;
  name: string;
  form_name: string | null;
  base_form_id: number | null;
  type1: string;
  type2: string | null;
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
  weight_kg: number;
  sprite_url: string | null;
  sprite_shiny_url: string | null;
  is_legendary: boolean;
  is_mythical: boolean;
  generation: number;
  is_available: boolean;
}

export interface Move {
  id: number;
  name: string;
  type: string;
  category: 'physical' | 'special' | 'status';
  power: number | null;
  accuracy: number | null;
  pp: number;
  priority: number;
  learn_method: string;       // always present from /pokemon/:id/moves
  level_learned: number | null; // null for non-level-up methods
}

export interface Ability {
  id: number;
  name: string;
  effect_tag: string;
  description: string | null;
  slot: number;       // always present from /pokemon/:id/abilities
  is_hidden: boolean; // true when slot === 3
}

export interface Item {
  id: number;
  name: string;
  category: string;
  effect_tag: string | null;
  description: string | null;
}

export interface Nature {
  id: number;
  name: string;
  boosted_stat: string | null;
  reduced_stat: string | null;
}

// Request body shapes sent to the API

export interface CreateTeamBody {
  name: string;
  format: 'singles' | 'doubles';
}

export interface TeamPokemonSlot {
  slot: number;
  pokemon_id: number;
  nickname?: string | null;
  gender?: 'male' | 'female' | 'unknown' | null;
  ability_id: number;
  item_id?: number | null;
  nature_id: number;
  move1_id?: number | null;
  move2_id?: number | null;
  move3_id?: number | null;
  move4_id?: number | null;
  ev_hp?: number;
  ev_atk?: number;
  ev_def?: number;
  ev_spa?: number;
  ev_spd?: number;
  ev_spe?: number;
  iv_hp?: number;
  iv_atk?: number;
  iv_def?: number;
  iv_spa?: number;
  iv_spd?: number;
  iv_spe?: number;
  tera_type_id?: number | null;
}

export interface UpdateTeamBody {
  name?: string;
  format?: 'singles' | 'doubles';
  slots?: TeamPokemonSlot[];
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
