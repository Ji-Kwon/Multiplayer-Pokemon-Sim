'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      username      VARCHAR(32) NOT NULL UNIQUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  pgm.sql(`
    CREATE TABLE teams (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       VARCHAR(64) NOT NULL,
      format     VARCHAR(16) NOT NULL CHECK (format IN ('singles','doubles')),
      notes      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  pgm.sql(`
    CREATE TABLE team_pokemon (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      team_id      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      slot         SMALLINT NOT NULL CHECK (slot BETWEEN 1 AND 6),
      pokemon_id   INTEGER NOT NULL REFERENCES pokemon(id),
      nickname     VARCHAR(24),
      gender       VARCHAR(8) CHECK (gender IN ('male','female','unknown')),
      ability_id   INTEGER NOT NULL REFERENCES abilities(id),
      item_id      INTEGER REFERENCES items(id),
      nature_id    SMALLINT NOT NULL REFERENCES natures(id),
      move1_id     INTEGER REFERENCES moves(id),
      move2_id     INTEGER REFERENCES moves(id),
      move3_id     INTEGER REFERENCES moves(id),
      move4_id     INTEGER REFERENCES moves(id),
      ev_hp        SMALLINT NOT NULL DEFAULT 0,
      ev_atk       SMALLINT NOT NULL DEFAULT 0,
      ev_def       SMALLINT NOT NULL DEFAULT 0,
      ev_spa       SMALLINT NOT NULL DEFAULT 0,
      ev_spd       SMALLINT NOT NULL DEFAULT 0,
      ev_spe       SMALLINT NOT NULL DEFAULT 0,
      iv_hp        SMALLINT NOT NULL DEFAULT 31,
      iv_atk       SMALLINT NOT NULL DEFAULT 31,
      iv_def       SMALLINT NOT NULL DEFAULT 31,
      iv_spa       SMALLINT NOT NULL DEFAULT 31,
      iv_spd       SMALLINT NOT NULL DEFAULT 31,
      iv_spe       SMALLINT NOT NULL DEFAULT 31,
      tera_type_id SMALLINT REFERENCES types(id),
      UNIQUE (team_id, slot)
    )
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('team_pokemon', { cascade: true });
  pgm.dropTable('teams', { cascade: true });
  pgm.dropTable('users', { cascade: true });
};
