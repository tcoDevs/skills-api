/**
 * the skill services
 */

const joi = require('@hapi/joi')
const _ = require('lodash')
const config = require('config')

const errors = require('../../common/errors')
const helper = require('../../common/helper')
const dbHelper = require('../../common/db-helper')
const serviceHelper = require('../../common/service-helper')
const constants = require('../../constants')
const { PERMISSION } = require('../../permissions/constants')
const sequelize = require('../../models/index')

const Skill = sequelize.models.Skill
const Taxonomy = sequelize.models.Taxonomy
const resource = serviceHelper.getResource('Skill')
const uniqueFields = [['taxonomyId', 'externalId', 'name']]

/**
 * create entity
 * @param entity the request skill entity
 * @param auth the auth information
 * @return the created skill
 */
async function create (entity, auth) {
  if (Object.keys(entity.metadata).length) {
    // check permission for adding new metadata fields
    serviceHelper.hasPermission(PERMISSION.ADD_SKILL_METADATA, auth)
  }

  const taxonomy = await dbHelper.get(Taxonomy, entity.taxonomyId)
  await dbHelper.makeSureUnique(Skill, entity, uniqueFields)

  let payload
  try {
    return await sequelize.transaction(async () => {
      const result = await dbHelper.create(Skill, entity, auth)

      payload = result.dataValues

      const created = { ...result.dataValues, taxonomyName: taxonomy.name }
      await serviceHelper.createRecordInEs(resource, created)

      return helper.omitAuditFields(created)
    })
  } catch (e) {
    if (payload) {
      helper.publishError(config.SKILLS_ERROR_TOPIC, payload, constants.API_ACTION.SkillCreate)
    }
    throw e
  }
}

create.schema = {
  entity: joi.object().keys({
    taxonomyId: joi.string().uuid().required(),
    name: joi.string().required(),
    uri: joi.string(),
    externalId: joi.string(),
    metadata: joi.object().keys({
      challengeProminence: joi.prominence('challengeProminence'),
      memberProminence: joi.prominence('memberProminence')
    }).unknown(true).required()
  }).required(),
  auth: joi.object()
}

/**
 * patch skill by id
 * @param id the skill id
 * @param entity the request skill entity
 * @param auth the auth object
 * @return the updated skill
 */
async function patch (id, entity, auth) {
  let taxonomy
  if (entity.taxonomyId) {
    taxonomy = await dbHelper.get(Taxonomy, entity.taxonomyId)
  }

  await dbHelper.makeSureUnique(Skill, entity, uniqueFields)

  const instance = await dbHelper.get(Skill, id)

  if (entity.metadata) {
    if (Object.keys(entity.metadata).length) {
      // check permission for adding new metadata fields
      serviceHelper.hasPermission(PERMISSION.ADD_SKILL_METADATA, auth)
    }
    if (Object.keys(instance.metadata).length) {
      // check permission for removing existing metadata fields
      serviceHelper.hasPermission(PERMISSION.DELETE_SKILL_METADATA, auth)
    }
  }

  let payload
  try {
    return await sequelize.transaction(async () => {
      const newEntity = await instance.update({
        ...entity,
        updatedBy: helper.getAuthUser(auth)
      })

      payload = newEntity.dataValues

      if (!taxonomy) {
        taxonomy = await dbHelper.get(Taxonomy, newEntity.taxonomyId)
      }
      const updated = { ...newEntity.dataValues, taxonomyName: taxonomy.name }

      await serviceHelper.patchRecordInEs(resource, updated)

      return helper.omitAuditFields(updated)
    })
  } catch (e) {
    if (payload) {
      helper.publishError(config.SKILLS_ERROR_TOPIC, payload, constants.API_ACTION.SkillUpdate)
    }
    throw e
  }
}

