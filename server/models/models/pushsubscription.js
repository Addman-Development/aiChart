module.exports = (sequelize, DataTypes) => {
  const PushSubscription = sequelize.define("PushSubscription", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "User", key: "id" },
      onDelete: "cascade",
    },
    // The push service endpoint URL. Unique per device/browser — used as the
    // upsert key so re-subscribing the same device replaces its row.
    endpoint: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    // Encryption keys from the browser PushSubscription (subscription.toJSON().keys).
    p256dh: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    auth: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // Best-effort device label so a user could later tell their devices apart.
    userAgent: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    createdAt: {
      allowNull: false,
      type: DataTypes.DATE,
    },
    updatedAt: {
      allowNull: false,
      type: DataTypes.DATE,
    },
  }, {
    freezeTableName: true,
    indexes: [
      { fields: ["user_id"] },
      { unique: true, fields: ["endpoint"], name: "push_subscription_endpoint_unique" },
    ],
  });

  PushSubscription.associate = (models) => {
    models.PushSubscription.belongsTo(models.User, { foreignKey: "user_id" });
  };

  return PushSubscription;
};
