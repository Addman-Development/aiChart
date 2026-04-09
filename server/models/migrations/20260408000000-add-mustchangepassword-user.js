module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("User", "mustChangePassword", {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("User", "mustChangePassword");
  },
};
