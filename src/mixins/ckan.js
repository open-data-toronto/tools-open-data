const axios = require('axios')

export default {
  methods: {
    /**
     * publishDataset() sets package from private to public
     *
     * @param {Object} context - CKAN state object
     */
    publishDataset: function (context) {
      axios({
        method: 'post',
        url: `${context.url.origin}/api/3/action/package_patch`,
        data: {
          id: context.dataset.id,
          private: false
        },
        headers: {
          'Authorization': context.key
        }
      })
    },

    /**
     * getOrganization() fetches the organization metadata
     *
     * @param {Object} context - CKAN state object
     *
     * @return {Object} CKAN organization
     */
    getOrganization: function (context) {
      return axios({
        method: 'get',
        url: `${context.url.origin}/api/3/action/organization_show`,
        params: {
          // Matches organization by name (instead of ID)
          id: context.organization.name
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
        params: {
          // Parse out the package name assuming that the URL is the path to the
          // dataset (eg. <protocol>://<host>/dataset/<package-name>)
          'id': datasetID
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

        content.resources = result.resources.map(
          r => {
            return {
              id: r.id,
              name: r.name,
              description: r.description,
              datastore_active: r.datastore_active,
              url: r.url,
              extract_job: r.extract_job,
              format: r.format
            }
          }
        )

        return content
      }).catch(e => {
        return null
      })
    },

    getDatastore: async function (context, resourceID) {
      let { fields, total } = await axios({
        method: 'get',
        url: `${context.url.origin}/api/3/action/datastore_search`,
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
        params: {
          resource_id: resourceID,
          limit: total
        }
      }).then(
        response => response.data.result
      )

      // Remove the auto-generated '_id' field from the records and fields
      for (let field of records) {
        delete field._id
      }

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
      let method = how === 'create' ? 'package_create' : 'package_update'

      if (how === 'create') {
        delete dataset.id
        dataset.private = true
      } else {
        dataset.id = context.dataset.id
      }

      dataset.owner_org = context.organization.id

      return axios({
        method: 'post',
        url: `${context.url.origin}/api/3/action/${method}`,
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

      let data = await axios({
        method: 'get',
        url: resource.url
      })

      let resourceURL = resource.url.split('/')

      let formData = new FormData()
      formData.append('name', resource.name)
      formData.append('format', resource.format)

      formData.append(
        'upload',
        new Blob(
          [data.data],
          { type: data.headers['content-type'] }
        ),
        resourceURL[resourceURL.length - 1]
      )

      let method = 'resource_create'
      if (remoteResource.length === 0) {
        formData.append('package_id', remote.dataset.id)
      } else {
        method = 'resource_update'
        formData.append('id', remoteResource[0].id)
      }

      return axios({
        method: 'post',
        url: `${remote.url.origin}/api/3/action/${method}`,
        data: formData,
        headers: {
          'Authorization': remote.key
        }
      })
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

      resource.package_id = remote.dataset.id

      // Fetch the data dictionary and number of records from the source CKAN
      let params = await this.getDatastore(local, resourceID)

      if (remoteResource.length === 0) {
        params.resource = resource
      } else {
        await axios({
          method: 'post',
          url: `${remote.url.origin}/api/3/action/datastore_delete`,
          data: {
            resource_id: resourceID
          },
          headers: {
            'Authorization': remote.key
          }
        })

        params.resource_id = resourceID
      }

      return axios({
        method: 'post',
        url: `${remote.url.origin}/api/3/action/datastore_create`,
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
      for (let resourceID of context.resourceIDs) {
        await this.deleteResource(context, resourceID)
      }

      await axios({
        method: 'post',
        url: `${context.url.origin}/api/3/action/package_delete`,
        data: {
          id: context.datasetID
        },
        headers: {
          'Authorization': context.key
        }
      })
    },

    deleteResource: function (context, resourceID) {
      axios({
        method: 'post',
        url: `${context.url.origin}/api/3/action/resource_delete`,
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
