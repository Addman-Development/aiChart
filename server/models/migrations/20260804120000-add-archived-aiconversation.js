const Sequelize = require("sequelize");

const TABLE = "AiConversation";
const INDEX_NAME = "ai_conversation_team_user_archived_updated";

module.exports = {
  up: async (queryInterface) => {
    const table = await queryInterface.describeTable(TABLE);

    if (!table.archived) {
      // Postgres 11+ backfills a NOT NULL column with a constant default in
      // place, so existing rows become false without a separate backfill script.
      await queryInterface.addColumn(TABLE, "archived", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }

    if (!table.archived_at) {
      await queryInterface.addColumn(TABLE, "archived_at", {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      });
    }

    // Backing index for the conversation list query, which is always
    //   WHERE team_id = ? AND user_id = ? AND archived = ? ORDER BY "updatedAt" DESC
    // and for the grouped per-tab counts (same equality prefix, GROUP BY archived).
    // This is the first real index on AiConversation beyond the primary key:
    // 20251025070449-create-aiconversation.js made no addIndex calls, so the
    // indexes declared on the model have never existed in the database.
    const indexes = await queryInterface.showIndex(TABLE);
    if (!indexes.some((index) => index.name === INDEX_NAME)) {
      await queryInterface.addIndex(TABLE, ["team_id", "user_id", "archived", "updatedAt"], {
        name: INDEX_NAME,
      });
    }
  },

  down: async (queryInterface) => {
    const indexes = await queryInterface.showIndex(TABLE);
    if (indexes.some((index) => index.name === INDEX_NAME)) {
      await queryInterface.removeIndex(TABLE, INDEX_NAME);
    }

    const table = await queryInterface.describeTable(TABLE);
    if (table.archived_at) {
      await queryInterface.removeColumn(TABLE, "archived_at");
    }
    if (table.archived) {
      await queryInterface.removeColumn(TABLE, "archived");
    }
  },
};
