const axios = require('axios')

axios.defaults.headers.common['Access-Control-Allow-Origin'] = '*'
axios.defaults.headers.common['Access-Control-Allow-Methods'] = 'GET, PUT, POST, DELETE, OPTIONS'

export default {
  methods: {
    /**
     * getOrganization() fetches the organization metadata
     *
     * @param {Object} context - CKAN state object
     *
     * @return {Object} CKAN organization
     */
    getOrganization: function (context, organizationName) {
      return axios({
        method: 'get',
        url: `${context.url.origin}/api/3/action/organization_show`,
        crossDomain: true,
        params: {
          // Matches organization by name (instead of ID)
          id: organizationName
        }
      }).then(
        response => response.data.result
      )
    },

    /**
     * getDataset() organizes the package metadata
     *
     * @params {Object} response - response from pacakge_show request
     *
     * @return {Object} CKAN package with unneeded fields removed
     */
    getDataset: function (context, datasetID) {
      return axios({
        method: 'get',
        url: `${context.url.origin}/api/3/action/package_show`,
        crossDomain: true,
        params: {
          id: datasetID
        },
        headers: {
          'Authorization': context.key
        }
      }).then(response => {
        let result = response.data.result
        let content = {}

        // Clean up unnecessary fields (eg. IDs, dates) so that the entire
        // object can be used later during create functions
        content.organization = {
          id: result.organization.id,
          name: result.organization.name,
          title: result.organization.title,
          description: result.organization.description
        }

        content.dataset = {
          id: result.id,
          name: result.name,
          title: result.title,
          notes: result.notes,
          collection_method: result.collection_method,
          excerpt: result.excerpt,
          limitations: result.limitations,
          information_url: result.information_url,
          dataset_category: result.dataset_category,
          is_retired: result.is_retired,
          refresh_rate: result.refresh_rate,
          topics: result.topics,
          owner_division: result.owner_division,
          owner_section: result.owner_section,
          owner_unit: result.owner_unit,
          owner_email: result.owner_email,
          image_url: result.image_url
        }

        context.datasetID = result.id

        content.resources = result.resources.map(
          r => {
            return {
              id: r.id,
              name: r.name,
              description: r.description,
              datastore_active: r.datastore_active,
              url: r.url,
              url_type: r.url_type,
              extract_job: r.extract_job,
              format: r.format
            }
          }
        )

        content.resourceIDs = result.resources.map(r => r.id)

        return content
      }).catch(e => {
        return null
      })
    },

    getDatastore: async function (context, resourceID) {
      let { fields, total } = await axios({
        method: 'get',
        url: `${context.url.origin}/api/3/action/datastore_search`,
        crossDomain: true,
        params: {
          resource_id: resourceID,
          limit: 0,
          include_total: true
        }
      }).then(
        response => response.data.result
      )

      let { records } = await axios({
        method: 'get',
        url: `${context.url.origin}/api/3/action/datastore_search`,
        crossDomain: true,
        params: {
          resource_id: resourceID,
          limit: total
        }
      }).then(
        response => response.data.result
      )

      // Remove the auto-generated '_id' field from the records and fields
      await (() => {
        for (let field of records) {
          delete field._id
        }
      })()

      return {
        'fields': fields.filter(row => row.id !== '_id'),
        'records': records
      }
    },

    /**
     * touchDataset() creates package
     *
     * @param {Object} context - CKAN state object
     * @param {Object} dataset - metadata of the dataset to be created
     * @param {String} how     - create or update the dataset
     *
     * @return {Object} created CKAN package
     */
    touchDataset: function (how, context, dataset) {
      let method = how === 'create' ? 'package_create' : 'package_patch'

      delete dataset.last_refreshed
      delete dataset.formats

      if (how === 'create') {
        delete dataset.id
      } else {
        dataset.id = context.dataset.id
      }

      dataset.owner_org = context.organization.id

      return axios({
        method: 'post',
        url: `${context.url.origin}/api/3/action/${method}`,
        crossDomain: true,
        data: dataset,
        headers: {
          'Authorization': context.key
        }
      }).then(
        response => response.data.result
      )
    },

    /**
     * touchResource() creates or updates FileStore resource
     *
     * @param {Object} context  - CKAN state object
     * @param {Object} resource - metadata of the resource to be created
     *
     * @return {Object} created CKAN resource
     */
    touchResource: async function (local, remote, resource) {
      let remoteResource = this.remote.resources.filter(r =>
        r.name === resource.name
      )

      let formData = new FormData()

      formData.append('name', resource.name)
      formData.append('format', resource.format)

      if (resource.url_type === 'upload') {
        let resourceURL = resource.url.split('/')
        let blob = await fetch(resource.url).then(r => r.blob())
        formData.append('upload', blob, resourceURL[resourceURL.length - 1])
      } else {
        formData.append('url', resource.url)
      }

      let method = 'resource_create'
      if (remoteResource.length === 0) {
        formData.append('package_id', remote.dataset.id)
      } else {
        method = 'resource_patch'
        formData.append('id', remoteResource[0].id)
      }

      return axios({
        method: 'post',
        url: `${remote.url.origin}/api/3/action/${method}`,
        crossDomain: true,
        data: formData,
        headers: {
          'Authorization': remote.key
        }
      }).then(
        response => response.data.result
      )
    },

    /**
     * touchDatastore() creates or updates DataStore resource
     *
     * @param {Object} local      - source CKAN state object
     * @param {Object} remote     - target CKAN state object
     * @param {Object} resource   - metadata of the resource to be created
     *
     * @return {Object} created CKAN resource
     */
    touchDatastore: async function (local, remote, resource) {
      let resourceID = resource.id
      let remoteResource = this.remote.resources.filter(r =>
        r.name === resource.name
      )

      delete resource.id
      delete resource.url
      delete resource.datastore_active

      resource.package_id = remote.dataset.id

      // Fetch the data dictionary and number of records from the source CKAN
      let params = await this.getDatastore(local, resourceID)

      if (remoteResource.length === 0) {
        params.resource = resource
      } else {
        await axios({
          method: 'post',
          url: `${remote.url.origin}/api/3/action/datastore_delete`,
          crossDomain: true,
          data: {
            id: remoteResource[0].id
          },
          headers: {
            'Authorization': remote.key
          }
        })

        params.resource_id = remoteResource[0].id
      }

      return axios({
        method: 'post',
        url: `${remote.url.origin}/api/3/action/datastore_create`,
        crossDomain: true,
        data: params,
        headers: {
          'Authorization': remote.key
        }
      })
    },

    /**
     * deleteDataset() deletes package
     *
     * @param {Object} context - CKAN state object
     */
    deleteDataset: async function (context) {
      // Delete the resources from the package one by one because CKAN doesn't
      // remove datastore tables correctly when deleting from package level
      // directly

      await (async () => {
        if (context.hasOwnProperty('resourceIDs')) {
          for (let rID of context.resourceIDs) {
            await this.deleteResource(context, rID)
          }
        }
      })()

      await axios({
        method: 'post',
        url: `${context.url.origin}/api/3/action/dataset_purge`,
        crossDomain: true,
        data: {
          id: context.datasetID
        },
        headers: {
          'Authorization': context.key
        }
      })
    },

    deleteResource: async function (context, resourceID) {
      await axios({
        method: 'post',
        url: `${context.url.origin}/api/3/action/resource_delete`,
        crossDomain: true,
        data: {
          id: resourceID
        },
        headers: {
          'Authorization': context.key
        }
      })
    }
  }
}
