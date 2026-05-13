'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // Truncates all user and battle tables with sequence resets.
  // Static data tables (types, pokemon, moves, etc.) are intentionally excluded
  // so they survive between test runs and only need to be seeded once.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION truncate_all_tables()
    RETURNS void AS $$
    BEGIN
      TRUNCATE TABLE
        battle_chat,
        battle_turns,
        battles,
        team_pokemon,
        teams,
        users
      RESTART IDENTITY CASCADE;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP FUNCTION IF EXISTS truncate_all_tables()`);
};
