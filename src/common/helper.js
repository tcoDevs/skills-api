const querystring = require('querystring')
const _ = require('lodash')
const { getControllerMethods } = require('./controller-helper')
const logger = require('./logger')
const config = require('config')
const busApi = require('@topcoder-platform/topcoder-bus-api-wrapper')
const busApiClient = busApi(_.pick(config, ['AUTH0_URL', 'AUTH0_AUDIENCE', 'TOKEN_CACHE_TIME', 'AUTH0_CLIENT_ID',
  'AUTH0_CLIENT_SECRET', 'BUSAPI_URL', 'KAFKA_ERROR_TOPIC', 'AUTH0_PROXY_SERVER_URL']))

/**
 * get auth user handle or id
 * @param authUser the user
 */
function getAuthUser (authUser) {
  return authUser.handle || authUser.sub
}

/**
 * Get link for a given page.
 * @param {Object} req the HTTP request
 * @param {Number} page the page number
 * @returns {String} link for the page
 */
function getPageLink (req, page) {
  const q = _.assignIn({}, req.query, { page })
  return `${req.protocol}://${req.get('Host')}${req.baseUrl}${req.path}?${querystring.stringify(q)}`
}

/**
 * Set HTTP response headers from result.
 * @param {Object} req the HTTP request
 * @param {Object} res the HTTP response
 * @param {Object} result the operation result
 */
function injectSearchMeta (req, res, result) {
  // if result is got from db, then do not set response headers
  if (result.fromDB) {
    return
  }

  const resultTotal = _.isNumber(result.total) ? result.total : result.total.value

  const totalPages = Math.ceil(resultTotal / result.perPage)
  if (result.page > 1) {
    res.set('X-Prev-Page', +result.page - 1)
  }
  if (result.page < totalPages) {
    res.set('X-Next-Page', +result.page + 1)
  }
  res.set('X-Page', result.page)
  res.set('X-Per-Page', result.perPage)
  res.set('X-Total', resultTotal)
  res.set('X-Total-Pages', totalPages)
  // set Link header
  if (totalPages > 0) {
    let link = `<${getPageLink(req, 1)}>; rel="first", <${getPageLink(req, totalPages)}>; rel="last"`
    if (result.page > 1) {
      link += `, <${getPageLink(req, result.page - 1)}>; rel="prev"`
    }
    if (result.page < totalPages) {
      link += `, <${getPageLink(req, result.page + 1)}>; rel="next"`
    }
    res.set('Link', link)
  }

  // Allow browsers access pagination data in headers
  let accessControlExposeHeaders = res.get('Access-Control-Expose-Headers') || ''
  accessControlExposeHeaders += accessControlExposeHeaders ? ', ' : ''
  // append new values, to not override values set by someone else
  accessControlExposeHeaders += 'X-Page, X-Per-Page, X-Total, X-Total-Pages, X-Prev-Page, X-Next-Page'

  res.set('Access-Control-Expose-Headers', accessControlExposeHeaders)
}

/**
 * Removes the audit fields created, createdBy, updatedBy from the given entity or an array of entities
 * and moves the updated to metadata
 * @param entity a single entity or an array of entities
 * @returns the modified entity
 */
function omitAuditFields (entity) {
  function _omit (result) {
    const metadata = _.get(result, 'metadata') || {}
    metadata.updated = _.get(result, 'updated')
    result.metadata = metadata
    return _.omit(result, ['created', 'updated', 'createdBy', 'updatedBy'])
  }

  if (!entity) { return entity }

  if (_.isArray(entity)) {
    return entity.map(i => _omit(i))
  } else {
    return _omit(entity)
  }
}

/**
 * Send error event to Kafka
 * @params {String} topic the topic name
 * @params {Object} payload the payload
 * @params {String} action for which operation error occurred
 */
async function publishError (topic, payload, action) {
  _.set(payload, 'apiAction', action)
  const message = {
    topic,
    originator: config.KAFKA_MESSAGE_ORIGINATOR,
    timestamp: new Date().toISOString(),
    'mime-type': 'application/json',
    payload
  }
  logger.debug(`Publish error to Kafka topic ${topic}, ${JSON.stringify(message, null, 2)}`)
  await busApiClient.postEvent(message)
}

module.exports = {
  getAuthUser,
  injectSearchMeta,
  getControllerMethods,
  omitAuditFields,
  publishError
}
