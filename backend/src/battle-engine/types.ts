import type { RulesetConfig } from './ruleset.js'

export type { RulesetConfig }

// ---------------------------------------------------------------------------
// Primitive ID aliases
// ---------------------------------------------------------------------------

export type MoveId = number
export type AbilityId = number
export type ItemId = number
export type PlayerId = string

// ---------------------------------------------------------------------------
// Pokemon type
// ---------------------------------------------------------------------------

export type PokemonType =
  | 'normal' | 'fire' | 'water' | 'electric' | 'grass' | 'ice'
  | 'fighting' | 'poison' | 'ground' | 'flying' | 'psychic' | 'bug'
  | 'rock' | 'ghost' | 'dragon' | 'dark' | 'steel' | 'fairy'

// ---------------------------------------------------------------------------
// Battle phase
// ---------------------------------------------------------------------------

export type BattlePhase =
  | 'WAITING_FOR_PLAYERS'
  | 'TEAM_PREVIEW'
  | 'LEADING'
  | 'AWAITING_INPUT'
  | 'RESOLVING_TURN'
  | 'AWAITING_REPLACEMENT'
  | 'BATTLE_END'

// ---------------------------------------------------------------------------
// Status conditions
// ---------------------------------------------------------------------------

export type PrimaryStatus = 'burn' | 'paralysis' | 'sleep' | 'freeze' | 'poison' | 'toxic'

export type VolatileStatus =
  | 'confusion' | 'flinch' | 'infatuation' | 'leech-seed' | 'substitute'
  | 'taunt' | 'encore' | 'torment' | 'disable' | 'heal-block'
  | 'aqua-ring' | 'magnet-rise' | 'embargo' | 'ingrain' | 'power-trick'
  | 'curse' | 'nightmare' | 'perish-song' | 'trapped'

// ---------------------------------------------------------------------------
// Field types
// ---------------------------------------------------------------------------

export type Weather = 'sun' | 'rain' | 'sand' | 'snow' | 'harsh-sun' | 'heavy-rain' | 'strong-winds'

export type Terrain = 'electric' | 'grassy' | 'psychic' | 'misty'

// ---------------------------------------------------------------------------
// Ability hook points
// ---------------------------------------------------------------------------

export type HookPoint =
  | 'ON_SWITCH_IN'
  | 'ON_SWITCH_OUT'
  | 'ON_TURN_START'
  | 'PRE_MOVE'
  | 'PRE_MOVE_HIT'
  | 'ON_DAMAGE_CALC'
  | 'ON_HIT'
  | 'POST_MOVE'
  | 'END_OF_TURN'
  | 'ON_WEATHER'
  | 'ON_STAT_CHANGE'

// ---------------------------------------------------------------------------
// Turn log
// ---------------------------------------------------------------------------

export type LogEntryType =
  | 'move_use'
  | 'damage'
  | 'heal'
  | 'status'
  | 'stat_change'
  | 'faint'
  | 'switch'
  | 'weather'
  | 'terrain'
  | 'field_change'
  | 'side_condition'
  | 'volatile_start'
  | 'volatile_end'
  | 'protect'
  | 'miss'
  | 'immune'
  | 'no_effect'
  | 'critical_hit'
  | 'effectiveness'
  | 'ability_trigger'
  | 'item_trigger'
  | 'message'

export interface TurnLogEntry {
  type: LogEntryType
  sourceSlot?: number
  targetSlot?: number
  payload: Record<string, unknown>
  message: string
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface StatStages {
  atk: number   // -6 to +6
  def: number
  spa: number
  spd: number
  spe: number
  acc: number   // accuracy stages
  eva: number   // evasion stages
}

export interface ComputedStats {
  hp: number
  atk: number
  def: number
  spa: number
  spd: number
  spe: number
}

// ---------------------------------------------------------------------------
// Move PP tracking
// ---------------------------------------------------------------------------

export interface BattleMove {
  moveId: MoveId
  pp: number
  maxPp: number
  disabled: boolean
}

// ---------------------------------------------------------------------------
// Protect state
// ---------------------------------------------------------------------------

export interface ProtectState {
  variant:
    | 'protect'
    | 'detect'
    | 'kings-shield'
    | 'baneful-bunker'
    | 'spiky-shield'
    | 'silk-trap'
    | 'burning-bulwark'
    | 'endure'
    | 'max-guard'
    | 'wide-guard'
    | 'quick-guard'
  consecutiveUses: number
}

// ---------------------------------------------------------------------------
// Target resolution (used when a move needs to identify its hit destination)
// ---------------------------------------------------------------------------

export interface TargetInfo {
  sideIndex: 0 | 1
  slotIndex: number
}

// ---------------------------------------------------------------------------
// Side conditions (hazards, screens)
// ---------------------------------------------------------------------------

export type SideCondition =
  | { type: 'reflect'; turnsLeft: number }
  | { type: 'light-screen'; turnsLeft: number }
  | { type: 'aurora-veil'; turnsLeft: number }
  | { type: 'spikes'; layers: 1 | 2 | 3 }
  | { type: 'toxic-spikes'; layers: 1 | 2 }
  | { type: 'stealth-rock' }
  | { type: 'sticky-web' }

// ---------------------------------------------------------------------------
// Active slot
// ---------------------------------------------------------------------------

export interface ActiveSlot {
  partyIndex: number              // which party slot is in this active slot
  statStages: StatStages          // { atk, def, spa, spd, spe, acc, eva } each -6 to +6
  volatileStatuses: Set<VolatileStatus>
  volatileData: Map<string, unknown>  // keyed storage for volatile state (e.g. { 'substitute_hp': 45 })
  lastMoveUsed: MoveId | null
  lastMoveFailed: boolean
  mustRecharge: boolean           // after Hyper Beam etc.
  lockedMove: MoveId | null       // Outrage, Petal Dance, Thrash
  lockedMoveCounter: number
  choiceLockedMove: MoveId | null // Choice Band/Specs/Scarf lock
  encoreMoveId: MoveId | null
  encoreTurns: number
  attractedBy: number | null      // active slot index of the infatuator
  protectState: ProtectState | null
}

// ---------------------------------------------------------------------------
// Party pokemon
// ---------------------------------------------------------------------------

export interface PartyPokemon {
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
  hasMega: boolean                // holds a Mega Stone (for rulesets with mega evolution)
  isMega: boolean                 // has mega evolved this battle
}

// ---------------------------------------------------------------------------
// Side state
// ---------------------------------------------------------------------------

export interface SideState {
  playerId: string
  party: PartyPokemon[]           // full team of 6
  active: ActiveSlot[]            // length 1 (singles) or 2 (doubles)
  conditions: SideCondition[]     // reflect, light screen, aurora veil, spikes, etc.
  tailwindTurns: number
  trickRoomContributor: boolean   // did this side set trick room
}

// ---------------------------------------------------------------------------
// Field state
// ---------------------------------------------------------------------------

export interface FieldState {
  weather: Weather | null
  weatherTurns: number            // -1 = indefinite (set by ability)
  terrain: Terrain | null
  terrainTurns: number
  trickRoom: boolean
  trickRoomTurns: number
  gravity: boolean
  gravityTurns: number
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'move'; moveIndex: 0 | 1 | 2 | 3; targetSlot?: number; isTera?: boolean; isMega?: boolean; isZMove?: boolean }
  | { type: 'switch'; partyIndex: number; activeSlot?: number }  // activeSlot only for doubles
  | { type: 'forfeit' }

// ---------------------------------------------------------------------------
// Battle state
// ---------------------------------------------------------------------------

export interface BattleState {
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
