const Sequelize = require("sequelize");

module.exports = {
  up: async (queryInterface) => {
    const table = await queryInterface.describeTable("AccessRequest");

    if (!table.user_id) {
      await queryInterface.addColumn("AccessRequest", "user_id", {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "User", key: "id" },
        onDelete: "SET NULL",
      });
    }

    await queryInterface.changeColumn("AccessRequest", "keycloak_sub", {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.sequelize.query(
      "DROP INDEX IF EXISTS \"access_request_pending_unique\"",
    );

    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX \"access_request_pending_user_unique\" "
      + "ON \"AccessRequest\" (\"user_id\", \"requested_team_id\") "
      + "WHERE \"status\" = 'pending'",
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      "DROP INDEX IF EXISTS \"access_request_pending_user_unique\"",
    );
    const table = await queryInterface.describeTable("AccessRequest");
    if (table.user_id) {
      await queryInterface.removeColumn("AccessRequest", "user_id");
    }
    await queryInterface.changeColumn("AccessRequest", "keycloak_sub", {
      type: Sequelize.STRING,
      allowNull: false,
    });
  },
};
