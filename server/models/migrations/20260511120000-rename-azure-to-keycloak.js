const Sequelize = require("sequelize");

// Rename the SSO columns from Azure-specific names to Keycloak-specific names.
// Idempotent: a deployment that's already migrated (or one that never ran the
// original Azure migration) is left alone.
module.exports = {
  up: async (queryInterface) => {
    const table = await queryInterface.describeTable("User");

    if (table.azureId && !table.keycloakId) {
      await queryInterface.renameColumn("User", "azureId", "keycloakId");
    } else if (!table.azureId && !table.keycloakId) {
      await queryInterface.addColumn("User", "keycloakId", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }

    if (table.azureLinkedAt && !table.keycloakLinkedAt) {
      await queryInterface.renameColumn("User", "azureLinkedAt", "keycloakLinkedAt");
    } else if (!table.azureLinkedAt && !table.keycloakLinkedAt) {
      await queryInterface.addColumn("User", "keycloakLinkedAt", {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    if (!table.authProvider) {
      await queryInterface.addColumn("User", "authProvider", {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: "local",
      });
    }

    // Migrate provider values: any user previously marked as Azure is now
    // considered a Keycloak user (the IdP changed under their feet).
    await queryInterface.sequelize.query(
      "UPDATE \"User\" SET \"authProvider\" = 'keycloak' WHERE \"authProvider\" = 'azure'",
    );
  },

  down: async (queryInterface) => {
    const table = await queryInterface.describeTable("User");

    if (table.keycloakId && !table.azureId) {
      await queryInterface.renameColumn("User", "keycloakId", "azureId");
    }
    if (table.keycloakLinkedAt && !table.azureLinkedAt) {
      await queryInterface.renameColumn("User", "keycloakLinkedAt", "azureLinkedAt");
    }
    await queryInterface.sequelize.query(
      "UPDATE \"User\" SET \"authProvider\" = 'azure' WHERE \"authProvider\" = 'keycloak'",
    );
  },
};
