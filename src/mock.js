// Oyun Atölyesi — Bağımsız HTML Mock'u (localStorage tabanlı)
// claude.ai Artifact API'sini (S.db, S.user, S.assets, S.room) taklit eder.
// Eğer gerçek claude.ai ortamı varsa (window.claude.use mevcutsa) mock DEVRE DİŞI kalır.
// Bu mock her build'de (production + dev) dahil edilir; gerçek ortamda devre dışı kalır.

(function() {
  'use strict';

  // Gerçek claude.ai ortamı var mı kontrol et
  const hasRealClaude = window.claude && typeof window.claude.use === 'function';

  // Gerçek ortam varsa mock'u devre dışı bırak
  if (hasRealClaude) {
    console.log('%c[Oyun Atölyesi] Gerçek claude.ai ortamı tespit edildi - Mock devre dışı', 'color: #2196F3; font-weight: bold');
    // window.claude zaten gerçek API'yi sağlıyor, mock'a gerek yok
  } else {
    // Mock'u başlat
    initMock();
  }

  function initMock() {
    'use strict';

    // --- Yardımcılar ---
    const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });

    const now = () => Date.now();

    // localStorage wrapper
    const ls = {
      get(k) { try { return localStorage.getItem(k); } catch { return null; } },
      set(k, v) { try { localStorage.setItem(k, v); } catch {} },
      del(k) { try { localStorage.removeItem(k); } catch {} },
      keys(prefix = '') {
        try {
          return Object.keys(localStorage).filter(k => k.startsWith(prefix));
        } catch { return []; }
      }
    };

    // Collection prefix: "atolye-db-{collection}-"
    const COLLECTION_PREFIX = 'atolye-db-';

    function getCollectionStore(name) {
      const prefix = COLLECTION_PREFIX + name + '-';
      const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
      const docs = {};
      for (const key of keys) {
        const id = key.slice(prefix.length);
        try {
          docs[id] = JSON.parse(localStorage.getItem(key));
        } catch {}
      }
      return docs;
    }

    function setCollectionDoc(name, id, data) {
      const key = COLLECTION_PREFIX + name + '-' + id;
      localStorage.setItem(key, JSON.stringify({ ...data, id }));
      notifyChange(name);
    }

    function delCollectionDoc(name, id) {
      const key = COLLECTION_PREFIX + name + '-' + id;
      localStorage.removeItem(key);
      notifyChange(name);
    }

    function notifyChange(store) {
      window.dispatchEvent(new CustomEvent('atolye-db-change', { detail: { store } }));
    }

    // --- Mock Database API ---
    class MockCollection {
      constructor(name) {
        this.name = name;
        this._query = {};
        this._orderBy = null;
        this._limit = null;
      }

      doc(id) {
        return new MockDoc(this.name, id);
      }

      where(field, op, value) {
        this._query[field] = { op, value };
        return this;
      }

      orderBy(field, dir = 'asc') {
        this._orderBy = { field, dir };
        return this;
      }

      limit(n) {
        this._limit = n;
        return this;
      }

      add(data) {
        const id = uuid();
        const doc = { id, ...data, createdAt: data.createdAt || now() };
        setCollectionDoc(this.name, id, doc);
        return Promise.resolve({ id });
      }

      onSnapshot(onNext, onError) {
        let unsubscribed = false;

        const runQuery = () => {
          if (unsubscribed) return;
          const docs = getCollectionStore(this.name);
          let results = Object.values(docs);

          // where filtresi
          for (const [field, { op, value }] of Object.entries(this._query)) {
            if (op === '==') results = results.filter(d => d[field] === value);
          }

          // orderBy
          if (this._orderBy) {
            const { field, dir } = this._orderBy;
            results.sort((a, b) => {
              const av = a[field], bv = b[field];
              if (av === bv) return 0;
              const cmp = av < bv ? -1 : 1;
              return dir === 'desc' ? -cmp : cmp;
            });
          }

          // limit
          if (this._limit) results = results.slice(0, this._limit);

          onNext({
            docs: results.map(d => ({ id: d.id, data: () => d, exists: true })),
            empty: results.length === 0
          });
        };

        // İlk çalıştırma
        runQuery();

        // Storage event listener for cross-tab sync
        const storageHandler = e => {
          if (e.key && e.key.startsWith('atolye-db-' + this.name)) runQuery();
        };
        window.addEventListener('storage', storageHandler);

        // Custom event for same-tab updates
        const changeHandler = e => {
          if (e.detail?.store === this.name) runQuery();
        };
        window.addEventListener('atolye-db-change', changeHandler);

        return () => {
          unsubscribed = true;
          window.removeEventListener('storage', storageHandler);
          window.removeEventListener('atolye-db-change', changeHandler);
        };
      }
    }

    class MockDoc {
      constructor(store, id) {
        this.store = store;
        this.id = id;
      }

      get() {
        const docs = getCollectionStore(this.store);
        const data = docs[this.id];
        return Promise.resolve({
          exists: !!data,
          data: () => data,
          id: this.id
        });
      }

      set(data) {
        setCollectionDoc(this.store, this.id, { ...data, id: this.id });
        return Promise.resolve();
      }

      update(data) {
        const docs = getCollectionStore(this.store);
        const existing = docs[this.id] || { id: this.id };
        const updated = { ...existing, ...data };
        setCollectionDoc(this.store, this.id, updated);
        return Promise.resolve();
      }

      delete() {
        delCollectionDoc(this.store, this.id);
        return Promise.resolve();
      }

      onSnapshot(onNext, onError) {
        let unsubscribed = false;

        const runQuery = () => {
          if (unsubscribed) return;
          const docs = getCollectionStore(this.store);
          const data = docs[this.id];
          onNext({
            exists: !!data,
            data: () => data,
            id: this.id
          });
        };

        runQuery();
        const storageHandler = e => {
          if (e.key && e.key.startsWith(COLLECTION_PREFIX + this.store)) runQuery();
        };
        const changeHandler = e => {
          if (e.detail?.store === this.store) runQuery();
        };
        window.addEventListener('storage', storageHandler);
        window.addEventListener('atolye-db-change', changeHandler);

        return () => {
          unsubscribed = true;
          window.removeEventListener('storage', storageHandler);
          window.removeEventListener('atolye-db-change', changeHandler);
        };
      }
    }

    // --- Mock User API ---
    const MOCK_USERS = {
      'user-a': { id: 'user-a', name: 'Sen' },
      'user-b': { id: 'user-b', name: 'Arkadaşın' }
    };

    let currentUserId = 'user-a';

    const mockUser = {
      me() {
        return Promise.resolve({ id: currentUserId });
      },
      can(permission) {
        return Promise.resolve(true); // Herkese yazma izni ver
      },
      profiles(ids) {
        const result = {};
        for (const id of ids) {
          result[id] = MOCK_USERS[id] || { id, name: 'Bilinmeyen' };
        }
        return Promise.resolve(result);
      },
      // Debug: kullanıcı değiştirmek için
      _setCurrentUser(id) {
        currentUserId = id;
      }
    };

    // --- Mock Assets API ---
    const ASSET_PREFIX = 'atolye-asset-';

    const mockAssets = {
      async upload(file, options = {}) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const id = uuid();
            const data = reader.result;
            const type = options.type || file.type;
            const size = file.size;

            try {
              localStorage.setItem('atolye-asset-' + id, JSON.stringify({ data, type, size, name: file.name }));
            } catch (e) {
              reject({ code: 'quota_or_state' });
              return;
            }

            resolve({ id });
          };
          reader.onerror = () => reject({ code: 'unknown' });
          reader.readAsDataURL(file);
        });
      },

      async delete(id) {
        localStorage.removeItem('atolye-asset-' + id);
      },

      getUrl(id) {
        const stored = localStorage.getItem('atolye-asset-' + id);
        if (stored) {
          const { data } = JSON.parse(stored);
          return data;
        }
        return '/_blob/' + id; // fallback
      }
    };

    // --- Mock Room API (Presence) ---
    const mockRoom = {
      presence(data) {
        return Promise.resolve();
      },
      peers() {
        return Promise.resolve([]);
      },
      onPeers(cb) {
        return () => {};
      },
      on(event, cb) {
        return () => {};
      },
      emit(event, data) {
        return Promise.resolve();
      }
    };

    // --- Global claude.use mock ---
    window.claude = window.claude || {};
    window.claude.use = async (name) => {
      switch (name) {
        case 'db':
          return {
            collection: (name) => new MockCollection(name),
            doc: (path) => {
              const [store, id] = path.split('/');
              return new MockDoc(store, id);
            }
          };
        case 'user':
          return mockUser;
        case 'assets':
          return mockAssets;
        case 'room':
          return mockRoom;
        default:
          return null;
      }
    };

    // --- URL helper for assets ---
    window.imgUrl = (id) => mockAssets.getUrl(id);

    // --- Development mode indicator ---
    console.log('%c[Oyun Atölyesi] Bağımsız mod aktif - Mock API yüklendi (localStorage)', 'color: #4CAF50; font-weight: bold');
    console.log('Kullanıcı değiştirmek için: window.claude.use("user")._setCurrentUser("user-b")');
    console.log('Verileri temizlemek için: localStorage.clear()');
  }

  // Mock'u başlat (gerçek ortam yoksa)
  if (typeof window !== 'undefined') {
    // Sayfa yüklendiğinde kontrol et
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        if (!window.claude || typeof window.claude.use !== 'function') {
          initMock();
        }
      });
    } else {
      if (!window.claude || typeof window.claude.use !== 'function') {
        initMock();
      }
    }
  }

})();