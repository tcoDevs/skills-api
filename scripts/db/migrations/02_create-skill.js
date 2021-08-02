const { DataTypes } = require('sequelize')

module.exports = {
  up: async (query) => {
    await query.createTable('Skills', {
      id: {
        primaryKey: true,
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4
      },
      createdBy: {
        type: DataTypes.STRING
      },
      updatedBy: {
        type: DataTypes.STRING
      },
      name: {
        type: DataTypes.STRING
      },
      externalId: {
        type: DataTypes.STRING
      },
      uri: {
        type: DataTypes.STRING
      },
      metadata: {
        type: DataTypes.JSONB
      },
      created: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updated: {
        type: DataTypes.DATE
      }
    })
  },
  down: async (query) => {
    await query.dropTable('Skills')
  }
}
