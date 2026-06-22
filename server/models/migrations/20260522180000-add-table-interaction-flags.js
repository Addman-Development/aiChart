const Sequelize = require("sequelize");

const COLUMNS = ["tableSearchEnabled", "tableFilterEnabled", "tableSortEnabled"];

module.exports = {
  up: async (queryInterface) => {
    const table = await queryInterface.describeTable("Chart");
    for (const name of COLUMNS) {
      if (!table[name]) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.addColumn("Chart", name, {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        });
      }
    }
  },

  down: async (queryInterface) => {
    const table = await queryInterface.describeTable("Chart");
    for (const name of COLUMNS) {
      if (table[name]) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.removeColumn("Chart", name);
      }
    }
  },
};
