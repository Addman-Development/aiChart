module.exports = {
  up: async (queryInterface) => {
    // Find the first user (lowest id) and set them as global admin
    const [users] = await queryInterface.sequelize.query(
      "SELECT id FROM \"User\" ORDER BY id ASC LIMIT 1"
    );

    if (users.length > 0) {
      await queryInterface.sequelize.query(
        `UPDATE "User" SET admin = true WHERE id = ${users[0].id}`
      );
    }
  },

  down: async (queryInterface) => {
    // Reset all admins back to false
    await queryInterface.sequelize.query(
      "UPDATE \"User\" SET admin = false"
    );
  },
};
