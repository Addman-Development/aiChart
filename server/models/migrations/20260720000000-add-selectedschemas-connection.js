const Sequelize = require("sequelize");

module.exports = {
  up: async (queryInterface) => {
    const table = await queryInterface.describeTable("Connection");
    if (!table.selectedSchemas) {
      await queryInterface.addColumn("Connection", "selectedSchemas", {
        type: Sequelize.TEXT,
      });
    }
  },
  down: async (queryInterface) => {
    const table = await queryInterface.describeTable("Connection");
    if (table.selectedSchemas) {
      await queryInterface.removeColumn("Connection", "selectedSchemas");
    }
  },
};
