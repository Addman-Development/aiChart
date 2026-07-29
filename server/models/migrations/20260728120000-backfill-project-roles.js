const backfillProjectRoles = require("../scripts/backfillProjectRoles");

module.exports = {
  async up() {
    await backfillProjectRoles.up();
  },

  async down() {
    await backfillProjectRoles.down();
  }
};
