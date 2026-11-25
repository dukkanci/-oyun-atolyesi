// Oyun Atölyesi — Yerel localStorage Backend (Supabase yerine, CDN bağımlılığı yok)
// claude.ai Artifact API'sini (S.db, S.user, S.assets, S.room) taklit eder.
// Bu dosya Supabase SDK'sını YÜKLEMEZ, tamamen localStorage tabanlı çalışır.

(function() {
  'use strict';

  // Development mode check
  const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  // Helper functions
  function uuid() {
    return crypto.randomUUID();
  }

  function toSnakeCase(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    var result = {};
    for (var k in obj) {
      if (!obj.hasOwnProperty(k)) continue;
      var snakeKey = k.replace(/[A-Z]/g, function(letter) { return '_' + letter.toLowerCase(); });
      var val = obj[k];
      result[snakeKey] = (val && typeof val === 'object' && !Array.isArray(val)) ? toSnakeCase(val) : val;
    }
    return result;
  }

  function fromSnakeCase(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    var result = {};
    for (var k in obj) {
      if (!obj.hasOwnProperty(k)) continue;
      var camelKey = k.replace(/_([a-z])/g, function(_, letter) { return letter.toUpperCase(); });
      var val = obj[k];
      result[camelKey] = (val && typeof val === 'object' && !Array.isArray(val)) ? fromSnakeCase(val) : val;
    }
    return result;
  }

  // localStorage wrapper
  var STORAGE_PREFIX = 'supabase_';
  var COLLECTION_PREFIX = STORAGE_PREFIX + 'collection_';
  var DOC_PREFIX = STORAGE_PREFIX + 'doc_';
  var STORAGE_PREFIX_ASSETS = STORAGE_PREFIX + 'assets_';

  function getStorageKey(type, name) {
    if (type === 'collection') return COLLECTION_PREFIX + name;
    if (type === 'doc') return DOC_PREFIX + name;
    if (type === 'assets') return STORAGE_PREFIX_ASSETS + name;
    return STORAGE_PREFIX + name;
  }

  function getCollection(name) {
    var key = getStorageKey('collection', name);
    try {
      var data = localStorage.getItem(key);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  }

  function setCollection(name, data) {
    var key = getStorageKey('collection', name);
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      if (isDev) console.error('localStorage yazma hatası:', e);
    }
  }

  function getDoc(name, id) {
    var key = getStorageKey('doc', name + '_' + id);
    try {
      var data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  function setDoc(name, id, data) {
    var key = getStorageKey('doc', name + '_' + id);
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      if (isDev) console.error('localStorage yazma hatası:', e);
    }
  }

  function deleteDoc(name, id) {
    var key = getStorageKey('doc', name + '_' + id);
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  }

  function getAllDocs(name) {
    var collection = getCollection(name);
    var ids = Object.keys(collection);
    var docs = {};
    for (var i = 0; i < ids.length; i++) {
      var doc = getDoc(name, ids[i]);
      if (doc) docs[ids[i]] = doc;
    }
    return docs;
  }

  // Simple event system for real-time-ish updates
  var listeners = {};

  function notifyChange(tableName) {
    if (listeners[tableName]) {
      listeners[tableName].forEach(function(cb) { cb(); });
    }
  }

  function subscribe(tableName, callback) {
    if (!listeners[tableName]) listeners[tableName] = [];
    listeners[tableName].push(callback);
    return function() {
      var idx = listeners[tableName].indexOf(callback);
      if (idx > -1) listeners[tableName].splice(idx, 1);
    };
  }

  // Mock Collection (localStorage-based)
  function createMockCollection(tableName) {
    return {
      tableName: tableName,
      _query: {},
      _orderBy: null,
      _limit: null,
      doc: function(id) { return createMockDoc(tableName, id); },
      where: function(field, op, value) { this._query[field] = { op: op, value: value }; return this; },
      orderBy: function(field, dir) { this._orderBy = { field: field, dir: dir || 'asc' }; return this; },
      limit: function(n) { this._limit = n; return this; },
      add: function(data) {
        var id = uuid();
        var now = new Date().toISOString();
        var docData = { id: id, ...data, createdAt: data.createdAt || now, updatedAt: now };
        var snakeData = toSnakeCase(docData);
        setDoc(tableName, id, snakeData);
        var collection = getCollection(tableName);
        collection[id] = true;
        setCollection(tableName, collection);
        notifyChange(tableName);
        return Promise.resolve({ id: id });
      },
      onSnapshot: function(onNext, onError) {
        var self = this;
        function runQuery() {
          var docs = getAllDocs(self.tableName);
          var results = Object.values(docs).map(function(d) { return fromSnakeCase(d); });

          // Apply where filter
          for (var field in self._query) {
            var q = self._query[field];
            if (q.op === '==') {
              results = results.filter(function(d) { return d[field] === q.value; });
            }
          }

          // Apply orderBy
          if (self._orderBy) {
            var f = self._orderBy.field;
            var asc = self._orderBy.dir === 'asc';
            results.sort(function(a, b) {
              var av = a[f], bv = b[f];
              if (av === bv) return 0;
              return (av < bv ? -1 : 1) * (asc ? 1 : -1);
            });
          }

          // Apply limit
          if (self._limit) results = results.slice(0, self._limit);

          var docsArray = results.map(function(d) {
            return { id: d.id, data: function() { return d; }, exists: true };
          });
          onNext({ docs: docsArray, empty: docsArray.length === 0 });
        }

        runQuery();
        var unsubscribe = subscribe(self.tableName, runQuery);
        return function() { unsubscribe(); };
      }
    };
  }

  function createMockDoc(tableName, id) {
    return {
      tableName: tableName,
      id: id,
      get: function() {
        var data = getDoc(tableName, id);
        return Promise.resolve({
          exists: !!data,
          data: data ? function() { return fromSnakeCase(data); } : function() { return null; },
          id: id
        });
      },
      set: function(data) {
        var newData = { id: id };
        for (var k in data) newData[k] = data[k];
        var snakeData = toSnakeCase(newData);
        setDoc(tableName, id, snakeData);
        var collection = getCollection(tableName);
        collection[id] = true;
        setCollection(tableName, collection);
        notifyChange(tableName);
        return Promise.resolve();
      },
      update: function(data) {
        var snakeData = toSnakeCase(data);
        var existing = getDoc(tableName, id) || {};
        var merged = Object.assign({}, existing, snakeData);
        setDoc(tableName, id, merged);
        notifyChange(tableName);
        return Promise.resolve();
      },
      delete: function() {
        deleteDoc(tableName, id);
        var collection = getCollection(tableName);
        delete collection[id];
        setCollection(tableName, collection);
        notifyChange(tableName);
        return Promise.resolve();
      },
      onSnapshot: function(onNext, onError) {
        var self = this;
        function runQuery() {
          var data = getDoc(self.tableName, self.id);
          onNext({
            exists: !!data,
            data: data ? function() { return fromSnakeCase(data); } : function() { return null; },
            id: self.id
          });
        }
        runQuery();
        var unsubscribe = subscribe(self.tableName, runQuery);
        return function() { unsubscribe(); };
      }
    };
  }

  function createMockAssets() {
    return {
      upload: function(file, options) {
        var id = uuid();
        var type = (options && options.type) || file.type;
        return new Promise(function(resolve, reject) {
          var reader = new FileReader();
          reader.onload = function() {
            try {
              var assetData = {
                id: id,
                data: reader.result,
                type: type,
                size: file.size,
                name: file.name,
                uploadedAt: new Date().toISOString()
              };
              var key = STORAGE_PREFIX_ASSETS + id;
              localStorage.setItem(key, JSON.stringify(assetData));
              resolve({ id: id });
            } catch (e) {
              reject(e);
            }
          };
          reader.onerror = function() { reject(new Error('Dosya okunamadı')); };
          reader.readAsDataURL(file);
        });
      },
      delete: function(id) {
        var key = STORAGE_PREFIX_ASSETS + id;
        localStorage.removeItem(key);
        return Promise.resolve();
      },
      getUrl: function(id) {
        var key = STORAGE_PREFIX_ASSETS + id;
        var data = localStorage.getItem(key);
        if (data) {
          var asset = JSON.parse(data);
          return Promise.resolve(asset.data);
        }
        return Promise.resolve('/_blob/' + id);
      }
    };
  }

  // Expose localStorage backend via window.claude.use
  // This is the primary backend - no CDN, no external dependencies
  window.claude = window.claude || {};
  window.claude.use = function(name) {
    switch (name) {
      case 'db':
        return Promise.resolve({
          collection: createMockCollection,
          doc: function(path) {
            var parts = path.split('/');
            return createMockDoc(parts[0], parts[1]);
          }
        });
      case 'assets':
        return Promise.resolve(createMockAssets());
      default:
        return Promise.resolve(null);
    }
  };

  // No auto-initialization, no CDN loading
  if (isDev) console.log('%c[Oyun Atölyesi] Yerel mod aktif (localStorage, CDN yok)', 'color: #4CAF50; font-weight: bold');
})();