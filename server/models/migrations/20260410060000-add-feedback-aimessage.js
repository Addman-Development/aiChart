const Sequelize = require("sequelize");

module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("AiMessage", "feedback", {
      type: Sequelize.ENUM("positive", "negative"),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("AiMessage", "feedback");
    await queryInterface.sequelize.query("DROP TYPE IF EXISTS \"enum_AiMessage_feedback\";");
  }
};
