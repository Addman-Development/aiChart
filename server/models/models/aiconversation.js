module.exports = (sequelize, DataTypes) => {
  const AiConversation = sequelize.define("AiConversation", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    team_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      reference: {
        model: "Team",
        key: "id",
        onDelete: "cascade",
      },
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      reference: {
        model: "User",
        key: "id",
        onDelete: "cascade",
      },
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "Auto-generated conversation title"
    },
    source: {
      type: DataTypes.ENUM("slack", "app", "api"),
      allowNull: false,
      defaultValue: "app",
    },
    status: {
      type: DataTypes.ENUM("active", "completed", "error", "cancelled"),
      defaultValue: "active",
    },
    // Archive state backing the Active/Archived tabs. Deliberately NOT folded
    // into `status`: getOrchestration overwrites status on every turn, so it
    // cannot hold user intent.
    archived: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // Set when archived, nulled when unarchived. Kept separate from updatedAt
    // because archive writes use { silent: true } so they don't reorder the
    // list (both tabs sort by updatedAt DESC).
    archived_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    // Starred conversations pin to the top of the list (ORDER BY starred DESC,
    // updatedAt DESC). Independent of `archived` — you can star either.
    starred: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // Condensed conversation history (token-efficient, rebuildable from AiMessage)
    conversation_summary: {
      type: DataTypes.TEXT("long"),
      comment: "Cached condensed version for resuming conversations efficiently"
    },
    // Conversation metadata (cached counts)
    message_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: "Cached count of user messages"
    },
    // Final results summary
    final_result: {
      type: DataTypes.TEXT,
      comment: "Summary of what was accomplished"
    },
    // Resume checkpoint
    last_checkpoint: {
      type: DataTypes.TEXT,
      comment: "State for resuming interrupted conversations"
    },
    error_message: {
      type: DataTypes.TEXT,
      comment: "Error details if status = error"
    },
  }, {
    freezeTableName: true,
    // NOTE: this block is documentation only — there is no sequelize.sync() in
    // this app, so server/models/migrations is the source of truth. The first
    // two entries have never existed in the database
    // (20251025070449-create-aiconversation.js makes no addIndex calls); the
    // third is real, created by 20260804120000-add-archived-aiconversation.js.
    indexes: [
      { fields: ["team_id", "user_id", "updatedAt"] },
      { fields: ["status", "updatedAt"] },
      { fields: ["team_id", "user_id", "archived", "updatedAt"] }
    ]
  });

  AiConversation.associate = (models) => {
    models.AiConversation.belongsTo(models.User, { foreignKey: "user_id" });
    models.AiConversation.belongsTo(models.Team, { foreignKey: "team_id" });
    models.AiConversation.hasMany(models.AiMessage, { foreignKey: "conversation_id" });
    models.AiConversation.hasMany(models.AiUsage, { foreignKey: "conversation_id" });
  };

  return AiConversation;
};
