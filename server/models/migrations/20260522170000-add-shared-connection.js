const Sequelize = require("sequelize");

module.exports = {
  up: async (queryInterface) => {
    const connectionTable = await queryInterface.describeTable("Connection");
    if (!connectionTable.shared) {
      await queryInterface.addColumn("Connection", "shared", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }

    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((t) => (typeof t === "string" ? t : t.tableName));
    if (!normalized.includes("TeamConnection")) {
      await queryInterface.createTable("TeamConnection", {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        team_id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: "Team", key: "id" },
          onDelete: "CASCADE",
        },
        connection_id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: "Connection", key: "id" },
          onDelete: "CASCADE",
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
      });

      await queryInterface.addIndex("TeamConnection", ["team_id", "connection_id"], {
        unique: true,
        name: "team_connection_unique",
      });
    }
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("TeamConnection");
    const connectionTable = await queryInterface.describeTable("Connection");
    if (connectionTable.shared) {
      await queryInterface.removeColumn("Connection", "shared");
    }
  },
};
