// Oyun Atölyesi — Firebase SDK Wrapper (mock.js yerine)
// claude.ai Artifact API'sini (S.db, S.user, S.assets, S.room) taklit eder.
// Gerçek Firebase kullanır, paylaşımlı gerçek zamanlı veri sağlar.

(function() {
  'use strict';

  // Firebase config
  const firebaseConfig = {
    apiKey: "AIzaSyDl81LxJiVFUlgOH-qqb7FFW7oZRCXVe_4",
    authDomain: "oyun-atolyesi.firebaseapp.com",
    projectId: "oyun-atolyesi",
    storageBucket: "oyun-atolyesi.firebasestorage.app",
    messagingSenderId: "192168305435",
    appId: "1:192168305435:web:37de081463563af11429be",
    measurementId: "G-HHNFJ85508"
  };

  // Global firebase namespace'ini bekle (CDN'den yüklenecek)
  function waitForFirebase() {
    return new Promise((resolve) => {
      if (window.firebase && window.firebase.firestore && window.firebase.auth && window.firebase.storage) {
        resolve();
        return;
      }
      const check = setInterval(() => {
        if (window.firebase && window.firebase.firestore && window.firebase.auth && window.firebase.storage) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });
  }

  async function initFirebase() {
    await waitForFirebase();

    // Firebase'i başlat
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    const db = firebase.firestore();
    const auth = firebase.auth();
    const storage = firebase.storage();

    // Anonymous auth ile giriş yap
    await auth.signInAnonymously();
    const currentUser = auth.currentUser;
    const myUid = currentUser.uid;

    // --- Yardımcılar ---
    const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });

    // --- Mock Database API (Firebase Firestore wrapper) ---
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
        const docData = { id, ...data, createdAt: data.createdAt || firebase.firestore.FieldValue.serverTimestamp() };
        return db.collection(this.name).doc(id).set(docData)
          .then(() => ({ id }));
      }

      onSnapshot(onNext, onError) {
        let query = db.collection(this.name);

        // where filtresi
        for (const [field, { op, value }] of Object.entries(this._query)) {
          if (op === '==') query = query.where(field, '==', value);
        }

        // orderBy
        if (this._orderBy) {
          query = query.orderBy(this._orderBy.field, this._orderBy.dir);
        }

        // limit
        if (this._limit) query = query.limit(this._limit);

        const unsubscribe = query.onSnapshot(snapshot => {
          const docs = snapshot.docs.map(d => ({ id: d.id, data: () => d.data(), exists: d.exists }));
          onNext({ docs, empty: snapshot.empty });
        }, onError);

        return unsubscribe;
      }
    }

    class MockDoc {
      constructor(store, id) {
        this.store = store;
        this.id = id;
      }

      get() {
        return db.collection(this.store).doc(this.id).get()
          .then(doc => ({
            exists: doc.exists,
            data: () => doc.data(),
            id: this.id
          }));
      }

      set(data) {
        return db.collection(this.store).doc(this.id).set({ ...data, id: this.id }, { merge: true });
      }

      update(data) {
        // Firestore'da nested objeleri merge etmek için
        return db.collection(this.store).doc(this.id).update(data);
      }

      delete() {
        return db.collection(this.store).doc(this.id).delete();
      }

      onSnapshot(onNext, onError) {
        const unsubscribe = db.collection(this.store).doc(this.id).onSnapshot(doc => {
          onNext({
            exists: doc.exists,
            data: () => doc.data(),
            id: this.id
          });
        }, onError);
        return unsubscribe;
      }
    }

    // --- Mock User API ---
    const mockUser = {
      async me() {
        const user = auth.currentUser;
        if (!user) await auth.signInAnonymously();
        return { id: auth.currentUser.uid };
      },
      async can(permission) {
        // Herkese yazma izni ver (Anonymous auth ile giriş yapan herkes)
        return true;
      },
      async profiles(ids) {
        const result = {};
        // Users collection'dan isimleri çek (varsa)
        const usersRef = db.collection('users');
        for (const id of ids) {
          try {
            const doc = await usersRef.doc(id).get();
            if (doc.exists) {
              result[id] = doc.data();
            } else {
              result[id] = { id, name: id === myUid ? 'Sen' : 'Arkadaşın' };
            }
          } catch (e) {
            result[id] = { id, name: id === myUid ? 'Sen' : 'Arkadaşın' };
          }
        }
        return result;
      },
      _setCurrentUser(id) {
        // Debug için - Firebase'deUID değiştirilemez, sadece mock'ta
      }
    };

    // Kullanıcı profilini kaydet/güncelle
    async function saveUserProfile(uid, name) {
      await db.collection('users').doc(uid).set({ name, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }

    // --- Mock Assets API (Firebase Storage wrapper) ---
    const mockAssets = {
      async upload(file, options = {}) {
        const id = uuid();
        const type = options.type || file.type;
        const ref = storage.ref().child('assets').child(id);
        const metadata = { contentType: type };
        await ref.put(file, metadata);
        const downloadURL = await ref.getDownloadURL();
        // URL'yi Firestore'a da kaydet (getUrl için)
        await db.collection('assets').doc(id).set({ url: downloadURL, type, size: file.size, name: file.name });
        return { id };
      },

      async delete(id) {
        try {
          const ref = storage.ref().child('assets').child(id);
          await ref.delete();
          await db.collection('assets').doc(id).delete();
        } catch (e) {
          // Ignore if not found
        }
      },

      async getUrl(id) {
        try {
          const doc = await db.collection('assets').doc(id).get();
          if (doc.exists) return doc.data().url;
        } catch (e) {}
        // Fallback: Storage'dan direkt al
        try {
          const ref = storage.ref().child('assets').child(id);
          return await ref.getDownloadURL();
        } catch (e) {
          return '/_blob/' + id;
        }
      }
    };

    // --- Mock Room API (Firestore presence) ---
    const roomCollection = db.collection('rooms');
    const myRoomId = 'default'; // Tek oda

    const mockRoom = {
      async presence(data) {
        const uid = auth.currentUser.uid;
        const roomRef = roomCollection.doc(myRoomId);
        const presenceRef = roomRef.collection('presence').doc(uid);
        if (data && (data.visible === true || data.voice === true || data.typing === true || data.vm === true)) {
          await presenceRef.set({ ...data, uid, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        } else {
          await presenceRef.delete();
        }
      },
      async peers() {
        const roomRef = roomCollection.doc(myRoomId);
        const snapshot = await roomRef.collection('presence').get();
        return snapshot.docs.map(d => ({ peer: d.id, by: d.data().uid, presence: d.data(), sameTab: d.id === auth.currentUser.uid }));
      },
      onPeers(cb) {
        const roomRef = roomCollection.doc(myRoomId);
        const unsubscribe = roomRef.collection('presence').onSnapshot(snapshot => {
          const peers = snapshot.docs.map(d => ({ peer: d.id, by: d.data().uid, presence: d.data(), sameTab: d.id === auth.currentUser.uid }));
          const left = snapshot.docChanges().filter(c => c.type === 'removed').map(c => ({ peer: c.doc.id, by: c.doc.data().uid }));
          const ch = { peers, left };
          cb(ch);
        }, () => {});
        return unsubscribe;
      },
      on(event, cb) {
        // Signaling için: room/signaling subcollection
        if (event === 'voice') {
          const roomRef = roomCollection.doc(myRoomId);
          const unsubscribe = roomRef.collection('signaling').where('to', '==', auth.currentUser.uid).onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
              if (change.type === 'added') {
                const data = change.doc.data();
                cb({ peer: data.from, data: data.data, sameTab: false });
                change.doc.ref.delete().catch(() => {});
              }
            });
          }, () => {});
          return unsubscribe;
        }
        return () => {};
      },
      async emit(event, data) {
        if (event === 'voice') {
          const roomRef = roomCollection.doc(myRoomId);
          await roomRef.collection('signaling').add({
            from: auth.currentUser.uid,
            to: data.to,
            data: data,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
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

    // Debug
    console.log('%c[Oyun Atölyesi] Firebase mod aktif (paylaşımlı)', 'color: #2196F3; font-weight: bold');
  }

  // Firebase SDK'sını CDN'den yükle
  function loadFirebaseSDK() {
    return new Promise((resolve, reject) => {
      if (window.firebase) {
        resolve();
        return;
      }
      // Firebase v9 compat (modular SDK but with compat for easier migration)
      const scripts = [
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage-compat.js'
      ];
      let loaded = 0;
      scripts.forEach(src => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => { loaded++; if (loaded === scripts.length) resolve(); };
        script.onerror = reject;
        document.head.appendChild(script);
      });
    });
  }

  // Başlat
  if (typeof window !== 'undefined') {
    loadFirebaseSDK().then(initFirebase).catch(e => {
      console.error('Firebase yükleme hatası:', e);
      // Fallback: mock.js'i yüklemeye çalış
      console.log('Mock moduna düşülüyor...');
    });
  }
})();