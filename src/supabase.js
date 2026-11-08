// Oyun Atölyesi — Supabase Wrapper (mock.js / firebase.js yerine)
// claude.ai Artifact API'sini (S.db, S.user, S.assets, S.room) taklit eder.
// Gerçek Supabase (PostgreSQL + Realtime + Storage) kullanır.

(function() {
  'use strict';

  // Supabase config
  const SUPABASE_URL = 'https://etwapxyqqelvexqzfrjw.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_bM2BVsg6nz2wW1BABCS8rw_0CuCF64L';

  // Global supabase namespace'ini bekle (CDN'den yüklenecek)
  function waitForSupabase() {
    return new Promise((resolve) => {
      if (window.supabase && window.supabase.createClient) {
        resolve();
        return;
      }
      const check = setInterval(() => {
        if (window.supabase && window.supabase.createClient) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });
  }

  async function initSupabase() {
    await waitForSupabase();

    // Supabase client oluştur
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    // Anonymous auth ile giriş yap
    const { data: { user }, error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.error('Supabase anon auth hatası:', error);
      // Mevcut session varsa kullan
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Oturum açılamadı');
    }
    const currentUser = supabase.auth.getUser().then(({ data: { user } }) => user);

    // --- Yardımcılar ---
    const uuid = () => crypto.randomUUID();

    // --- Database API (Supabase wrapper) ---
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
        const docData = { id, ...data, createdAt: data.createdAt || new Date().toISOString() };
        return supabase.from(this.name).insert(docData)
          .then(({ error }) => {
            if (error) throw error;
            return { id };
          });
      }

      onSnapshot(onNext, onError) {
        let query = supabase.from(this.name).select('*');

        // where filtresi
        for (const [field, { op, value }] of Object.entries(this._query)) {
          if (op === '==') query = query.eq(field, value);
        }

        // orderBy
        if (this._orderBy) {
          query = query.order(this._orderBy.field, { ascending: this._orderBy.dir === 'asc' });
        }

        // limit
        if (this._limit) query = query.limit(this._limit);

        // İlk veri çek
        query.then(({ data, error }) => {
          if (error) { onError?.(error); return; }
          const docs = (data || []).map(d => ({ id: d.id, data: () => d, exists: true }));
          onNext({ docs, empty: docs.length === 0 });
        });

        // Realtime aboneliği
        const channel = supabase
          .channel(`realtime:${this.name}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: this.name }, () => {
            // Değişiklik olduğunda tekrar sorgu yap
            query.then(({ data, error }) => {
              if (error) { onError?.(error); return; }
              const docs = (data || []).map(d => ({ id: d.id, data: () => d, exists: true }));
              onNext({ docs, empty: docs.length === 0 });
            });
          })
          .subscribe();

        return () => {
          supabase.removeChannel(channel);
        };
      }
    }

    class MockDoc {
      constructor(store, id) {
        this.store = store;
        this.id = id;
      }

      get() {
        return supabase.from(this.store).select('*').eq('id', this.id).single()
          .then(({ data, error }) => {
            if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
            return {
              exists: !!data,
              data: () => data,
              id: this.id
            };
          });
      }

      set(data) {
        return supabase.from(this.store).upsert({ ...data, id: this.id })
          .then(({ error }) => { if (error) throw error; });
      }

      update(data) {
        return supabase.from(this.store).update(data).eq('id', this.id)
          .then(({ error }) => { if (error) throw error; });
      }

      delete() {
        return supabase.from(this.store).delete().eq('id', this.id)
          .then(({ error }) => { if (error) throw error; });
      }

      onSnapshot(onNext, onError) {
        const channel = supabase
          .channel(`realtime:${this.store}:${this.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: this.store, filter: `id=eq.${this.id}` }, (payload) => {
            if (payload.eventType === 'DELETE') {
              onNext({ exists: false, data: () => null, id: this.id });
            } else {
              onNext({ exists: true, data: () => payload.new, id: this.id });
            }
          })
          .subscribe();

        // İlk veri
        this.get().then(onNext).catch(onError);

        return () => supabase.removeChannel(channel);
      }
    }

    // --- User API ---
    const mockUser = {
      async me() {
        const { data: { user } } = await supabase.auth.getUser();
        return { id: user?.id || (await currentUser).id };
      },
      async can(permission) {
        return true; // Anonim herkese yazma izni
      },
      async profiles(ids) {
        const result = {};
        // users tablosundan isimleri çek (varsa)
        const { data } = await supabase.from('users').select('id, name').in('id', ids);
        const nameMap = new Map((data || []).map(d => [d.id, d.name]));
        for (const id of ids) {
          const me = await this.me();
          result[id] = { id, name: nameMap.get(id) || (id === me.id ? 'Sen' : 'Arkadaşın') };
        }
        return result;
      },
      _setCurrentUser(id) {
        // Debug için - Supabase'de UID değiştirilemez
      }
    };

    // Kullanıcı profilini kaydet/güncelle
    async function saveUserProfile(uid, name) {
      await supabase.from('users').upsert({ id: uid, name, updated_at: new Date().toISOString() });
    }

    // --- Assets API (Supabase Storage wrapper) ---
    const mockAssets = {
      async upload(file, options = {}) {
        const id = uuid();
        const type = options.type || file.type;
        const { data, error } = await supabase.storage
          .from('assets')
          .upload(id, file, { contentType: type, upsert: false });
        if (error) throw error;

        // Public URL al
        const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(id);
        // URL'yi assets tablosuna da kaydet (getUrl için fallback)
        await supabase.from('assets').upsert({ id, url: publicUrl, type, size: file.size, name: file.name });
        return { id };
      },

      async delete(id) {
        await supabase.storage.from('assets').remove([id]);
        await supabase.from('assets').delete().eq('id', id);
      },

      async getUrl(id) {
        // Önce assets tablosundan dene
        const { data } = await supabase.from('assets').select('url').eq('id', id).single();
        if (data?.url) return data.url;
        // Fallback: Storage'dan public URL
        const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(id);
        return publicUrl;
      }
    };

    // --- Room API (Supabase Realtime presence) ---
    const ROOM_NAME = 'default';

    const mockRoom = {
      async presence(data) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const presenceData = data ? { ...data, uid: user.id, updated_at: new Date().toISOString() } : null;
        if (presenceData) {
          await supabase.from('room_presence').upsert({ room: ROOM_NAME, user_id: user.id, ...presenceData });
        } else {
          await supabase.from('room_presence').delete().eq('room', ROOM_NAME).eq('user_id', user.id);
        }
      },
      async peers() {
        const { data } = await supabase.from('room_presence').select('user_id, *').eq('room', ROOM_NAME);
        const { data: { user: me } } = await supabase.auth.getUser();
        return (data || []).map(d => ({
          peer: d.user_id,
          by: d.user_id,
          presence: d,
          sameTab: d.user_id === me?.id
        }));
      },
      onPeers(cb) {
        const channel = supabase
          .channel(`room_presence:${ROOM_NAME}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'room_presence', filter: `room=eq.${ROOM_NAME}` }, (payload) => {
            // Peers listesini yeniden çek
            this.peers().then(peers => {
              const left = payload.eventType === 'DELETE' ? [{ peer: payload.old.user_id, by: payload.old.user_id }] : [];
              cb({ peers, left });
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
              // Mesajı sil (tek seferlik)
              supabase.from('room_signaling').delete().eq('id', payload.new.id).then(() => {});
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
            room: ROOM_NAME,
            from: me.id,
            to: data.to,
            data: data.data,
            created_at: new Date().toISOString()
          });
        }
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

    // URL helper for assets
    window.imgUrl = async (id) => mockAssets.getUrl(id);

    // Geliştirme: kullanıcı profili kaydet
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const savedName = localStorage.getItem('supabase-display-name');
      if (savedName) await saveUserProfile(user.id, savedName);
    }

    // Debug
    console.log('%c[Oyun Atölyesi] Supabase mod aktif (paylaşımlı, real-time)', 'color: #3ECF8E; font-weight: bold');
  }

  // Supabase SDK'sını CDN'den yükle
  function loadSupabaseSDK() {
    return new Promise((resolve, reject) => {
      if (window.supabase && window.supabase.createClient) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/dist/umd/supabase.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // Başlat
  if (typeof window !== 'undefined') {
    loadSupabaseSDK().then(initSupabase).catch(e => {
      console.error('Supabase yükleme hatası:', e);
      console.log('Mock moduna düşülüyor...');
    });
  }
})();