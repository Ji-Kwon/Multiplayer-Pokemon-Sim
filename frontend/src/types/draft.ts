export interface DraftPokemon {
  pokemon_id: number;
  nickname: string;
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
}
