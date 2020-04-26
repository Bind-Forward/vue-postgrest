import Vue from 'vue'
import ObservableFunction from '@/ObservableFunction'
import { PrimaryKeyError } from '@/errors'
import { isObject, syncObjects } from '@/utils'
import cloneDeep from 'lodash.clonedeep'
import isEqual from 'lodash.isequal'

const GenericModelTemplate = Vue.extend({
  data () {
    return {
      data: {},
      diff: {},
      resetCache: {},
      request: null
    }
  },
  created () {
    this.watchers = {}
  },
  computed: {
    primaryKeys () {
      return (this.schema[this.route] && this.schema[this.route].pks) || []
    },
    query () {
      return this.primaryKeys && this.primaryKeys.reduce((q, pk) => {
        if (this.resetCache[pk] === undefined) {
          throw new PrimaryKeyError(pk)
        }
        q[pk] = 'eq.' + this.resetCache[pk]
        return q
      }, {})
    },
    isDirty () {
      return Object.keys(this.diff).length > 0
    }
  },
  methods: {
    async _get (opts = {}) {
      const query = { ...this.query }
      if (this.select) {
        query.select = this.select
      }
      const ret = await this.request('GET', query, { return: 'single', headers: opts.headers })

      if (ret && ret.body) {
        this.setData(ret.body, opts.keepChanges)
      }
      return ret
    },
    async _post (opt, sync = true) {
      const defaultOptions = { columns: Object.keys(this.data) }
      const options = Object.assign({}, defaultOptions, opt)
      // always set return to representation if sync is true
      if (sync) {
        options.return = 'representation'
      }

      const query = {}
      if (options.return === 'representation' && this.select) {
        query.select = this.select
      }
      if (options.columns) {
        query.columns = options.columns
      }

      const ret = await this.request('POST', query, options, cloneDeep(this.data))
      if (sync && ret && ret.body) {
        this.setData(ret.body[0])
      } else {
        this.reset()
      }
      return ret
    },
    async _patch (data = {}, opt, sync = true) {
      if (!isObject(data) || Array.isArray(data)) {
        throw new Error('Patch data must be an object.')
      }
      const patchData = Object.assign({}, this.diff, Object.keys(data).reduce((acc, key) => {
        if (data[key] !== undefined) {
          acc[key] = data[key]
        }
        return acc
      }, {}))
      if (Object.keys(patchData).length === 0) {
        return
      }
      const defaultOptions = { columns: Object.keys(patchData) }
      const options = Object.assign({}, defaultOptions, opt)

      // always set return to representation if sync is true
      if (sync) {
        options.return = 'representation'
      }

      const query = { ...this.query }
      if (options.return === 'representation' && this.select) {
        query.select = this.select
      }
      if (options.columns) {
        query.columns = options.columns
      }

      const ret = await this.request('PATCH', query, options, cloneDeep(patchData))
      if (sync && ret && ret.body) {
        this.setData(ret.body[0])
      } else {
        this.reset()
      }
      return ret
    },
    async _delete (opts = {}) {
      const query = { ...this.query }
      if (opts.return === 'representation' && this.select) {
        query.select = this.select
      }

      return await this.request('DELETE', query, opts)
    },
    setData (data, keepDiff = false) {
      this.resetCache = cloneDeep(data)
      if (keepDiff) {
        const diff = cloneDeep(this.diff)
        syncObjects(this.data, data)
        syncObjects(this.data, diff, false)
      } else {
        syncObjects(this.data, data)
      }
    },
    reset () {
      this.setData(this.resetCache)
    }
  }
})

class GenericModel extends GenericModelTemplate {
  constructor (data, { route, schema, request, select }) {
    super()
    this.setData(cloneDeep(data))
    this.route = route
    this.schema = schema
    this.request = request
    this.select = select
    this.post = new ObservableFunction(this._post)
    this.$watch('primaryKeys', {
      deep: false,
      immediate: true,
      handler (newPrimaryKeys) {
        if (newPrimaryKeys && newPrimaryKeys.length > 0) {
          this.patch = new ObservableFunction(this._patch)
          this.delete = new ObservableFunction(this._delete)
          this.get = new ObservableFunction(this._get)
        }
      }
    })
    this.$watch('data', {
      deep: true,
      immediate: true,
      handler (newData) {
        for (const prop in newData) {
          if (!this.watchers[prop]) {
            this.$watch('data.' + prop, {
              deep: true,
              handler (newVal) {
                if (isEqual(newVal, this.resetCache[prop])) {
                  this.$delete(this.diff, prop)
                } else {
                  this.$set(this.diff, prop, newVal)
                }
              }
            })
            this.watchers[prop] = true
          }
        }
      }
    })
  }
}

export default GenericModel
