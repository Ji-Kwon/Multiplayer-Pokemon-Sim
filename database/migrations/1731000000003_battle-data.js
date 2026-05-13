'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE battles (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      format       VARCHAR(16) NOT NULL CHECK (format IN ('singles','doubles')),
      ruleset_name VARCHAR(64) NOT NULL,
      player1_id   UUID NOT NULL REFERENCES users(id),
      player2_id   UUID REFERENCES users(id),
      winner_id    UUID REFERENCES users(id),
      result       VARCHAR(16) CHECK (result IN ('player1','player2','draw','forfeit','timeout')),
      started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at     TIMESTAMPTZ,
      player1_team JSONB NOT NULL,
      player2_team JSONB NOT NULL
    )
  `);

  pgm.sql(`
    CREATE TABLE battle_turns (
      id             SERIAL,
      battle_id      UUID NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
      turn_number    SMALLINT NOT NULL,
      state_snapshot JSONB NOT NULL,
      turn_log       JSONB NOT NULL,
      actions        JSONB NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (battle_id, turn_number)
    )
  `);

  pgm.sql(`
    CREATE TABLE battle_chat (
      id         SERIAL PRIMARY KEY,
      battle_id  UUID NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
      user_id    UUID NOT NULL REFERENCES users(id),
      message    VARCHAR(256) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('battle_chat', { cascade: true });
  pgm.dropTable('battle_turns', { cascade: true });
  pgm.dropTable('battles', { cascade: true });
};
