'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // Team queries
  pgm.createIndex('teams', 'user_id', { name: 'idx_teams_user_id' });
  pgm.createIndex('team_pokemon', 'team_id', { name: 'idx_team_pokemon_team_id' });

  // Learnset lookups (team builder autocomplete)
  pgm.createIndex('pokemon_moves', 'pokemon_id', { name: 'idx_pokemon_moves_pokemon_id' });
  pgm.createIndex('pokemon_moves', 'move_id', { name: 'idx_pokemon_moves_move_id' });
  pgm.createIndex('pokemon_abilities', 'pokemon_id', { name: 'idx_pokemon_abilities_pokemon_id' });

  // Battle lookups
  pgm.createIndex('battles', 'player1_id', { name: 'idx_battles_player1' });
  pgm.createIndex('battles', 'player2_id', { name: 'idx_battles_player2' });
  pgm.createIndex('battle_turns', 'battle_id', { name: 'idx_battle_turns_battle_id' });

  // Pokemon search
  pgm.createIndex('pokemon', 'name', { name: 'idx_pokemon_name' });
  pgm.createIndex('pokemon', 'is_available', {
    name: 'idx_pokemon_available',
    where: 'is_available = TRUE',
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropIndex('pokemon', 'is_available', { name: 'idx_pokemon_available', ifExists: true });
  pgm.dropIndex('pokemon', 'name', { name: 'idx_pokemon_name', ifExists: true });
  pgm.dropIndex('battle_turns', 'battle_id', { name: 'idx_battle_turns_battle_id', ifExists: true });
  pgm.dropIndex('battles', 'player2_id', { name: 'idx_battles_player2', ifExists: true });
  pgm.dropIndex('battles', 'player1_id', { name: 'idx_battles_player1', ifExists: true });
  pgm.dropIndex('pokemon_abilities', 'pokemon_id', { name: 'idx_pokemon_abilities_pokemon_id', ifExists: true });
  pgm.dropIndex('pokemon_moves', 'move_id', { name: 'idx_pokemon_moves_move_id', ifExists: true });
  pgm.dropIndex('pokemon_moves', 'pokemon_id', { name: 'idx_pokemon_moves_pokemon_id', ifExists: true });
  pgm.dropIndex('team_pokemon', 'team_id', { name: 'idx_team_pokemon_team_id', ifExists: true });
  pgm.dropIndex('teams', 'user_id', { name: 'idx_teams_user_id', ifExists: true });
};