patch.schema = {
  id: joi.string().uuid().required(),
  entity: joi.object().keys({
    taxonomyId: joi.string().uuid(),
    name: joi.string(),
    uri: joi.string(),
    externalId: joi.string(),
    metadata: joi.object().keys({
      challengeProminence: joi.prominence('challengeProminence'),
      memberProminence: joi.prominence('memberProminence')
    }).unknown(true)
  }).min(1).required(),
  auth: joi.object()
}

/**
 * get skill by id
 * @param id the skill id
 * @param params the path parameters
 * @param query the query parameters
 * @param fromDb Should we bypass Elasticsearch for the record and fetch from db instead?
 * @return the skill
 */
async function get (id, params, query = {}, fromDb = false) {
  const trueParams = _.assign(params, query)
  if (!fromDb) {
    const esResult = await serviceHelper.getRecordInEs(resource, id, trueParams)
    await populateTaxonomyNames(esResult)
    if (esResult) {
      return helper.omitAuditFields(esResult)
    }
  }

  const recordObj = await dbHelper.get(Skill, id)
  if (!recordObj) {
    throw errors.newEntityNotFoundError(`cannot find ${Skill.name} where ${_.map(trueParams, (v, k) => `${k}:${v}`).join(', ')}`)
  }
  const skill = recordObj.dataValues
  await populateTaxonomyNames(skill)

  return helper.omitAuditFields(skill)
}

get.schema = {
  id: joi.string().uuid().required(),
  params: joi.object()
}

/**
 * Populates the taxonomy name for each of the skill
 * @param skills individual skill or an array of skills
 * @returns the updated skills object
 */
async function populateTaxonomyNames (skills) {
  if (_.isArray(skills)) {
    const taxonomyMap = {}
    for (const skill of skills) {
      // dont populate if we already have the name
      if (skill.taxonomyName) { continue }

      if (!_.has(taxonomyMap, skill.taxonomyId)) {
        const taxonomy = await dbHelper.get(Taxonomy, skill.taxonomyId)
        taxonomyMap[skill.taxonomyId] = taxonomy.name
      }
      skill.taxonomyName = taxonomyMap[skill.taxonomyId]
    }
  } else {
    const taxonomy = await dbHelper.get(Taxonomy, skills.taxonomyId)
    skills.taxonomyName = taxonomy.name
  }

  return skills
}

/**
 * search skills by query
 * @param query the search query
 * @return the results
 */
async function search (query) {
  // get from elasticsearch, if that fails get from db
  // and response headers ('X-Total', 'X-Page', etc.) are not set in case of db return

  const esResult = await serviceHelper.searchRecordInEs(resource, query)

  if (esResult) {
    await populateTaxonomyNames(esResult.result)
    esResult.result = helper.omitAuditFields(esResult.result)
    return helper.omitAuditFields(esResult)
  }

  let items = await dbHelper.find(Skill, query)

  items = items.map(item => item.dataValues)
  await populateTaxonomyNames(items)
  items = helper.omitAuditFields(items)
  return { fromDb: true, result: items, total: items.length }
}

search.schema = {
  query: {
    page: joi.page(),
    perPage: joi.pageSize(),
    taxonomyId: joi.string().uuid(),
    name: joi.string(),
    externalId: joi.string(),
    orderBy: joi.string()
  }
}

/**
 * remove skill by id
 * @param id the skill id
 * @param auth the auth object
 * @param params the query params
 * @return no data returned
 */
async function remove (id, auth, params) {
  const payload = { id }
  try {
    return await sequelize.transaction(async () => {
      await dbHelper.remove(Skill, id)
      await serviceHelper.deleteRecordFromEs(id, params, resource)
    })
  } catch (e) {
    helper.publishError(config.SKILLS_ERROR_TOPIC, payload, constants.API_ACTION.SkillDelete)
    throw e
  }
}

remove.schema = {
  id: joi.string().uuid().required(),
  auth: joi.object(),
  params: joi.object()
}

module.exports = {
  create,
  search,
  patch,
  get,
  remove
}
