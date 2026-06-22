module.exports = (sequelize, DataTypes) => {
  const TeamConnection = sequelize.define("TeamConnection", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    team_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Team", key: "id" },
      onDelete: "CASCADE",
    },
    connection_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Connection", key: "id" },
      onDelete: "CASCADE",
    },
  }, {
    freezeTableName: true,
    indexes: [
      { unique: true, fields: ["team_id", "connection_id"], name: "team_connection_unique" },
    ],
  });

  TeamConnection.associate = (models) => {
    models.TeamConnection.belongsTo(models.Team, { foreignKey: "team_id" });
    models.TeamConnection.belongsTo(models.Connection, { foreignKey: "connection_id" });
  };

  return TeamConnection;
};
