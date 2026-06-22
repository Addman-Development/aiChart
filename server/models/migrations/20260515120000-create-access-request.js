const Sequelize = require("sequelize");

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.createTable("AccessRequest", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      email: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      keycloak_sub: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      requested_team_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "Team", key: "id" },
        onDelete: "SET NULL",
      },
      reason: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM("pending", "approved", "rejected", "cancelled"),
        defaultValue: "pending",
        allowNull: false,
      },
      resolved_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "User", key: "id" },
        onDelete: "SET NULL",
      },
      resolved_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex("AccessRequest", ["keycloak_sub"]);
    await queryInterface.addIndex("AccessRequest", ["status"]);

    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX \"access_request_pending_unique\" "
      + "ON \"AccessRequest\" (\"keycloak_sub\", \"requested_team_id\") "
      + "WHERE \"status\" = 'pending'",
    );
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("AccessRequest");
    await queryInterface.sequelize.query("DROP TYPE IF EXISTS \"enum_AccessRequest_status\"");
  },
};
