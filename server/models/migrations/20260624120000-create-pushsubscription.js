const Sequelize = require("sequelize");

module.exports = {
  async up(queryInterface) {
    await queryInterface.createTable("PushSubscription", {
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
      endpoint: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      p256dh: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      auth: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      userAgent: {
        type: Sequelize.STRING,
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

    await queryInterface.addIndex("PushSubscription", ["user_id"]);
    await queryInterface.addIndex("PushSubscription", ["endpoint"], {
      unique: true,
      name: "push_subscription_endpoint_unique",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("PushSubscription");
  },
};
