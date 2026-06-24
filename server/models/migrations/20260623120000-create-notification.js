const Sequelize = require("sequelize");

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable("Notification", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "User", key: "id" },
        onDelete: "cascade",
      },
      team_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Team", key: "id" },
        onDelete: "cascade",
      },
      type: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "info",
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      message: {
        type: Sequelize.TEXT,
      },
      read: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      meta: {
        type: Sequelize.TEXT("long"),
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

    await queryInterface.addIndex("Notification", ["user_id", "read"]);
    await queryInterface.addIndex("Notification", ["team_id", "user_id"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Notification");
  },
};
