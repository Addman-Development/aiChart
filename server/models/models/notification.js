module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define("Notification", {
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
    team_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Team", key: "id" },
      onDelete: "cascade",
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "info",
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
    },
    read: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    meta: {
      type: DataTypes.TEXT("long"),
      get() {
        try {
          return JSON.parse(this.getDataValue("meta"));
        } catch (e) {
          return this.getDataValue("meta");
        }
      },
      set(value) {
        try {
          this.setDataValue("meta", JSON.stringify(value));
        } catch (e) {
          this.setDataValue("meta", value);
        }
      },
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
      { fields: ["user_id", "read"] },
      { fields: ["team_id", "user_id"] },
    ],
  });

  Notification.associate = (models) => {
    models.Notification.belongsTo(models.User, { foreignKey: "user_id" });
    models.Notification.belongsTo(models.Team, { foreignKey: "team_id" });
  };

  return Notification;
};
