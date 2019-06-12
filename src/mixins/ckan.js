const axios = require('axios')

export default {
  methods: {
    buildEndpoint: function (context, endpoint) {
      return context.url.origin + '/api/3/action/' + endpoint
    },
    getOrganization: function (context) {
      return axios({
        method: 'get',
        url: this.buildEndpoint(context, 'organization_show'),
        params: {
          id: context.organization.name
        }
      }).then(
        response => response.data.result
      )
    },
    getDataset: function (context) {
      return axios({
        method: 'get',
        url: this.buildEndpoint(context, 'package_show'),
        params: {
          'id': context.url.pathname.split('/')[2]
        }
      }).then(response => {
        let result = response.data.result
        let content = {}

        content.organization = (({ name, title, description }) => ({ name, title, description }))(result.organization)

        content.dataset = (
          ({ name, title, notes, collection_method, excerpt, limitations, information_url, dataset_category, is_retired, refresh_rate, topics, owner_division, owner_section, owner_unit, owner_email, image_url }) =>
          ({ name, title, notes, collection_method, excerpt, limitations, information_url, dataset_category, is_retired, refresh_rate, topics, owner_division, owner_section, owner_unit, owner_email, image_url })
        )(result)

        content.resources = result.resources.map(
          r => (
            ({ id, name, description, datastore_active, url, extract_job, format }) =>
            ({ id, name, description, datastore_active, url, extract_job, format })
          )(r)
        )

        return content
      })
    },
    createDataset: function (context, dataset) {
      dataset.owner_org = context.organization.id
      dataset.private = true

      dataset.name += '-test'
      dataset.owner_org = 'e1d223a3-f1bd-4933-b49e-24786cee2af3'

      return axios({
        method: 'post',
        url: this.buildEndpoint(context, 'package_create'),
        data: dataset,
        headers: {
          'Authorization' : context.key
        }
      }).then(
        response => response.data.result
      )
    },
    createResource: function (context, resource) {
      delete resource.id

      resource.package_id = context.dataset.id
      resource.url_type = 'upload'

      return axios({
        method: 'post',
        url: this.buildEndpoint(context, 'resource_create'),
        data: resource,
        headers: {
          'Authorization' : context.key
        }
      })
    },
    createDatastore: async function (local, remote, resource) {
      let resourceID = resource.id

      delete resource.id
      delete resource.url

      resource.package_id = remote.dataset.id

      let { fields, total } = await axios({
        method: 'get',
        url: this.buildEndpoint(local, 'datastore_search'),
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
        url: this.buildEndpoint(local, 'datastore_search'),
        params: {
          resource_id: resourceID,
          limit: total
        }
      }).then(
        response => response.data.result
      )

      for (let field of records) {
        delete field._id
      }

      fields = fields.filter(row => row.id != '_id')

      return await axios({
        method: 'post',
        url: this.buildEndpoint(remote, 'datastore_create'),
        data: {
          resource: resource,
          fields: fields,
          records: records
        },
        headers: {
          'Authorization' : remote.key
        }
      })
    },
    publishDataset: function (context) {
      axios({
        method: 'post',
        url: this.buildEndpoint(context, 'package_patch'),
        data: {
          id: context.dataset.id,
          private: false
        },
        headers: {
          'Authorization': context.key
        }
      })
    },
    deleteDataset: async function (context) {
      for (let resource of context.resources) {
        await axios({
          method: 'get',
          url: this.buildEndpoint(context, 'resource_delete'),
          params: {
            id: resource.id
          }
        })
      }

      await axios({
        method: 'get',
        url: this.buildEndpoint(context, 'package_delete'),
        params: {
          id: context.package.id
        }
      })
    }
  }
}