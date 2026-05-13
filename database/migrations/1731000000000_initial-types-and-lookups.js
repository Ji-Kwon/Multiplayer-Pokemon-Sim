'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE types (
      id   SMALLINT PRIMARY KEY,
      name VARCHAR(16) NOT NULL UNIQUE
    )
  `);

  pgm.sql(`
    CREATE TABLE type_chart (
      attacker_type_id SMALLINT NOT NULL REFERENCES types(id),
      defender_type_id SMALLINT NOT NULL REFERENCES types(id),
      multiplier       REAL NOT NULL,
      PRIMARY KEY (attacker_type_id, defender_type_id)
    )
  `);

  pgm.sql(`
    CREATE TABLE natures (
      id           SMALLINT PRIMARY KEY,
      name         VARCHAR(16) NOT NULL UNIQUE,
      boosted_stat VARCHAR(8),
      reduced_stat VARCHAR(8)
    )
  `);

  pgm.sql(`
    CREATE TABLE move_effects (
      effect_id   INTEGER PRIMARY KEY,
      name        VARCHAR(64) NOT NULL UNIQUE,
      description TEXT
    )
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('move_effects', { cascade: true });
  pgm.dropTable('natures', { cascade: true });
  pgm.dropTable('type_chart', { cascade: true });
  pgm.dropTable('types', { cascade: true });
};
