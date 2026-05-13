'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE abilities (
      id          INTEGER PRIMARY KEY,
      name        VARCHAR(64) NOT NULL UNIQUE,
      effect_tag  VARCHAR(64) NOT NULL,
      description TEXT
    )
  `);

  pgm.sql(`
    CREATE TABLE items (
      id                   INTEGER PRIMARY KEY,
      name                 VARCHAR(64) NOT NULL UNIQUE,
      category             VARCHAR(32) NOT NULL,
      effect_tag           VARCHAR(64),
      natural_gift_type_id SMALLINT REFERENCES types(id),
      natural_gift_power   SMALLINT,
      description          TEXT
    )
  `);

  pgm.sql(`
    CREATE TABLE pokemon (
      id               INTEGER PRIMARY KEY,
      name             VARCHAR(64) NOT NULL,
      form_name        VARCHAR(64),
      base_form_id     INTEGER REFERENCES pokemon(id),
      type1_id         SMALLINT NOT NULL REFERENCES types(id),
      type2_id         SMALLINT REFERENCES types(id),
      hp               SMALLINT NOT NULL,
      atk              SMALLINT NOT NULL,
      def              SMALLINT NOT NULL,
      spa              SMALLINT NOT NULL,
      spd              SMALLINT NOT NULL,
      spe              SMALLINT NOT NULL,
      weight_kg        REAL NOT NULL,
      sprite_url       TEXT,
      sprite_shiny_url TEXT,
      is_legendary     BOOLEAN NOT NULL DEFAULT FALSE,
      is_mythical      BOOLEAN NOT NULL DEFAULT FALSE,
      generation       SMALLINT NOT NULL,
      is_available     BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);

  pgm.sql(`
    CREATE TABLE moves (
      id            INTEGER PRIMARY KEY,
      name          VARCHAR(64) NOT NULL UNIQUE,
      type_id       SMALLINT NOT NULL REFERENCES types(id),
      category      VARCHAR(8) NOT NULL CHECK (category IN ('physical','special','status')),
      power         SMALLINT,
      accuracy      SMALLINT,
      pp            SMALLINT NOT NULL,
      priority      SMALLINT NOT NULL DEFAULT 0,
      effect_id     INTEGER NOT NULL REFERENCES move_effects(effect_id),
      effect_chance SMALLINT,
      target        VARCHAR(32) NOT NULL,
      is_contact    BOOLEAN NOT NULL DEFAULT FALSE,
      is_sound      BOOLEAN NOT NULL DEFAULT FALSE,
      is_punch      BOOLEAN NOT NULL DEFAULT FALSE,
      is_bite       BOOLEAN NOT NULL DEFAULT FALSE,
      is_pulse      BOOLEAN NOT NULL DEFAULT FALSE,
      is_bomb       BOOLEAN NOT NULL DEFAULT FALSE,
      is_powder     BOOLEAN NOT NULL DEFAULT FALSE,
      is_dance      BOOLEAN NOT NULL DEFAULT FALSE,
      is_wind       BOOLEAN NOT NULL DEFAULT FALSE,
      has_recoil    BOOLEAN NOT NULL DEFAULT FALSE,
      has_drain     BOOLEAN NOT NULL DEFAULT FALSE,
      flags         JSONB NOT NULL DEFAULT '{}'
    )
  `);

  pgm.sql(`
    CREATE TABLE pokemon_abilities (
      pokemon_id INTEGER NOT NULL REFERENCES pokemon(id),
      ability_id INTEGER NOT NULL REFERENCES abilities(id),
      slot       SMALLINT NOT NULL CHECK (slot IN (1, 2, 3)),
      PRIMARY KEY (pokemon_id, ability_id)
    )
  `);

  pgm.sql(`
    CREATE TABLE pokemon_moves (
      pokemon_id    INTEGER NOT NULL REFERENCES pokemon(id),
      move_id       INTEGER NOT NULL REFERENCES moves(id),
      learn_method  VARCHAR(16) NOT NULL,
      level_learned SMALLINT,
      PRIMARY KEY (pokemon_id, move_id, learn_method)
    )
  `);

  pgm.sql(`
    CREATE TABLE pokemon_forms (
      id               SERIAL PRIMARY KEY,
      base_pokemon_id  INTEGER NOT NULL REFERENCES pokemon(id),
      form_pokemon_id  INTEGER NOT NULL REFERENCES pokemon(id),
      trigger          VARCHAR(16) NOT NULL,
      required_item_id INTEGER REFERENCES items(id),
      UNIQUE (base_pokemon_id, trigger)
    )
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('pokemon_forms', { cascade: true });
  pgm.dropTable('pokemon_moves', { cascade: true });
  pgm.dropTable('pokemon_abilities', { cascade: true });
  pgm.dropTable('moves', { cascade: true });
  pgm.dropTable('pokemon', { cascade: true });
  pgm.dropTable('items', { cascade: true });
  pgm.dropTable('abilities', { cascade: true });
};
