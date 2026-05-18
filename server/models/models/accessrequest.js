const { encrypt, decrypt } = require("../../modules/cbCrypto");

module.exports = (sequelize, DataTypes) => {
  const AccessRequest = sequelize.define("AccessRequest", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    email: {
      type: DataTypes.TEXT,
      allowNull: false,
      get() {
        const raw = this.getDataValue("email");
        if (!raw) return raw;
        try {
          return decrypt(raw);
        } catch (e) {
          return raw;
        }
      },
      set(value) {
        return this.setDataValue("email", encrypt(value));
      },
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    requested_team_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("pending", "approved", "rejected", "cancelled"),
      defaultValue: "pending",
      allowNull: false,
    },
    resolved_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    resolved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  }, {
    freezeTableName: true,
  });

  AccessRequest.associate = (models) => {
    models.AccessRequest.belongsTo(models.Team, { foreignKey: "requested_team_id" });
    models.AccessRequest.belongsTo(models.User, { foreignKey: "user_id", as: "Requester" });
    models.AccessRequest.belongsTo(models.User, { foreignKey: "resolved_by", as: "Resolver" });
  };

  return AccessRequest;
};
