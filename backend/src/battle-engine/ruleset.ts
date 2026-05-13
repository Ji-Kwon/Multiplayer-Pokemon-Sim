export interface RulesetConfig {
  name: string
  gimmick: 'tera' | 'mega' | 'zmove' | 'dynamax' | 'none'
  bringCount: number              // how many pokemon each player selects to bring into battle
  activeCount: 1 | 2             // 1 for singles, 2 for doubles
  timerSeconds: number
  legalPokemon: Set<number>       // dex IDs; empty Set = all legal
  legalItems: Set<number>
  clauseList: string[]            // e.g. ['sleep-clause', 'species-clause']
}

export const GEN9_VGC_2025: RulesetConfig = {
  name: 'Gen9VGC2025',
  gimmick: 'tera',
  bringCount: 4,
  activeCount: 2,
  timerSeconds: 420,
  legalPokemon: new Set(),
  legalItems: new Set(),
  clauseList: ['species-clause'],
}
