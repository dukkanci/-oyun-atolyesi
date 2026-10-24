// Artifact çalışma ortamının (window.claude.use) yerel sunucuya bağlanan karşılığı. src/app.js değişmeden çalışır.
(function () {
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  // Düz HTTP ile yerel ağdan açılınca crypto.subtle yok; şifre özeti localhost'takiyle aynı çıksın diye saf JS SHA-256.
  if (!(window.crypto && window.crypto.subtle)) {
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const sha256 = bytes => {
      const n = bytes.length, len = ((n + 9 + 63) >> 6) << 6, m = new Uint8Array(len);
      m.set(bytes); m[n] = 0x80;
      new DataView(m.buffer).setUint32(len - 4, n * 8);
      const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], W = new Uint32Array(64), dv = new DataView(m.buffer);
      const r = (x, s) => (x >>> s) | (x << (32 - s));
      for (let o = 0; o < len; o += 64) {
        for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
        for (let i = 16; i < 64; i++) W[i] = (W[i-16] + (r(W[i-15],7) ^ r(W[i-15],18) ^ (W[i-15] >>> 3)) + W[i-7] + (r(W[i-2],17) ^ r(W[i-2],19) ^ (W[i-2] >>> 10))) >>> 0;
        let [a, b, c, d, e, f, g, h] = H;
        for (let i = 0; i < 64; i++) {
          const t1 = (h + (r(e,6) ^ r(e,11) ^ r(e,25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
          const t2 = ((r(a,2) ^ r(a,13) ^ r(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
          h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        H[0] = (H[0]+a)>>>0; H[1] = (H[1]+b)>>>0; H[2] = (H[2]+c)>>>0; H[3] = (H[3]+d)>>>0;
        H[4] = (H[4]+e)>>>0; H[5] = (H[5]+f)>>>0; H[6] = (H[6]+g)>>>0; H[7] = (H[7]+h)>>>0;
      }
      const out = new DataView(new ArrayBuffer(32)); H.forEach((x, i) => out.setUint32(i * 4, x));
      return out.buffer;
    };
    const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
    // öz-denetim: bilinen "abc" özeti
    console.assert(hex(sha256(new TextEncoder().encode("abc"))) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 bozuk");
    Object.defineProperty(window.crypto, "subtle", { value: { digest: async (alg, data) => sha256(new Uint8Array(data.buffer || data)) } });
  }

  // --- veritabanı: sunucudaki her şeyin tarayıcıdaki kopyası, SSE ile güncel tutulur ---
  const ayna = {}; let profiller = {}, hazir = false;
  const dinleyiciler = new Set();
  const kopya = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const belgeSnap = (id, v) => ({ id, exists: v !== undefined, data: () => kopya(v) });

  function bildir(kol) { for (const d of dinleyiciler) if (kol === null || d.kol === kol) d.calistir(); }
  function baglan() {
    const es = new EventSource("/api/olaylar");
    es.onmessage = e => {
      const o = JSON.parse(e.data);
      if (o.hepsi) { for (const k in ayna) delete ayna[k]; Object.assign(ayna, o.hepsi); }
      if (o.profiller) profiller = o.profiller;
      if (o.kol) { ayna[o.kol] = ayna[o.kol] || {}; if (o.veri) ayna[o.kol][o.id] = o.veri; else delete ayna[o.kol][o.id]; }
      if (o.hepsi) { hazir = true; bildir(null); } else if (o.kol) bildir(o.kol);
    };
    // EventSource kendisi yeniden bağlanır; yeniden bağlanınca "hepsi" tekrar gelir.
  }
  baglan();

  async function yaz(op, yol, veri) {
    const r = await fetch("/api/yaz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, yol, veri }) });
    const o = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(o.hata || "yazılamadı"), { code: "sunucu" });
    return o;
  }
  function dinle(kol, uret, cb) {
    const d = { kol, calistir: () => { try { cb(uret()); } catch (e) { console.error(e); } } };
    dinleyiciler.add(d);
    if (hazir) setTimeout(() => dinleyiciler.has(d) && d.calistir());
    return () => dinleyiciler.delete(d);
  }

  function sorgu(kol, sira, sinir) {
    const uret = () => {
      let docs = Object.entries(ayna[kol] || {}).map(([id, v]) => belgeSnap(id, v));
      if (sira) {
        const [f, yon] = sira, k = yon === "desc" ? -1 : 1;
        docs.sort((a, b) => { const x = a.data()[f], y = b.data()[f]; return x === y ? 0 : (x > y ? k : -k); });
      }
      if (sinir) docs = docs.slice(0, sinir);
      return { docs, size: docs.length, empty: !docs.length };
    };
    return {
      orderBy: (f, yon) => sorgu(kol, [f, yon || "asc"], sinir),
      limit: n => sorgu(kol, sira, n),
      onSnapshot: (cb, err) => dinle(kol, uret, cb),
      get: async () => uret(),
      add: veri => yaz("add", kol, veri),
      doc: id => belge(kol + "/" + id),
    };
  }
  function belge(yol) {
    const [kol, id] = yol.split("/");
    const uret = () => belgeSnap(id, (ayna[kol] || {})[id]);
    return {
      id,
      onSnapshot: (cb, err) => dinle(kol, uret, cb),
      get: async () => uret(),
      set: veri => yaz("set", yol, veri),
      update: veri => yaz("update", yol, veri),
      delete: () => yaz("delete", yol),
    };
  }
  const db = { collection: kol => sorgu(kol), doc: belge };

  // --- kullanıcı: kimlik ve ad bu tarayıcıda saklanır ---
  let uid = lsGet("yerel-uid");
  if (!uid) { uid = "u" + Math.random().toString(36).slice(2, 12); lsSet("yerel-uid", uid); }
  let ad = lsGet("yerel-ad");
  while (!ad) ad = (prompt("Atölyede görünecek adın?") || "").trim();
  lsSet("yerel-ad", ad);
  fetch("/api/profil", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: uid, ad }) });
  const user = {
    me: async () => ({ id: uid, name: ad }),
    can: async () => true,
    profiles: async ids => Object.fromEntries(ids.filter(i => profiller[i]).map(i => [i, { name: profiller[i] }])),
  };

  // --- dosyalar: sunucuya ham gövde olarak yüklenir, /_blob/<id> ile okunur ---
  const assets = {
    upload: async (dosya, ops) => {
      const tur = (ops && ops.type) || dosya.type || "application/octet-stream";
      const r = await fetch("/_blob?type=" + encodeURIComponent(tur), { method: "POST", body: dosya });
      const o = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error("yüklenemedi"), { code: o.code || "sunucu" });
      return { id: o.id };
    },
    delete: async id => { await fetch("/_blob/" + id, { method: "DELETE" }); },
  };

  // shortcut: room (çevrimiçi/yazıyor/sesli) yok, app.js kendi yedeğine düşer; gerekirse SSE üzerinden eklenir.
  const servisler = { db, user, assets, room: null };
  window.claude = { use: async ad => servisler[ad] || null };
})();
