// Oyun Atölyesi — Supabase Wrapper (GitHub Pages uyumlu, hata toleranslı)
// claude.ai Artifact API'sini (S.db, S.user, S.assets, S.room) taklit eder.

(function() {
  'use strict';

  // Supabase config
  const SUPABASE_URL = 'https://etwapxyqqelvexqzfrjw.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_bM2BVsg6nz2wW1BABCS8rw_0CuCF64L';

  // CDN URL'leri (fallback sırasıyla)
  const CDN_URLS = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/dist/umd/supabase.min.js',
    'https://unpkg.com/@supabase/supabase-js@2.39.0/dist/umd/supabase.min.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'
  ];

  let supabase = null;
  let initPromise = null;

  function loadSupabaseSDK() {
    return new Promise((resolve, reject) => {
      if (window.supabase && window.supabase.createClient) {
        resolve();
        return;
      }

      let currentIndex = 0;
      const loadNext = () => {
        if (currentIndex >= CDN_URLS.length) {
          reject(new Error('Tüm CDN\'ler yüklenemedi'));
          return;
        }
        const script = document.createElement('script');
        script.src = CDN_URLS[currentIndex];
        script.crossOrigin = 'anonymous';
        script.onload = () => {
          if (window.supabase && window.supabase.createClient) {
            resolve();
          } else {
            currentIndex++;
            loadNext();
          }
        };
        script.onerror = () => {
          currentIndex++;
          loadNext();
        };
        document.head.appendChild(script);
      };
      loadNext();
    });
  }

  async function initSupabase() {
    try {
      await loadSupabaseSDK();

      // Supabase client oluştur
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });

      // Anonim auth ile giriş yap (timeout ile)
      const authPromise = supabase.auth.signInAnonymously();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Auth timeout (10s)')), 10000)
      );

      const { data: { user }, error } = await Promise.race([authPromise, timeoutPromise]);
      if (error) {
        // Mevcut session varsa kullan
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Oturum açılamadı: ' + error.message);
      }

      console.log('%c[Oyun Atölyesi] Supabase mod aktif (paylaşımlı, real-time)', 'color: #3ECF8E; font-weight: bold');
      return true;
    } catch (e) {
      console.error('[Oyun Atölyesi] Supabase başlatma hatası:', e);
      // Hata detayını göster
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'position:fixed;top:10px;right:10px;background:#fee;padding:10px;border:1px solid #f88;border-radius:8px;max-width:400px;z-index:9999;font-family:monospace;font-size:12px;color:#c00';
      errDiv.innerHTML = '<b>Supabase bağlantı hatası:</b><br>' + e.message + '<br><br><small>Supabase Dashboard → Authentication → URL Configuration → Site URL ve Redirect URLs\'e <code>https://dukkanci.github.io/-oyun-atolyesi/efsane-proje/</code> ekleyin.</small>';
      document.body.appendChild(errDiv);
      return false;
    }
  }

  // Global claude.use mock'u hemen tanımla (supabase hazır olana kadar bekler)
  window.claude = window.claude || {};
  window.claude.use = async (name) => {
    // Supabase henüz hazır değilse bekle
    if (!supabase) {
      if (!initPromise) initPromise = initSupabase();
      const ok = await initPromise;
      if (!ok) return null; // Hata durumunda null dön → app "yerel mod" gösterir
    }
    if (!supabase) return null;

    // --- Yardımcılar ---
    const uuid = () => crypto.randomUUID();

    // --- Database API ---
    class MockCollection {
      constructor(tableName) {
        this.tableName = tableName;
        this._query = {};
        this._orderBy = null;
        this._limit = null;
      }

      doc(id) {
        return new MockDoc(this.tableName, id);
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
        const docData = { id, ...data, createdAt: data.createdAt || new Date().toISOString() };
        return supabase.from(this.tableName).insert(docData)
          .then(({ error }) => { if (error) throw error; return { id }; });
      }

      onSnapshot(onNext, onError) {
        let query = supabase.from(this.tableName).select('*');

        for (const [field, { op, value }] of Object.entries(this._query)) {
          if (op === '==') query = query.eq(field, value);
        }
        if (this._orderBy) {
          query = query.order(this._orderBy.field, { ascending: this._orderBy.dir === 'asc' });
        }
        if (this._limit) query = query.limit(this._limit);

        // İlk veri
        query.then(({ data, error }) => {
          if (error) { onError?.(error); return; }
          const docs = (data || []).map(d => ({ id: d.id, data: () => d, exists: true }));
          onNext({ docs, empty: docs.length === 0 });
        });

        // Realtime
        const channel = supabase
          .channel(`realtime:${this.tableName}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: this.tableName }, () => {
            query.then(({ data, error }) => {
              if (error) { onError?.(error); return; }
              const docs = (data || []).map(d => ({ id: d.id, data: () => d, exists: true }));
              onNext({ docs, empty: docs.length === 0 });
            });
          })
          .subscribe();

        return () => supabase.removeChannel(channel);
      }
    }

    class MockDoc {
      constructor(tableName, id) {
        this.tableName = tableName;
        this.id = id;
      }

      get() {
        return supabase.from(this.tableName).select('*').eq('id', this.id).single()
          .then(({ data, error }) => {
            if (error && error.code !== 'PGRST116') throw error;
            return { exists: !!data, data: () => data, id: this.id };
          });
      }

      set(data) {
        return supabase.from(this.tableName).upsert({ ...data, id: this.id })
          .then(({ error }) => { if (error) throw error; });
      }

      update(data) {
        return supabase.from(this.tableName).update(data).eq('id', this.id)
          .then(({ error }) => { if (error) throw error; });
      }

      delete() {
        return supabase.from(this.tableName).delete().eq('id', this.id)
          .then(({ error }) => { if (error) throw error; });
      }

      onSnapshot(onNext, onError) {
        const channel = supabase
          .channel(`realtime:${this.tableName}:${this.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: this.tableName, filter: `id=eq.${this.id}` }, (payload) => {
            if (payload.eventType === 'DELETE') {
              onNext({ exists: false, data: () => null, id: this.id });
            } else {
              onNext({ exists: true, data: () => payload.new, id: this.id });
            }
          })
          .subscribe();

        this.get().then(onNext).catch(onError);
        return () => supabase.removeChannel(channel);
      }
    }

    // --- User API ---
    const mockUser = {
      async me() {
        const { data: { user } } = await supabase.auth.getUser();
        return { id: user?.id };
      },
      async can(permission) {
        return true;
      },
      async profiles(ids) {
        const result = {};
        const { data } = await supabase.from('users').select('id, name').in('id', ids);
        const nameMap = new Map((data || []).map(d => [d.id, d.name]));
        const { data: { user: me } } = await supabase.auth.getUser();
        for (const id of ids) {
          result[id] = { id, name: nameMap.get(id) || (id === me?.id ? 'Sen' : 'Arkadaşın') };
        }
        return result;
      },
      _setCurrentUser(id) {}
    };

    // --- Assets API ---
    const mockAssets = {
      async upload(file, options = {}) {
        const id = uuid();
        const type = options.type || file.type;
        const { data, error } = await supabase.storage
          .from('assets')
          .upload(id, file, { contentType: type, upsert: false });
        if (error) throw error;

        const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(id);
        await supabase.from('assets').upsert({ id, url: publicUrl, type, size: file.size, name: file.name });
        return { id };
      },
      async delete(id) {
        await supabase.storage.from('assets').remove([id]);
        await supabase.from('assets').delete().eq('id', id);
      },
      async getUrl(id) {
        const { data } = await supabase.from('assets').select('url').eq('id', id).single();
        if (data?.url) return data.url;
        const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(id);
        return publicUrl;
      }
    };

    // --- Room API ---
    const ROOM_NAME = 'default';

    const mockRoom = {
      async presence(data) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        if (data) {
          await supabase.from('room_presence').upsert({ room: ROOM_NAME, user_id: user.id, ...data, updated_at: new Date().toISOString() });
        } else {
          await supabase.from('room_presence').delete().eq('room', ROOM_NAME).eq('user_id', user.id);
        }
      },
      async peers() {
        const { data } = await supabase.from('room_presence').select('user_id, *').eq('room', ROOM_NAME);
        const { data: { user: me } } = await supabase.auth.getUser();
        return (data || []).map(d => ({ peer: d.user_id, by: d.user_id, presence: d, sameTab: d.user_id === me?.id }));
      },
      onPeers(cb) {
        const channel = supabase
          .channel(`room_presence:${ROOM_NAME}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'room_presence', filter: `room=eq.${ROOM_NAME}` }, () => {
            this.peers().then(peers => {
              cb({ peers, left: [] });
            });
          })
          .subscribe();
        return () => supabase.removeChannel(channel);
      },
      on(event, cb) {
        if (event === 'voice') {
          const { data: { user: me } } = await supabase.auth.getUser();
          if (!me) return () => {};
          const channel = supabase
            .channel(`room_signaling:${ROOM_NAME}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_signaling', filter: `to=eq.${me.id}` }, (payload) => {
              cb({ peer: payload.new.from, data: payload.new.data, sameTab: false });
              supabase.from('room_signaling').delete().eq('id', payload.new.id).catch(() => {});
            })
            .subscribe();
          return () => supabase.removeChannel(channel);
        }
        return () => {};
      },
      async emit(event, data) {
        if (event === 'voice') {
          const { data: { user: me } } = await supabase.auth.getUser();
          if (!me) return;
          await supabase.from('room_signaling').insert({
            room: ROOM_NAME, from: me.id, to: data.to, data: data.data, created_at: new Date().toISOString()
          });
        }
      }
    };

    return {
      db: {
        collection: (name) => new MockCollection(name),
        doc: (path) => {
          const [store, id] = path.split('/');
          return new MockDoc(store, id);
        }
      },
      user: mockUser,
      assets: mockAssets,
      room: mockRoom
    };
  };

  // Başlatmayı hemen tetikle (await etmez, arka planda başlar)
  if (typeof window !== 'undefined') {
    initPromise = initSupabase();
  }
})();