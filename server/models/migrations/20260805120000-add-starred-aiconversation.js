const Sequelize = require("sequelize");

const TABLE = "AiConversation";

module.exports = {
  up: async (queryInterface) => {
    const table = await queryInterface.describeTable(TABLE);

    if (!table.starred) {
      await queryInterface.addColumn(TABLE, "starred", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }

    // Deliberately NO new index. The list query is
    //   WHERE team_id = ? AND user_id = ? AND archived IN (…)
    //   ORDER BY starred DESC, "updatedAt" DESC, id DESC
    // Leading the sort with `starred` means Postgres sorts regardless of index,
    // and the equality prefix of the existing
    // ai_conversation_team_user_archived_updated index already narrows this to a
    // single user's conversations (hundreds, not millions), so the residual sort
    // is cheap. A second index would only add write amplification on the hot
    // orchestration path.
  },

  down: async (queryInterface) => {
    const table = await queryInterface.describeTable(TABLE);
    if (table.starred) {
      await queryInterface.removeColumn(TABLE, "starred");
    }
  },
};
