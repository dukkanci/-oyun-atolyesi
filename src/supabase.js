// Oyun Atölyesi — Supabase Wrapper (GitHub Pages uyumlu, hata toleranslı)

(function() {
  'use strict';

  var SUPABASE_URL = 'https://etwapxyqqelvexqzfrjw.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_bM2BVsg6nz2wW1BABCS8rw_0CuCF64L';
  var CDN_URLS = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/dist/umd/supabase.min.js',
    'https://unpkg.com/@supabase/supabase-js@2.39.0/dist/umd/supabase.min.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'
  ];

  var supabaseClient = null;
  var initPromise = null;

  function uuid() {
    return crypto.randomUUID();
  }

  function loadSupabaseSDK() {
    return new Promise(function(resolve, reject) {
      if (window.supabase && window.supabase.createClient) {
        resolve();
        return;
      }
      var currentIndex = 0;
      function loadNext() {
        if (currentIndex >= CDN_URLS.length) {
          reject(new Error('Tüm CDN\'ler yüklenemedi'));
          return;
        }
        var script = document.createElement('script');
        script.src = CDN_URLS[currentIndex];
        script.crossOrigin = 'anonymous';
        script.onload = function() {
          if (window.supabase && window.supabase.createClient) {
            resolve();
          } else {
            currentIndex++;
            loadNext();
          }
        };
        script.onerror = function() {
          currentIndex++;
          loadNext();
        };
        document.head.appendChild(script);
      }
      loadNext();
    });
  }

  function initSupabase() {
    return loadSupabaseSDK().then(function() {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      var authPromise = supabaseClient.auth.signInAnonymously();
      var timeoutPromise = new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error('Auth timeout (10s)')); }, 10000);
      });
      return Promise.race([authPromise, timeoutPromise]).then(function(result) {
        var error = result.error;
        if (error) {
          return supabaseClient.auth.getSession().then(function(sessionResult) {
            if (!sessionResult.data.session) {
              throw new Error('Oturum açılamadı: ' + error.message);
            }
          });
        }
        console.log('%c[Oyun Atölyesi] Supabase mod aktif (paylaşımlı, real-time)', 'color: #3ECF8E; font-weight: bold');
        return true;
      }).catch(function(e) {
        console.error('[Oyun Atölyesi] Supabase başlatma hatası:', e);
        showError(e.message);
        return false;
      });
    }).catch(function(e) {
      console.error('[Oyun Atölyesi] Supabase SDK yükleme hatası:', e);
      showError(e.message);
      return false;
    });
  }

  function showError(message) {
    var errDiv = document.createElement('div');
    errDiv.style.cssText = 'position:fixed;top:10px;right:10px;background:#fee;padding:10px;border:1px solid #f88;border-radius:8px;max-width:400px;z-index:9999;font-family:monospace;font-size:12px;color:#c00';
    errDiv.innerHTML = '<b>Supabase bağlantı hatası:</b><br>' + message + '<br><br><small>Supabase Dashboard → Authentication → URL Configuration → Site URL ve Redirect URLs\'e <code>https://dukkanci.github.io/-oyun-atolyesi/efsane-proje/</code> ekleyin.</small>';
    document.body.appendChild(errDiv);
  }

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
        var docData = { id: id };
        for (var k in data) docData[k] = data[k];
        if (!docData.createdAt) docData.createdAt = new Date().toISOString();
        return supabaseClient.from(this.tableName).insert(docData).then(function(r) { if (r.error) throw r.error; return { id: id }; });
      },
      onSnapshot: function(onNext, onError) {
        var self = this;
        function runQuery() {
          var query = supabaseClient.from(self.tableName).select('*');
          for (var field in self._query) {
            var q = self._query[field];
            if (q.op === '==') query = query.eq(field, q.value);
          }
          if (self._orderBy) query = query.order(self._orderBy.field, { ascending: self._orderBy.dir === 'asc' });
          if (self._limit) query = query.limit(self._limit);
          query.then(function(r) {
            if (r.error) { onError && onError(r.error); return; }
            var docs = (r.data || []).map(function(d) { return { id: d.id, data: function() { return d; }, exists: true }; });
            onNext({ docs: docs, empty: docs.length === 0 });
          });
        }
        runQuery();
        var channel = supabaseClient.channel('realtime:' + self.tableName).on('postgres_changes', { event: '*', schema: 'public', table: self.tableName }, runQuery).subscribe();
        return function() { supabaseClient.removeChannel(channel); };
      }
    };
  }

  function createMockDoc(tableName, id) {
    return {
      tableName: tableName,
      id: id,
      get: function() {
        return supabaseClient.from(tableName).select('*').eq('id', id).single().then(function(r) {
          if (r.error && r.error.code !== 'PGRST116') throw r.error;
          return { exists: !!r.data, data: function() { return r.data; }, id: id };
        });
      },
      set: function(data) {
        var newData = { id: id };
        for (var k in data) newData[k] = data[k];
        return supabaseClient.from(tableName).upsert(newData).then(function(r) { if (r.error) throw r.error; });
      },
      update: function(data) {
        return supabaseClient.from(tableName).update(data).eq('id', id).then(function(r) { if (r.error) throw r.error; });
      },
      delete: function() {
        return supabaseClient.from(tableName).delete().eq('id', id).then(function(r) { if (r.error) throw r.error; });
      },
      onSnapshot: function(onNext, onError) {
        var channel = supabaseClient.channel('realtime:' + tableName + ':' + id).on('postgres_changes', { event: '*', schema: 'public', table: tableName, filter: 'id=eq.' + id }, function(payload) {
          if (payload.eventType === 'DELETE') onNext({ exists: false, data: function() { return null; }, id: id });
          else onNext({ exists: true, data: function() { return payload.new; }, id: id });
        }).subscribe();
        supabaseClient.from(tableName).select('*').eq('id', id).single().then(onNext).catch(onError);
        return function() { supabaseClient.removeChannel(channel); };
      }
    };
  }

  function createMockUser() {
    return {
      me: function() {
        return supabaseClient.auth.getUser().then(function(r) { return { id: r.data.user ? r.data.user.id : null }; });
      },
      can: function() { return Promise.resolve(true); },
      profiles: function(ids) {
        return supabaseClient.from('users').select('id, name').in('id', ids).then(function(r) {
          var nameMap = {};
          (r.data || []).forEach(function(d) { nameMap[d.id] = d.name; });
          return supabaseClient.auth.getUser().then(function(me) {
            var result = {};
            var myId = me.data.user ? me.data.user.id : null;
            ids.forEach(function(id) { result[id] = { id: id, name: nameMap[id] || (id === myId ? 'Sen' : 'Arkadaşın') }; });
            return result;
          });
        });
      },
      _setCurrentUser: function(id) {}
    };
  }

  function createMockAssets() {
    return {
      upload: function(file, options) {
        var id = uuid();
        var type = (options && options.type) || file.type;
        return supabaseClient.storage.from('assets').upload(id, file, { contentType: type, upsert: false }).then(function(r) {
          if (r.error) throw r.error;
          var publicUrlData = supabaseClient.storage.from('assets').getPublicUrl(id);
          return supabaseClient.from('assets').upsert({ id: id, url: publicUrlData.data.publicUrl, type: type, size: file.size, name: file.name }).then(function() { return { id: id }; });
        });
      },
      delete: function(id) {
        return supabaseClient.storage.from('assets').remove([id]).then(function() {
          return supabaseClient.from('assets').delete().eq('id', id);
        });
      },
      getUrl: function(id) {
        return supabaseClient.from('assets').select('url').eq('id', id).single().then(function(r) {
          if (r.data && r.data.url) return r.data.url;
          var publicUrlData = supabaseClient.storage.from('assets').getPublicUrl(id);
          return publicUrlData.data.publicUrl;
        });
      }
    };
  }

  function createMockRoom() {
    var ROOM_NAME = 'default';
    return {
      presence: function(data) {
        return supabaseClient.auth.getUser().then(function(r) {
          var user = r.data.user;
          if (!user) return;
          if (data) {
            var d = { room: ROOM_NAME, user_id: user.id, updated_at: new Date().toISOString() };
            for (var k in data) d[k] = data[k];
            return supabaseClient.from('room_presence').upsert(d);
          } else {
            return supabaseClient.from('room_presence').delete().eq('room', ROOM_NAME).eq('user_id', user.id);
          }
        });
      },
      peers: function() {
        return supabaseClient.from('room_presence').select('user_id, *').eq('room', ROOM_NAME).then(function(r) {
          return supabaseClient.auth.getUser().then(function(me) {
            var myId = me.data.user ? me.data.user.id : null;
            return (r.data || []).map(function(d) { return { peer: d.user_id, by: d.user_id, presence: d, sameTab: d.user_id === myId }; });
          });
        });
      },
      onPeers: function(cb) {
        var channel = supabaseClient.channel('room_presence:' + ROOM_NAME).on('postgres_changes', { event: '*', schema: 'public', table: 'room_presence', filter: 'room=eq.' + ROOM_NAME }, function() {
          supabaseClient.from('room_presence').select('user_id, *').eq('room', ROOM_NAME).then(function(r) {
            cb({ peers: r.data || [], left: [] });
          });
        }).subscribe();
        return function() { supabaseClient.removeChannel(channel); };
      },
      on: function(event, cb) {
        if (event === 'voice') {
          return supabaseClient.auth.getUser().then(function(r) {
            var me = r.data.user;
            if (!me) return function() {};
            var channel = supabaseClient.channel('room_signaling:' + ROOM_NAME).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_signaling', filter: 'to=eq.' + me.id }, function(payload) {
              cb({ peer: payload.new.from, data: payload.new.data, sameTab: false });
              supabaseClient.from('room_signaling').delete().eq('id', payload.new.id).catch(function() {});
            }).subscribe();
            return function() { supabaseClient.removeChannel(channel); };
          });
        }
        return function() {};
      },
      emit: function(event, data) {
        if (event === 'voice') {
          return supabaseClient.auth.getUser().then(function(r) {
            var me = r.data.user;
            if (!me) return;
            return supabaseClient.from('room_signaling').insert({ room: ROOM_NAME, from: me.id, to: data.to, data: data.data, created_at: new Date().toISOString() });
          });
        }
      }
    };
  }

  window.claude = window.claude || {};
  window.claude.use = function(name) {
    if (!supabaseClient) {
      if (!initPromise) initPromise = initSupabase();
      return initPromise.then(function(ok) { return ok ? buildAPI() : null; });
    }
    return Promise.resolve(buildAPI());
  };

  function buildAPI() {
    return {
      db: { collection: createMockCollection, doc: function(path) { var parts = path.split('/'); return createMockDoc(parts[0], parts[1]); } },
      user: createMockUser(),
      assets: createMockAssets(),
      room: createMockRoom()
    };
  }

  if (typeof window !== 'undefined') {
    initPromise = initSupabase();
  }
})();