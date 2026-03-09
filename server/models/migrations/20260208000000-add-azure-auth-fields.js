const Sequelize = require("sequelize");

module.exports = {
  up: async (queryInterface) => {
    // Check if columns exist before adding them (for safety)
    const tableDescription = await queryInterface.describeTable("User");

    if (!tableDescription.azureId) {
      await queryInterface.addColumn("User", "azureId", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }

    if (!tableDescription.authProvider) {
      await queryInterface.addColumn("User", "authProvider", {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: "local",
      });
    }

    if (!tableDescription.azureLinkedAt) {
      await queryInterface.addColumn("User", "azureLinkedAt", {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    // Make password field nullable for Azure-only users
    if (tableDescription.password && !tableDescription.password.allowNull) {
      await queryInterface.changeColumn("User", "password", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("User", "azureId");
    await queryInterface.removeColumn("User", "authProvider");
    await queryInterface.removeColumn("User", "azureLinkedAt");

    // Restore password field to non-nullable
    await queryInterface.changeColumn("User", "password", {
      type: Sequelize.STRING,
      allowNull: false,
    });
  },
};
