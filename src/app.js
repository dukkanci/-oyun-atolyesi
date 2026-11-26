const KINDS = [
  ["fikir", "Fikir"], ["mekanik", "Mekanik"], ["hikaye", "Hikâye"],
  ["sanat", "Sanat & Ses"], ["gorev", "Gorev"], ["hata", "Hata"], ["videolar", "Videolar"]
];
const KIND = Object.fromEntries(KINDS);
const KICON = { fikir: "✦", mekanik: "⚙︎", hikaye: "¶", sanat: "♪", gorev: "✓", hata: "!", videolar: "▶" };
const STATUS = [["acik", "Acik"], ["suruyor", "Suruyor"], ["bitti", "Bitti"]];
const STATUS_N = Object.fromEntries(STATUS);
const LS_SEEN = "atolye-seen";
const LS_USERNAME = "atolye-username";

const S = {
  db: null, user: null, meId: null, canWrite: true,
  settings: undefined, notes: [], profiles: {},
  f: { kind: "all", who: "all", status: "all", media: "all", q: "" },
  newKind: "fikir", view: "active", openId: null, notesUnsub: null, prevSeen: 0,
  offline: false,
  // Lobby/workshop state
  currentWorkshop: null,
  workshops: [],
  lobbyUnsub: null,
  welcomeShown: false
};

const $ = id => document.getElementById(id);
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

// HTML escaping utility to prevent XSS
function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

// Safe logging - only in development
const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
function log(...args) { if (isDev) console.log(...args); }
function warn(...args) { if (isDev) console.warn(...args); }
function error(...args) { if (isDev) console.error(...args); }

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
function kindVars(k) { return `--kc:var(--k-${k});--kb:var(--k-${k}-bg);--ko:var(--k-${k}-on)`; }
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearSafeTimeout(toast.t); toast.t = setSafeTimeout(() => (t.hidden = true), 2200);
}

// Timer/Event cleanup utilities
const timers = new Map();
const intervals = new Map();
const listeners = new Map();

let timerIdCounter = 0;
let intervalIdCounter = 0;

function setSafeTimeout(fn, delay, id) {
  const uid = id || 'timeout_' + (++timerIdCounter);
  if (timers.has(uid)) clearTimeout(timers.get(uid));
  const idNum = setTimeout(fn, delay);
  timers.set(uid, idNum);
  return uid;
}

function clearSafeTimeout(id) {
  if (timers.has(id)) {
    clearTimeout(timers.get(id));
    timers.delete(id);
  }
}

function setSafeInterval(fn, delay, id) {
  const uid = id || 'interval_' + (++intervalIdCounter);
  if (intervals.has(uid)) clearInterval(intervals.get(uid));
  const idNum = setInterval(fn, delay);
  intervals.set(uid, idNum);
  return uid;
}

function clearSafeInterval(id) {
  if (intervals.has(id)) {
    clearInterval(intervals.get(id));
    intervals.delete(id);
  }
}

function addSafeListener(target, event, handler, options, id) {
  target.addEventListener(event, handler, options);
  if (!listeners.has(id)) listeners.set(id, []);
  listeners.get(id).push({ target, event, handler, options });
}

function clearListeners(id) {
  if (listeners.has(id)) {
    for (const l of listeners.get(id)) {
      l.target.removeEventListener(l.event, l.handler, l.options);
    }
    listeners.delete(id);
  }
}

function clearAllTimers() {
  for (const [, id] of timers) clearSafeTimeout(id);
  timers.clear();
  for (const [, id] of intervals) clearSafeInterval(id);
  intervals.clear();
}

function clearAllListeners() {
  for (const [, list] of listeners) {
    for (const l of list) l.target.removeEventListener(l.event, l.handler, l.options);
  }
  listeners.clear();
}

// Cleanup on page unload
addSafeListener(window, 'pagehide', () => {
  clearAllTimers();
  clearAllListeners();
}, {}, 'global-pagehide-cleanup');
// Persistent toast for SW update notification
function showToast(msg, persistent) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearSafeTimeout(toast.t);
  if (!persistent) toast.t = setSafeTimeout(() => (t.hidden = true), 2200);
}
// Update offline banner in header
function updateOfflineBanner() {
  const existing = document.getElementById('offline-banner');
  if (S.offline) {
    if (!existing) {
      const banner = h('div', { id: 'offline-banner', class: 'offline-banner' },
        h('span', {}, '📴 Çevrimdışı mod — değişiklikler lokal saklanıyor'),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: () => window.location.reload() }, 'Yeniden dene')
      );
      document.body.prepend(banner);
    }
  } else if (existing) {
    existing.remove();
  }
}
function toCamelCase(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    var result = {};
    for (var k in obj) {
      if (!obj.hasOwnProperty(k)) continue;
      var camelKey = k.replace(/_([a-z])/g, function(_, letter) { return letter.toUpperCase(); });
      var val = obj[k];
      result[camelKey] = (val && typeof val === 'object' && !Array.isArray(val)) ? toCamelCase(val) : val;
    }
    return result;
  }
// Firestore Timestamp ve benzeri objeleri milisaniyeye ceviren yardimci
function toMillis(ts) {
  if (!ts) return null;
  if (typeof ts === 'number') return ts;
  if (ts && typeof ts.toMillis === 'function') return ts.toMillis(); // Firestore Timestamp
  if (ts && typeof ts.seconds === 'number') return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6); // Firestore protobuf format
  return null;
}

function ago(ts) {
  const ms = toMillis(ts);
  if (ms === null || isNaN(ms)) return "bilinmiyor";
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "az once";
  if (s < 3600) return Math.floor(s / 60) + " dk once";
  if (s < 86400) return Math.floor(s / 3600) + " sa once";
  if (s < 172800) return "dun";
  const d = new Date(ms);
  return isNaN(d.getTime()) ? "bilinmiyor" : d.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

function who(id) {
  if (id && id === S.meId) return "Sen";
  const profile = S.profiles[id];
  if (profile && profile.name) return profile.name;
  // Anonim kullanici icin short ID (ilk 8 karakter - daha az cakisma)
  return id ? "Arkadasin " + String(id).slice(0, 8) : "Arkadasin";
}
function computeColors() {
  const first = new Map();
  const touch = (id, at) => { if (id && (!first.has(id) || first.get(id) > at)) first.set(id, at); };
  for (const n of S.notes) { touch(n.author, n.createdAt); touch(n.updatedBy, n.updatedAt); for (const r of n.replies || []) touch(r.a, r.at); for (const [uid, val] of Object.entries(n.votes || {})) if (val) touch(uid, val.at); for (const w of workers(n)) touch(w.id, w.at); }
  for (const m of S.chat || []) touch(m.a, m.at);
  if (S.meId && !first.has(S.meId)) first.set(S.meId, Infinity);
  const ord = [...first.keys()].sort((a, b) => first.get(a) - first.get(b));
  const c = S.settings && S.settings.createdBy;
  if (c) { const i = ord.indexOf(c); if (i !== 0) { if (i > 0) ord.splice(i, 1); ord.unshift(c); } }
  S.colorOrder = ord;
}
function ucol(id) { const i = (S.colorOrder || []).indexOf(id); return `var(--u${(i < 0 ? 4 : i % 5) + 1})`; }
function nameEl(id) { return h("b", { style: "color:" + ucol(id) }, who(id)); }
/* hand-drawn animal avatars, each on its own colour */
const svgUri = s => "data:image/svg+xml," + encodeURIComponent(s);
const AVATARS = {
  baykus: { label: "Baykus", src: svgUri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='#33265a'/><path d='M15 17l8 9M49 17l-8 9' stroke='#6b4428' stroke-width='5' stroke-linecap='round'/><ellipse cx='32' cy='39' rx='19' ry='22' fill='#8a5a3b'/><ellipse cx='32' cy='47' rx='11' ry='12' fill='#d8b48a'/><circle cx='24' cy='31' r='8' fill='#fff'/><circle cx='40' cy='31' r='8' fill='#fff'/><circle cx='24' cy='31' r='4.6' fill='#f2b705'/><circle cx='40' cy='31' r='4.6' fill='#f2b705'/><circle cx='24' cy='31' r='2.3' fill='#111'/><circle cx='40' cy='31' r='2.3' fill='#111'/><path d='M29 37l3 5 3-5z' fill='#f29e05'/></svg>") },
  tilki: { label: "Tilki", src: svgUri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='#173a4a'/><path d='M13 12l12 15-8 5z' fill='#e8711c'/><path d='M51 12l-12 15 8 5z' fill='#e8711c'/><path d='M16 16l6 8-3 2z' fill='#3a1a08'/><path d='M48 16l-6 8 3 2z' fill='#3a1a08'/><path d='M12 32Q14 20 32 20Q50 20 52 32L32 55Z' fill='#f07f22'/><path d='M12 32L32 55L25 37Z' fill='#fff3e6'/><path d='M52 32L32 55L39 37Z' fill='#fff3e6'/><circle cx='32' cy='52' r='3' fill='#1a1a1a'/><ellipse cx='25' cy='31' rx='2.2' ry='3' fill='#1a1a1a'/><ellipse cx='39' cy='31' rx='2.2' ry='3' fill='#1a1a1a'/></svg>") },
  panda: { label: "Panda", src: svgUri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='#2b6a4b'/><circle cx='17' cy='18' r='7' fill='#111'/><circle cx='47' cy='18' r='7' fill='#111'/><ellipse cx='32' cy='35' rx='20' ry='19' fill='#f7f7f2'/><ellipse cx='24' cy='33' rx='5' ry='6.5' transform='rotate(-25 24 33)' fill='#111'/><ellipse cx='40' cy='33' rx='5' ry='6.5' transform='rotate(25 40 33)' fill='#111'/><circle cx='24.5' cy='32' r='1.8' fill='#fff'/><circle cx='39.5' cy='32' r='1.8' fill='#fff'/><ellipse cx='32' cy='42' rx='3.5' ry='2.5' fill='#111'/><path d='M28 46q4 3 8 0' stroke='#111' stroke-width='1.6' fill='none'/></svg>") },
  kurt: { label: "Kurt", src: svgUri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='#4a1820'/><path d='M14 9l9 19-11 2z' fill='#6f7a83'/><path d='M50 9l-9 19 11 2z' fill='#6f7a83'/><path d='M12 30Q14 18 32 18Q50 18 52 30L44 48L32 56L20 48Z' fill='#8d98a1'/><path d='M24 40L32 56L40 40Q32 36 24 40Z' fill='#e6e9ec'/><circle cx='32' cy='50' r='2.8' fill='#111'/><ellipse cx='25' cy='31' rx='2.8' ry='1.9' fill='#ffd23f'/><ellipse cx='39' cy='31' rx='2.8' ry='1.9' fill='#ffd23f'/><circle cx='25' cy='31' r='1.1' fill='#111'/><circle cx='39' cy='31' r='1.1' fill='#111'/><path d='M21 27.5l7 2M43 27.5l-7 2' stroke='#2a2f33' stroke-width='2' stroke-linecap='round'/></svg>") },
  kedi: { label: "Kedi", src: svgUri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='#b07a00'/><path d='M14 12l12 12-12 6z' fill='#2b2b2e'/><path d='M50 12l-12 12 12 6z' fill='#2b2b2e'/><ellipse cx='32' cy='36' rx='19' ry='17' fill='#2b2b2e'/><ellipse cx='25' cy='33' rx='3.5' ry='4.2' fill='#7ee081'/><ellipse cx='39' cy='33' rx='3.5' ry='4.2' fill='#7ee081'/><ellipse cx='25' cy='33' rx='1.1' ry='3.4' fill='#111'/><ellipse cx='39' cy='33' rx='1.1' ry='3.4' fill='#111'/><path d='M30 40h4l-2 2.5z' fill='#ff8fb1'/><path d='M13 40l11 1M13 44l11-1M51 40l-11 1M51 44l-11-1' stroke='#dddddd' stroke-width='1'/></svg>") },
  ayi: { label: "Ayi", src: svgUri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='#2d4f8a'/><circle cx='16' cy='18' r='8' fill='#7a4a24'/><circle cx='48' cy='18' r='8' fill='#7a4a24'/><circle cx='16' cy='18' r='4' fill='#c48a5a'/><circle cx='48' cy='18' r='4' fill='#c48a5a'/><circle cx='32' cy='36' r='20' fill='#8b5a2b'/><ellipse cx='32' cy='43' rx='9' ry='7' fill='#d9a874'/><ellipse cx='32' cy='40' rx='3.6' ry='2.6' fill='#2a1a0e'/><circle cx='24' cy='31' r='2.4' fill='#111'/><circle cx='40' cy='31' r='2.4' fill='#111'/><path d='M29 46q3 2 6 0' stroke='#2a1a0e' stroke-width='1.5' fill='none'/></svg>") },
  tavsan: { label: "Tavsan", src: svgUri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='#a3174f'/><ellipse cx='24' cy='16' rx='5' ry='14' fill='#f1eef0'/><ellipse cx='40' cy='16' rx='5' ry='14' fill='#f1eef0'/><ellipse cx='24' cy='17' rx='2.4' ry='10' fill='#ffb3c7'/><ellipse cx='40' cy='17' rx='2.4' ry='10' fill='#ffb3c7'/><circle cx='32' cy='40' r='17' fill='#f1eef0'/><circle cx='26' cy='37' r='2.3' fill='#111'/><circle cx='38' cy='37' r='2.3' fill='#111'/><path d='M30 43h4l-2 2.4z' fill='#ff7aa0'/><path d='M32 45.5v2.5M29 49q3 2 6 0' stroke='#555555' stroke-width='1.2' fill='none'/></svg>") },
  penguen: { label: "Penguen", src: svgUri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='#3b8fc0'/><ellipse cx='32' cy='36' rx='20' ry='24' fill='#1b1f24'/><ellipse cx='32' cy='42' rx='13' ry='17' fill='#f5f5f5'/><circle cx='26' cy='28' r='2.6' fill='#ffffff'/><circle cx='38' cy='28' r='2.6' fill='#ffffff'/><circle cx='26' cy='28' r='1.4' fill='#111'/><circle cx='38' cy='28' r='1.4' fill='#111'/><path d='M28 32l4 5 4-5z' fill='#f5a623'/></svg>") },
  kurbaga: { label: "Kurbaga", src: svgUri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='#14213d'/><circle cx='21' cy='22' r='8' fill='#4caf50'/><circle cx='43' cy='22' r='8' fill='#4caf50'/><ellipse cx='32' cy='40' rx='21' ry='16' fill='#4caf50'/><circle cx='21' cy='22' r='4.5' fill='#ffffff'/><circle cx='43' cy='22' r='4.5' fill='#ffffff'/><circle cx='21' cy='22' r='2.3' fill='#111'/><circle cx='43' cy='22' r='2.3' fill='#111'/><path d='M20 42q12 9 24 0' stroke='#1b5e20' stroke-width='2.2' fill='none' stroke-linecap='round'/><circle cx='27' cy='35' r='1' fill='#1b5e20'/><circle cx='37' cy='35' r='1' fill='#1b5e20'/></svg>") },
  aslan: { label: "Aslan", src: svgUri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='#3a3f47'/><circle cx='32' cy='34' r='24' fill='#b5651d'/><circle cx='32' cy='35' r='16' fill='#f2c46d'/><circle cx='26' cy='32' r='2.2' fill='#111'/><circle cx='38' cy='32' r='2.2' fill='#111'/><path d='M29 38h6l-3 3z' fill='#5a3210'/><path d='M32 41v3M28 46q4 2 8 0' stroke='#5a3210' stroke-width='1.4' fill='none'/></svg>") }
};
const AV_ALIAS = { profesor: "baykus", berlin: "tilki" };
/* "rotate": a new animal every 2.5 h. Same on every screen; consecutive slots always differ, and so do two people */
const ROT_MS = 2.5 * 3600 * 1000;
const rotSlot = () => Math.floor(Date.now() / ROT_MS);
function rotPick(id) {
  const keys = Object.keys(AVATARS), n = keys.length;
  let i = (S.colorOrder || []).indexOf(id);
  if (i < 0) i = [...id].reduce((s, c) => s + c.charCodeAt(0), 0);
  return AVATARS[keys[(rotSlot() * 3 + i * 5 + Math.floor(i / 2)) % n]];
}
let lastSlot = rotSlot();
setSafeInterval(() => { if (rotSlot() !== lastSlot) { lastSlot = rotSlot(); if (S.settings) render(); } }, 60000);
function avatar(id, cls) {
  const p = S.profiles[id], style = "box-shadow:0 0 0 2px " + ucol(id);
  const raw = S.settings && S.settings.avatars && S.settings.avatars[id];
  const pick = raw === "rotate" ? rotPick(id) : raw && AVATARS[AV_ALIAS[raw] || raw];
  const custom = typeof raw === "string" && raw.startsWith("img:") ? imgUrl(raw.slice(4)) : null;
  const src = custom || (pick ? pick.src : p && p.avatarUrl);
  return src ? h("img", { class: "av " + (cls || ""), src, alt: "", style, title: pick ? pick.label : null }) : h("span", { class: "av " + (cls || ""), style });
}
function renderAvList() {
  const box = $("av-list"); if (!box) return;
  const rawCur = (S.settings && S.settings.avatars && S.settings.avatars[S.meId]) || null;
  const cur = AV_ALIAS[rawCur] || rawCur;
  box.replaceChildren();
  for (const entry of Object.entries(AVATARS).concat([[null, { label: "varsayilan fotograf", src: null }]])) {
    box.append(
      h(
        "button",
        { type: "button", class: "chip avpick", "aria-pressed": String(cur === entry[0]),
          onclick: async () => {
            if (await write(() => S.db.doc("team/settings").update({ avatars: { [S.meId]: entry[0] } })))
              toast("Profil fotografi guncellendi");
          }
        },
      entry[1].src ? h("img", { src: entry[1].src, alt: "" }) : null,
      entry[1].label
    )
    )
  }
  if (S.assets && S.meId) {
    const inp = h("input", { type: "file", id: "av-file", accept: IMG_TYPES.join(","), hidden: true });
    addSafeListener(inp, "change", async () => {
      const f = inp.files[0]; inp.value = "";
      if (!f) return;
      const got = await uploadMedia([f], { set textContent(v) { if (v) toast(v); } });
      if (got.images[0] && await write(() => S.db.doc("team/settings").update({ avatars: { [S.meId]: "img:" + got.images[0] } })))
        toast("Profil fotografin guncellendi");
    });
    const mine = typeof rawCur === "string" && rawCur.startsWith("img:");
    box.append(h("label", { class: "chip avpick", for: "av-file", "aria-pressed": String(mine), style: "cursor:pointer" },
      mine ? h("img", { src: imgUrl(rawCur.slice(4)), alt: "" }) : null, mine ? "Kendi fotografin · degistir" : "Kendi fotografini yukle"), inp);
  }
}
function showNoWrite() {
  S.canWrite = false;
  const b = $("nowrite"); if (b) b.hidden = false;
}
function show(id) {
  for (const s of ["s-loading", "s-noaccess", "s-login", "s-wait", "s-app", "s-welcome", "s-lobby"]) $(s).hidden = s !== id;
}
async function write(fn, errEl) {
  try { await fn(); if (errEl) errEl.textContent = ""; return true; }
  catch (e) {
    const code = (e && e.code) || "bilinmiyor";
    const msg = code === "invalid_argument"
      ? "Bu atolyeye yazma iznin yok. Sayfanin sahibi Paylas menusunden seni Duzenleyici olarak eklemeli ve herkese acik linki kapatmali."
      : code === "quota_exceeded" ? "Depolama dolu. Eski notlari silip tekrar dene."
      : "Kaydedilemedi (" + code + "). Baglantini kontrol edip tekrar dene.";
    if (code === "invalid_argument") showNoWrite();
    if (errEl) errEl.textContent = msg; else toast(msg);
    return false;
  }
}

/* ---------- boot & routing ---------- */

async function boot() {
  const use = window.claude && window.claude.use;
  const [db, user, assets] = use ? await Promise.all([window.claude.use("db"), window.claude.use("user"), window.claude.use("assets")]) : [null, null, null];
  if (!db) { show("s-noaccess"); return; }
  S.db = db; S.user = user; S.assets = assets;

  // Register Service Worker for PWA/offline support
  // Use absolute path based on current origin to work with both preview (localhost:3000/) and production (GitHub Pages)
  if ('serviceWorker' in navigator) {
    try {
      // Determine the correct SW path: /sw.js for preview, /-oyun-atolyesi/efsane-proje/sw.js for production
      const isPreview = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      const swPath = isPreview ? '/sw.js' : '/-oyun-atolyesi/efsane-proje/sw.js';
      const reg = await navigator.serviceWorker.register(swPath);
      log('SW registered:', reg.scope);
      // Listen for SW updates
      // Listen for SW updates
      addSafeListener(reg, 'updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          addSafeListener(newWorker, 'statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('Yeni sürüm hazır. Sayfayı yenileyin.', true);
            }
          }, {}, 'sw-statechange');
        }
      });
    } catch (e) {
      warn('SW registration failed:', e);
    }

    // Listen for online/offline events
    addSafeListener(window, 'online', () => { S.offline = false; updateOfflineBanner(); toast('Çevrimiçi - veriler senkronize ediliyor'); }, {}, 'online-listener');
    addSafeListener(window, 'offline', () => { S.offline = true; updateOfflineBanner(); toast('Çevrimdışı mod - değişiklikler lokal saklanıyor'); }, {}, 'offline-listener');
  }

  // Check for stored username
  const storedUsername = ls.get(LS_USERNAME);
  const storedMeId = ls.get("atolye-meid");
  if (storedUsername) {
    const generatedMeId = generateUserId(storedUsername);
    const storedMeId = ls.get("atolye-meid");
    if (storedMeId && storedMeId !== generateUserId(storedUsername)) {
      warn("MeId uyusmazligi, yeniden hesaplaniyor:", storedMeId, "->", generateUserId(storedUsername));
    }
    S.meId = generateUserId(storedUsername);
    S.username = storedUsername;
    S.canWrite = true;
    // MeId'yi localStorage'da da sakla (oturum kaliciligi icin)
    ls.set("atolye-meid", S.meId);
  } else {
    S.meId = null;
    S.username = null;
    S.canWrite = false;
  }

  S.prevSeen = Number(ls.get(LS_SEEN)) || 0;
  const markSeen = () => ls.set(LS_SEEN, String(Date.now()));
  addSafeListener(document, "visibilitychange", () => { if (document.hidden) markSeen(); }, {}, 'visibility-mark-seen');
  addSafeListener(window, "pagehide", markSeen, {}, 'pagehide-mark-seen');

  // Oturum dogrulama: localStorage'da kullanici varsa meId'yi dogrula
  if (S.meId) {
    try {
      const me = await user?.me();
      if (me && me.id && me.id !== S.meId) {
        warn("MeId uyusmazligi, localStorage guncelleniyor:", S.meId, "->", me.id);
        ls.set("atolye-meid", me.id);
        S.meId = me.id;
      }
    } catch (e) {
      warn("Oturum dogrulama hatasi:", e);
    }
  }

  // MeId'yi localStorage'da da sakla (oturum kaliciligi icin)
  if (S.meId) {
    ls.set("atolye-meid", S.meId);
  }

  S.prevSeen = Number(ls.get(LS_SEEN)) || 0;

  // Check localStorage for existing settings document (team/settings)
  // This prevents "Atolye aciliyor..." takilma sorunu
  const settingsKey = 'supabase_doc_team_settings';
  const storedSettings = ls.get(settingsKey);
  if (storedSettings) {
    try {
      S.settings = JSON.parse(storedSettings);
    } catch (e) {
      warn('Settings parse hatasi:', e);
      S.settings = null;
    }
  } else {
    S.settings = null;
  }

  // Check for invitation token in URL
  const urlParams = new URLSearchParams(window.location.search);
  const inviteToken = urlParams.get('invite');
  if (inviteToken) {
    // Store the invite token in localStorage for later use when user logs in
    ls.set('atolye-invite', inviteToken);
    // Clean up URL to remove the invite parameter
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // Initialize global workshops early (needed for invite token processing)
  loadGlobalWorkshops();
  setupLocalStorageSync();
  startGlobalWorkshopsListener();

  // Process invite token early if user is already logged in and workshops are loaded
  async function processInviteToken() {
    const storedInviteToken = ls.get('atolye-invite');
    if (!storedInviteToken) return;

    // Wait for workshops to be loaded (max 3 seconds)
    let attempts = 0;
    while ((!S.workshops || S.workshops.length === 0) && attempts < 30) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    const targetWorkshop = S.workshops.find(w => w.inviteToken === storedInviteToken && !w.isDeleted);
    if (targetWorkshop) {
      // Check if user is logged in
      if (S.meId) {
        // User is logged in, join the workshop immediately
        await joinWorkshop(targetWorkshop.id);
        toast("Atölyeye davet edildiniz! Hoş geldiniz!");
      } else {
        // User not logged in yet, keep token for after login
        log("🔍 Valid invitation token found, waiting for login");
      }
    } else {
      warn("🔍 Invalid invitation token, no workshop found with this token");
      toast("Geçersiz davet kodu!");
    }
    ls.remove('atolye-invite');
  }

  // Process invite token if user is already logged in
  if (S.meId) {
    setSafeTimeout(() => processInviteToken(), 500);
  }

  // Listen to settings changes
  // onSnapshot fires immediately with current document, so no initial route() call needed
  db.doc("team/settings").onSnapshot(snap => {
    S.settings = snap.exists ? toCamelCase(snap.data()) : null;
    // Admin flag: settings.isAdmin === true and the admin user ID matches current user
    S.isAdmin = S.settings?.isAdmin === true && S.settings?.adminUserId === S.meId;
    route();
  }, () => show("s-noaccess"));

  // Fix: gizli dosya input'una name attribute ekle (form validation hatasi onlemi)
  setSafeTimeout(() => {
    const fileInput = document.getElementById("nw-file");
    if (fileInput && !fileInput.name) {
      fileInput.name = "nw-file";
    }
  }, 0);

  // Initialize global workshops
  loadGlobalWorkshops();
  setupLocalStorageSync();
  startGlobalWorkshopsListener();
}

function generateUserId(username) {
  // Simple hash to generate consistent user ID from username
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = ((hash << 5) - hash) + username.charCodeAt(i);
    hash = hash & hash;
  }
  return "user_" + Math.abs(hash).toString(36);
}

/* ---------- Lobby/Workshop Management (Global) ---------- */
const GLOBAL_WORKSHOPS_KEY = "atolye-global-workshops";
const WORKSHOPS_KEY = "atolye-workshops"; // Legacy per-user key (kept for backward compatibility)
const MAX_MEMBERS_DEFAULT = 5;

function loadGlobalWorkshops() {
  // Firebase will handle real-time updates via listener
  // This is for localStorage fallback only
  if (S.db) {
    log("🔍 Firebase available, global workshops will be loaded via listener");
    return;
  }
  try {
    const stored = ls.get(GLOBAL_WORKSHOPS_KEY);
    S.workshops = stored ? JSON.parse(stored) : [];
    log("🔍 Loaded global workshops from localStorage:", S.workshops);
  } catch (e) {
    warn("Global workshops load error:", e);
    S.workshops = [];
  }
  renderLobby();
}

function saveGlobalWorkshops(workshops) {
  if (S.db) return; // Firebase handles persistence
  try {
    ls.set(GLOBAL_WORKSHOPS_KEY, JSON.stringify(workshops));
  } catch (e) {
    warn("Global workshops save error:", e);
  }
}

function setupLocalStorageSync() {
  // Cross-tab sync for localStorage fallback
  addSafeListener(window, "storage", e => {
    if (e.key === GLOBAL_WORKSHOPS_KEY && !S.db) {
      loadGlobalWorkshops();
    }
  }, {}, 'global-workshops-sync');
}

// Legacy function for backward compatibility (per-user workshop list)
function addWorkshopToUser(workshop) {
  try {
    const stored = ls.get(WORKSHOPS_KEY);
    const userWorkshops = stored ? JSON.parse(stored) : [];
    const exists = userWorkshops.some(w => w.id === workshop.id);
    if (!exists) {
      userWorkshops.push(workshop);
      ls.set(WORKSHOPS_KEY, JSON.stringify(userWorkshops));
    }
  } catch (e) {
    warn("Add workshop to user error:", e);
  }
}

function startGlobalWorkshopsListener() {
  if (S.globalWorkshopsUnsub || !S.db) return;
  S.globalWorkshopsUnsub = S.db.collection("workshops")
    .where("isDeleted", "==", false)
    .onSnapshot(snapshot => {
      const workshops = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      S.workshops = workshops;
      renderLobby();
    }, err => warn("Workshops listener error:", err));
}

async function createWorkshop(gameName) {
  const meId = S.meId;
  if (!meId) return null;

  const inviteToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const workshopId = "ws_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
  const now = Date.now();

  const workshopData = {
    id: workshopId,
    game: gameName || "Oyun Atölyesi",
    inviteToken,
    createdBy: meId,
    createdAt: now,
    updatedAt: now,
    members: { [meId]: { joinedAt: now, lastSeen: now } },
    memberCount: 1,
    maxMembers: MAX_MEMBERS_DEFAULT,
    isDeleted: false
  };

  // Add to global workshops
  S.workshops.push(workshopData);

  // Save to Firebase or localStorage
  if (S.db) {
    try {
      await S.db.collection("workshops").doc(workshopId).set(workshopData);
      log("🔍 Workshop created in Firebase:", workshopId);
    } catch (e) {
      warn("Firebase workshop create error:", e);
      // Fallback to localStorage
      saveGlobalWorkshops(S.workshops);
    }
  } else {
    saveGlobalWorkshops(S.workshops);
  }

  // Also add to user's local workshops for backward compatibility
  addWorkshopToUser({ id: workshopId, game: workshopData.game, inviteToken: workshopData.inviteToken, createdAt: now });

  // Create settings for this workshop (using a workshop-specific key)
  const settingsKey = `workshop_${workshopId}_settings`;
  const newSettings = {
    game: workshopData.game,
    createdBy: meId,
    createdAt: now,
    inviteToken: workshopData.inviteToken,
    workshopId: workshopId
  };
  ls.set(`supabase_doc_${settingsKey}`, JSON.stringify(newSettings));

  log("🔍 Workshop created:", workshopData);
  return workshopData;
}

async function joinWorkshop(workshopId) {
  if (!S.meId) return;
  const ws = S.workshops.find(w => w.id === workshopId);
  if (!ws) return;
  if (ws.members[S.meId]) return; // already member
  if (ws.memberCount >= (ws.maxMembers || MAX_MEMBERS_DEFAULT)) {
    toast("Atölye dolu!");
    return;
  }

  const now = Date.now();
  ws.members[S.meId] = { joinedAt: now, lastSeen: now };
  ws.memberCount = Object.keys(ws.members).length;
  ws.updatedAt = now;

  if (S.db) {
    try {
      await S.db.collection("workshops").doc(workshopId).update({
        members: ws.members,
        memberCount: ws.memberCount,
        updatedAt: now
      });
      log("🔍 Joined workshop in Firebase:", workshopId);
    } catch (e) {
      warn("Firebase join error:", e);
      saveGlobalWorkshops(S.workshops);
    }
  } else {
    saveGlobalWorkshops(S.workshops);
  }

  toast("Atölyeye katıldınız!");
  renderLobby();
  // Auto-switch to workshop
  switchWorkshop(workshopId);
}

async function leaveWorkshop(workshopId) {
  if (!S.meId) return;
  const ws = S.workshops.find(w => w.id === workshopId);
  if (!ws || !ws.members[S.meId]) return;

  delete ws.members[S.meId];
  ws.memberCount = Object.keys(ws.members).length;
  ws.updatedAt = Date.now();

  if (S.db) {
    try {
      await S.db.collection("workshops").doc(workshopId).update({
        members: ws.members,
        memberCount: ws.memberCount,
        updatedAt: ws.updatedAt
      });
      log("🔍 Left workshop in Firebase:", workshopId);
    } catch (e) {
      warn("Firebase leave error:", e);
      saveGlobalWorkshops(S.workshops);
    }
  } else {
    saveGlobalWorkshops(S.workshops);
  }

  toast("Atölyeden çıktınız");
  renderLobby();
}

async function deleteWorkshop(workshopId) {
  const ws = S.workshops.find(w => w.id === workshopId);
  if (!ws) return;

  const isCreator = ws.createdBy === S.meId;
  const isAdmin = S.isAdmin;
  if (!isCreator && !isAdmin) { toast("Bu atölyeyi silme yetkiniz yok"); return; }

  if (!confirm("Bu atölye ve tüm içeriği silinecek. Emin misiniz?")) return;

  ws.isDeleted = true;
  ws.updatedAt = Date.now();

  if (S.db) {
    try {
      await S.db.collection("workshops").doc(workshopId).update({
        isDeleted: true,
        updatedAt: ws.updatedAt
      });
      log("🔍 Workshop deleted in Firebase:", workshopId);
    } catch (e) {
      warn("Firebase delete error:", e);
      saveGlobalWorkshops(S.workshops);
    }
  } else {
    saveGlobalWorkshops(S.workshops);
  }

  // Clean up workshop-specific localStorage
  const settingsKey = `supabase_doc_workshop_${workshopId}_settings`;
  ls.del(settingsKey);

  toast("Atölye silindi");
  renderLobby();

  // If user was in this workshop, go back to lobby
  if (S.currentWorkshop === workshopId) {
    S.currentWorkshop = null;
    showLobby();
  }
}

function switchWorkshop(workshopId) {
  S.currentWorkshop = workshopId;
  // Load workshop-specific settings
  const settingsKey = `workshop_${workshopId}_settings`;
  const storedSettings = ls.get(`supabase_doc_${settingsKey}`);
  if (storedSettings) {
    try {
      S.settings = JSON.parse(storedSettings);
    } catch (e) {
      warn("Settings parse error:", e);
      S.settings = null;
    }
  }
  route();
}

function renderLobby() {
  const box = $("lobby-workshops");
  if (!box) return;

  // Filter out deleted workshops
  const activeWorkshops = S.workshops.filter(ws => !ws.isDeleted);

  if (activeWorkshops.length === 0) {
    box.innerHTML = '<div class="empty">Henüz atölye yok. Yeni atölye oluşturun veya davet koduyla katılın.</div>';
    return;
  }

  box.innerHTML = '';
  for (const ws of activeWorkshops) {
    const isMember = ws.members && ws.members[S.meId];
    const isCreator = ws.createdBy === S.meId;
    const isAdmin = S.isAdmin;
    const canDelete = isCreator || isAdmin;
    const isFull = ws.memberCount >= (ws.maxMembers || MAX_MEMBERS_DEFAULT);

    const item = h("div", { class: "workshop-item" },
      h("div", { class: "workshop-info" },
        h("div", { class: "workshop-name" }, ws.game),
        h("div", { class: "workshop-meta" },
          `Üyeler: ${ws.memberCount}/${ws.maxMembers || MAX_MEMBERS_DEFAULT}`,
          ` · Oluşturulma: ${new Date(ws.createdAt).toLocaleDateString("tr-TR")}`,
          isFull ? ` · <span class="badge-full">Dolu</span>` : ""
        )
      ),
      h("div", { class: "workshop-actions" },
        !isMember && !isFull ? h("button", { class: "btn primary", type: "button", onclick: () => joinWorkshop(ws.id) }, "Katıl") : null,
        isMember ? h("button", { class: "btn", type: "button", onclick: () => switchWorkshop(ws.id) }, "Aç") : null,
        canDelete ? h("button", { class: "btn danger", type: "button", onclick: () => { if (confirm("Bu atölyeyi silmek istediğinizden emin misiniz?")) deleteWorkshop(ws.id); } }, "Sil") : null
      )
    );
    box.appendChild(item);
  }
}

function showLobby() {
  // Update username display
  const usernameEl = $("lobby-username");
  if (usernameEl) usernameEl.textContent = S.username || "Kullanıcı";

  // Render workshops
  renderLobby();
  show("s-lobby");
}

function showWelcomeScreen() {
  const usernameEl = $("welcome-username");
  if (usernameEl) usernameEl.textContent = S.username || "Kullanıcı";
  S.welcomeShown = true;
  show("s-welcome");
}

function showApp() {
  show("s-app");
}

function route() {
  log("🔍 route() cagrildi", { meId: S.meId, settings: S.settings, hasSettings: !!S.settings, currentWorkshop: S.currentWorkshop });
  const st = S.settings;
  if (st === undefined) {
    log("🔍 route: settings undefined, showing s-loading");
    return show("s-loading");
  }

  // Check if user has username
  if (!S.meId) {
    log("🔍 route: no meId, showing s-login");
    show("s-login");
    // Clean up any active subscriptions
    if (S.notesUnsub) { S.notesUnsub(); S.notesUnsub = null; S.notes = []; closeSheet(); }
    if (S.chatUnsub) { S.chatUnsub(); S.chatUnsub = null; S.chat = []; S.chatIds = null; }
    if (S.lobbyUnsub) { S.lobbyUnsub(); S.lobbyUnsub = null; }
    return;
  }

  log("🔍 route: has meId, checking settings", { st: !!st, currentWorkshop: S.currentWorkshop });

  // User has username - check if workshop selected
  if (!S.currentWorkshop) {
    // Check if we should show welcome screen or lobby
    const showWelcome = !S.welcomeShown;
    if (showWelcome) {
      log("🔍 route: no workshop selected, showing welcome");
      showWelcomeScreen();
    } else {
      log("🔍 route: no workshop selected, showing lobby");
      showLobby();
    }
    return;
  }

  log("🔍 route: showing s-app", { game: st.game, workshop: S.currentWorkshop });

  // Workshop selected - show app
  showApp();
  const lockGameEl = $("lock-game");
  if (lockGameEl) lockGameEl.textContent = st.game || "Oyun Atolyesi";
  $("game-name").textContent = st.game || "Oyun Atolyesi";
  if (document.activeElement !== $("st-game")) $("st-game").value = st.game || "";
  if (!S.notesUnsub) {
    S.liveSince = Date.now();
    S.notesUnsub = S.db.collection("notes").orderBy("updatedAt", "desc").limit(500).onSnapshot(snap => {
      const prev = S.notes;
      S.notes = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      const news = detectNews(prev, S.notes);
      render().then(() => { if (news.length) { playSound(topSound(news)); news.slice(0, 3).forEach(notify); } });
    }, () => toast("Notlar yuklenemedi. Sayfayi yenile."));
  }
  startJobs();
  startUpdates();
  if (!S.lsUnsub) S.lsUnsub = S.db.collection("lastseen").onSnapshot(s => {
    S.lastSeenOnline = Object.fromEntries(s.docs.map(d => [d.id, d.data().at]));
    renderPeople(S.lastIds || new Set());
  }, () => {});
  if (!S.seenUnsub) S.seenUnsub = S.db.collection("chatseen").onSnapshot(s => {
    S.seenBy = Object.fromEntries(s.docs.map(d => [d.id, d.data()]));
    renderChat(false);
  }, () => {});
  if (!S.stkUnsub) S.stkUnsub = S.db.collection("stickers").orderBy("at", "asc").limit(100).onSnapshot(s => {
    S.stickers = s.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(x => x.img);
    if (!$("emoji-pop").hidden && S.epTab === "Sticker") renderEmojiPop();
  }, () => {});
  if (!S.chatUnsub) S.chatUnsub = S.db.collection("chat").orderBy("at", "desc").limit(300).onSnapshot(onChat, () => toast("Sohbet yuklenemedi. Sayfayi yenile."));
  render();
}

function showLobby() {
  // Update username display
  const usernameEl = $("lobby-username");
  if (usernameEl) usernameEl.textContent = S.username || "Kullanıcı";

  // Render workshops
  renderLobby();
  show("s-lobby");
}

function showWelcomeScreen() {
  const usernameEl = $("welcome-username");
  if (usernameEl) usernameEl.textContent = S.username || "Kullanıcı";
  S.welcomeShown = true;
  show("s-welcome");
}

function showApp() {
  show("s-app");
}

function route() {
  log("🔍 route() cagrildi", { meId: S.meId, settings: S.settings, hasSettings: !!S.settings, currentWorkshop: S.currentWorkshop });
  const st = S.settings;
  if (st === undefined) {
    log("🔍 route: settings undefined, showing s-loading");
    return show("s-loading");
  }

  // Check if user has username
  if (!S.meId) {
    log("🔍 route: no meId, showing s-login");
    show("s-login");
    // Clean up any active subscriptions
    if (S.notesUnsub) { S.notesUnsub(); S.notesUnsub = null; S.notes = []; closeSheet(); }
    if (S.chatUnsub) { S.chatUnsub(); S.chatUnsub = null; S.chat = []; S.chatIds = null; }
    if (S.lobbyUnsub) { S.lobbyUnsub(); S.lobbyUnsub = null; }
    return;
  }

  log("🔍 route: has meId, checking settings", { st: !!st, currentWorkshop: S.currentWorkshop });

  // User has username - check if workshop selected
  if (!S.currentWorkshop) {
    // Check if we should show welcome screen or lobby
    const showWelcome = !S.welcomeShown;
    if (showWelcome) {
      log("🔍 route: no workshop selected, showing welcome");
      showWelcomeScreen();
    } else {
      log("🔍 route: no workshop selected, showing lobby");
      showLobby();
    }
    return;
  }

  log("🔍 route: showing s-app", { game: st.game, workshop: S.currentWorkshop });

  // Workshop selected - show app
  showApp();
  const lockGameEl = $("lock-game");
  if (lockGameEl) lockGameEl.textContent = st.game || "Oyun Atolyesi";
  $("game-name").textContent = st.game || "Oyun Atolyesi";
  if (document.activeElement !== $("st-game")) $("st-game").value = st.game || "";
  if (!S.notesUnsub) {
    S.liveSince = Date.now();
    S.notesUnsub = S.db.collection("notes").orderBy("updatedAt", "desc").limit(500).onSnapshot(snap => {
      const prev = S.notes;
      S.notes = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      const news = detectNews(prev, S.notes);
      render().then(() => { if (news.length) { playSound(topSound(news)); news.slice(0, 3).forEach(notify); } });
    }, () => toast("Notlar yuklenemedi. Sayfayi yenile."));
  }
  startJobs();
  startUpdates();
  if (!S.lsUnsub) S.lsUnsub = S.db.collection("lastseen").onSnapshot(s => {
    S.lastSeenOnline = Object.fromEntries(s.docs.map(d => [d.id, d.data().at]));
    renderPeople(S.lastIds || new Set());
  }, () => {});
  if (!S.seenUnsub) S.seenUnsub = S.db.collection("chatseen").onSnapshot(s => {
    S.seenBy = Object.fromEntries(s.docs.map(d => [d.id, d.data()]));
    renderChat(false);
  }, () => {});
  if (!S.stkUnsub) S.stkUnsub = S.db.collection("stickers").orderBy("at", "asc").limit(100).onSnapshot(s => {
    S.stickers = s.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(x => x.img);
    if (!$("emoji-pop").hidden && S.epTab === "Sticker") renderEmojiPop();
  }, () => {});
  if (!S.chatUnsub) S.chatUnsub = S.db.collection("chat").orderBy("at", "desc").limit(300).onSnapshot(onChat, () => toast("Sohbet yuklenemedi. Sayfayi yenile."));
  render();
}

addSafeListener($("f-login"), "submit", async e => {
  log("🔍 Form submit basladi", { username: $("lg-username").value.trim() });
  e.preventDefault();
  const username = $("lg-username").value.trim();
  const err = $("lg-err");

  log("🔍 Form validation", { username });
  if (!username) { err.textContent = "Kullanici adi girin."; return; }
  if (username.length < 2) { err.textContent = "Kullanici adi en az 2 karakter olmali."; return; }

  const meId = generateUserId(username);
  log("🔍 Generated meId", meId);
  ls.set(LS_USERNAME, username);
  S.meId = meId;
  S.username = username;
  S.canWrite = true;
  log("🔍 S.meId set", S.meId);

  // Load user's workshops from localStorage
  loadUserWorkshops();

  err.textContent = "";
  log("🔍 Calling route() - showing lobby");
  route();
});

addSafeListener($("btn-logout"), "click", () => {
  ls.del(LS_USERNAME);
  S.meId = null;
  S.username = null;
  S.canWrite = false;
  S.welcomeShown = false;
  route();
}, {}, 'btn-logout-login');

/* Lobby event handlers */
addSafeListener($("btn-create-workshop"), "click", () => {
  const modal = $("create-workshop-modal");
  if (modal) {
    modal.hidden = false;
    setSafeTimeout(() => {
      const input = $("cw-game");
      if (input) input.focus();
    }, 100);
  }
});

addSafeListener($("btn-cancel-create"), "click", () => {
  const modal = $("create-workshop-modal");
  if (modal) modal.hidden = true;
});

addSafeListener($("f-create-workshop"), "submit", async e => {
  e.preventDefault();
  const gameName = $("cw-game").value.trim();
  const err = $("cw-err");
  if (!gameName) { err.textContent = "Atölye adı girin."; return; }
  const workshop = await createWorkshop(gameName);
  if (workshop) {
    const modal = $("create-workshop-modal");
    if (modal) modal.hidden = true;
    $("cw-game").value = "";
    toast("Atölye oluşturuldu!");
    renderLobby();
    // Auto-switch to new workshop
    switchWorkshop(workshop.id);
    showApp();
  }
});

addSafeListener($("btn-join-workshop"), "click", () => {
  const modal = $("join-workshop-modal");
  if (modal) {
    modal.hidden = false;
    setSafeTimeout(() => {
      const input = $("jw-code");
      if (input) input.focus();
    }, 100);
  }
});

addSafeListener($("btn-cancel-join"), "click", () => {
  const modal = $("join-workshop-modal");
  if (modal) modal.hidden = true;
});

addSafeListener($("btn-refresh-lobby"), "click", () => {
  // Force re-fetch workshops from Firebase
  loadGlobalWorkshops();
  startGlobalWorkshopsListener();
  toast("Lobi yenilendi!");
});

addSafeListener($("f-join-workshop"), "submit", async e => {
  e.preventDefault();
  const code = $("jw-code").value.trim();
  const err = $("jw-err");
  if (!code) { err.textContent = "Davet kodu girin."; return; }
  // Navigate to URL with invite parameter
  const link = location.origin + location.pathname + "?invite=" + encodeURIComponent(code);
  window.location.href = link;
});

addSafeListener($("btn-logout-lobby"), "click", () => {
  ls.del(LS_USERNAME);
  S.meId = null;
  S.username = null;
  S.canWrite = false;
  S.currentWorkshop = null;
  route();
});

addSafeListener($("btn-open-lobby"), "click", () => {
  S.welcomeShown = true;
  showLobby();
});

addSafeListener(document, "click", e => {
  if (e.target.classList.contains("modal-overlay") || e.target.classList.contains("modal-close")) {
    document.querySelectorAll(".modal-overlay").forEach(m => m.hidden = true);
  }
}, {}, 'modal-close-handler');

/* ---------- notifications & sound ---------- */
let audioCtx = null;
S.sound = ls.get("atolye-sound") !== "off";
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) {}
}
for (const ev of ["pointerdown", "keydown"]) addSafeListener(document, ev, unlockAudio, { capture: true }, 'audio-unlock-' + ev);
function chime() {
  if (!S.sound || !audioCtx || audioCtx.state !== "running") return;
  const t0 = audioCtx.currentTime;
  [[880, 0], [1318.5, 0.12]].forEach(([f, d]) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.45);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0 + d); o.stop(t0 + d + 0.5);
  });
}
const SOUNDS = {
  new:   { label: "Yeni not",      wave: "sine",     notes: [[880, 0, .35], [1318.5, .12, .4]] },
  reply: { label: "Yanit",         wave: "triangle", notes: [[784, 0, .12], [988, .1, .2]] },
  edit:  { label: "Duzenleme",     wave: "sine",     notes: [[523, 0, .3]], vol: .18 },
  done:  { label: "Not bitti",     wave: "triangle", notes: [[523, 0, .18], [659, .1, .18], [784, .2, .18], [1046.5, .3, .55]] },
  yes:   { label: "Onay",          wave: "sine",     notes: [[659, 0, .16], [880, .13, .38]] },
  no:    { label: "Ret",           wave: "sawtooth", notes: [[392, 0, .2], [294, .17, .42]], vol: .09 },
  work:  { label: "Ilgileniyor",   wave: "triangle", notes: [[330, 0, .08], [330, .14, .08], [494, .28, .16]] },
  chat:  { label: "Sohbet mesaji", wave: "sine",     notes: [[600, 0, .14, 1200]] },
  ai:    { label: "AI cevabi", wave: "sine",     notes: [[1046.5, 0, .14], [1318.5, .08, .14], [1568, .16, .14], [2093, .24, .35]], vol: .14 },
  ping:  { label: "Durtme",        fn: force => pingSound(force) }
};
function playSound(k, force) {
  if ((!S.sound && !force) || !audioCtx || audioCtx.state !== "running") return;
  const s = SOUNDS[k] || SOUNDS.new;
  if (s.fn) return s.fn(force);
  const t0 = audioCtx.currentTime, vol = s.vol || .25;
  for (const [f, d, dur, f2] of s.notes) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = s.wave;
    o.frequency.setValueAtTime(f, t0 + d);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d + dur);
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(vol, t0 + d + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0 + d); o.stop(t0 + d + dur + 0.05);
  }
}
const PRIO = ["done", "yes", "no", "new", "reply", "work", "edit"];
const topSound = items => PRIO.find(p => items.some(i => i.snd === p)) || "new";
for (const [k, s] of Object.entries(SOUNDS)) $("snd-list").append(h("button", { type: "button", class: "chip",
  onclick: () => { unlockAudio(); setSafeTimeout(() => playSound(k, true), 30); } }, "▶ " + s.label));

function renderSoundBtn() {
  const b = $("btn-sound");
  b.textContent = S.sound ? "Ses acik" : "Ses kapali";
  b.setAttribute("aria-pressed", String(S.sound));
}
addSafeListener($("btn-sound"), "click", () => {
  S.sound = !S.sound; ls.set("atolye-sound", S.sound ? "on" : "off");
  renderSoundBtn(); unlockAudio(); setSafeTimeout(chime, 30);
}, {}, 'btn-sound-click');
renderSoundBtn();

function detectNews(prev, next) {
  if (!S.meId) return [];
  const old = new Map(prev.map(n => [n.id, n]));
  const out = [];
  for (const n of next) {
    const o = old.get(n.id);
    if (!o) {
      if (n.author !== S.meId && n.createdAt > S.liveSince) out.push({ by: n.author, snd: "new", text: "yeni not ekledi", id: n.id, title: n.title, kind: n.kind });
      continue;
    }
    for (const [uid, val] of Object.entries(n.working || {})) {
      const ow = (o.working || {})[uid];
      if (uid !== S.meId && val && val.at > S.liveSince && (!ow || ow.at !== val.at))
        out.push({ by: uid, snd: "work", text: "bu konuyla ilgilenmeye basladi ⚒", id: n.id, title: n.title, kind: n.kind });
    }
    for (const [k, m] of Object.entries(n.rvotes || {})) for (const [uid, val] of Object.entries(m || {})) {
      const orv = ((o.rvotes || {})[k] || {})[uid];
      if (uid !== S.meId && val && val.at > S.liveSince && (!orv || orv.at !== val.at))
        out.push({ by: uid, snd: val.v, text: val.v === "yes" ? "bir yorumu onayladi ✓" : "bir yorumu reddetti ✕", id: n.id, title: n.title, kind: n.kind });
    }
    for (const [uid, val] of Object.entries(n.votes || {})) {
      const ov = (o.votes || {})[uid];
      if (uid !== S.meId && val && val.at > S.liveSince && (!ov || ov.at !== val.at))
        out.push({ by: uid, snd: val.v, text: val.v === "yes" ? "fikre onay verdi ✓" : "fikri reddetti ✕", id: n.id, title: n.title, kind: n.kind });
    }
    if (n.updatedAt === o.updatedAt) continue;
    const fresh = (n.replies || []).slice((o.replies || []).length).filter(r => r.a !== S.meId && r.at > S.liveSince);
    if (fresh.length) out.push({ by: fresh[fresh.length - 1].a, snd: "reply", text: "yanit yazdi", id: n.id, title: n.title, kind: n.kind, quote: fresh[fresh.length - 1].t });
    else if (n.updatedBy !== S.meId && n.updatedAt > S.liveSince) out.push({ by: n.updatedBy, snd: n.status === "bitti" && o.status !== "bitti" ? "done" : "edit", text: n.status === "bitti" && o.status !== "bitti" ? "notu bitirdi ✓" : "notu guncelledi", id: n.id, title: n.title, kind: n.kind });
  }
  return out;
}
function notify(item) {
  const el = h("button", { type: "button", class: "notif", style: kindVars(item.kind) + ";--uc:" + ucol(item.by),
    onclick: () => { el.remove(); if (item.chat) setView("chat"); else if (item.upd) setView("upd"); else openSheet(item.id); } },
    avatar(item.by),
    h("div", {}, h("div", {}, nameEl(item.by), " " + item.text),
      h("div", { class: "nt" }, item.title),
      item.quote && h("div", { class: "nq" }, item.quote)));
  $("notifs").prepend(el);
  setSafeTimeout(() => el.remove(), 8000);
}

/* ---------- ping ("durt") ---------- */
S.pingSubs = {}; S.pingOut = {}; S.pingIn = null;
let lastPingAt = 0;
function pingSound() {
  if ((!S.sound && !arguments[0]) || !audioCtx || audioCtx.state !== "running") return;
  const t0 = audioCtx.currentTime;
  [[660, 0], [660, .18], [990, .36], [660, .85], [660, 1.03], [990, 1.21]].forEach(([f, d]) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = "square"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + d + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.15);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0 + d); o.stop(t0 + d + 0.17);
  });
}
async function sendPing(to, noteId) {
  const last = S.pingOut[to];
  if (last && last.from === S.meId && Date.now() - last.at < 10000) { toast("Az once durttun, biraz bekle"); return; }
  const n = noteId ? S.notes.find(x => x.id === noteId) : null;
  if (await write(() => S.db.doc("pings/" + to).set({ from: S.meId, at: Date.now(), note: noteId || null, title: n ? n.title : null, seenAt: null })))
    toast(who(to) + " durtuldu");
}
async function ackPing() {
  $("pingbar").hidden = true;
  await write(() => S.db.doc("pings/" + S.meId).update({ seenAt: Date.now() }));
}
function renderPingIn() {
  const p = S.pingIn, box = $("pingbar");
  const active = !!(p && p.from && p.from !== S.meId && !(p.seenAt && p.seenAt >= p.at));
  box.hidden = !active;
  if (!active) return;
  if (p.at > lastPingAt) { if (p.at > S.liveSince) pingSound(); lastPingAt = p.at; }
  box.replaceChildren(avatar(p.from),
    h("div", { class: "pt" }, h("div", {}, nameEl(p.from), " seni durttu, cevap bekliyor"),
      h("div", { class: "ps" }, (p.title ? "“" + p.title + "” · " : "") + ago(p.at))),
    p.note && h("button", { class: "btn", type: "button", onclick: () => { ackPing(); openSheet(p.note); } }, "Notu ac"),
    h("button", { class: "btn primary", type: "button", onclick: ackPing }, "Gordum"));
}
function watchPings() {
  if (!S.db || !S.meId) return;
  if (!S.pingSubs[S.meId]) S.pingSubs[S.meId] = S.db.doc("pings/" + S.meId).onSnapshot(s => {
    S.pingIn = s.exists ? s.data() : null; renderPingIn();
  }, () => {});
  for (const id of S.colorOrder || []) if (id !== S.meId && !S.pingSubs[id])
    S.pingSubs[id] = S.db.doc("pings/" + id).onSnapshot(s => {
      const prev = S.pingOut[id], cur = s.exists ? s.data() : null;
      S.pingOut[id] = cur;
      if (prev && cur && cur.from === S.meId && !prev.seenAt && cur.seenAt && cur.at === prev.at) toast(who(id) + " durtmeni gordu ✓");
      renderPeople(S.lastIds || new Set());
    }, () => {});
}

/* ---------- chat ---------- */
S.chat = []; S.chatIds = null; S.chatSeen = Number(ls.get("atolye-chatseen")) || 0;
function markChatSeen() { pushSeen(); if (S.unreadFrom == null) { S.unreadFrom = S.chatSeen; S.unreadUntil = Date.now(); } S.chatSeen = Date.now(); ls.set("atolye-chatseen", String(S.chatSeen)); renderChatBadge(); }
function renderChatBadge() {
  const unread = S.chat.filter(m => m.a !== S.meId && m.at > S.chatSeen).length, b = $("n-chat");
  b.hidden = !unread; b.textContent = unread;
  renderTotals();
}
/* ---------- notification counter (top bar): unread chat + new/changed notes ---------- */
S.seenNotes = (() => { try { return JSON.parse(ls.get("atolye-seen-notes") || "{}") || {}; } catch (e) { return {}; } })();
function markNoteSeen(id) { S.seenNotes[id] = Date.now(); ls.set("atolye-seen-notes", JSON.stringify(S.seenNotes)); }
function counts() {
  const notes = S.notes.filter(isFresh).length;
  const chat = S.chat.filter(m => m.a !== S.meId && m.at > S.chatSeen).length;
  return { notes, chat, total: notes + chat };
}
function renderTotals() {
  const c = counts(), b = $("bell");
  b.classList.toggle("has", c.total > 0);
  $("bell-n").textContent = c.total;
  $("bell-parts").textContent = "Sohbet " + c.chat + " · Not " + c.notes;
  b.title = "Okunmamis sohbet: " + c.chat + " · Yeni/degisen not: " + c.notes + " · Toplam: " + c.total;
  if (!$("pop-bell").hidden) fillBell();
}
function closeBell() { $("pop-bell").hidden = true; $("bell").setAttribute("aria-expanded", "false"); }
function fillBell() {
  const c = counts();
  $("pop-bell").replaceChildren(
    h("span", { class: "label" }, "Bildirimler"),
    h("div", { class: "brow" }, h("span", {}, "Okunmamis sohbet: ", h("b", {}, c.chat)),
      h("button", { class: "btn sm", type: "button", onclick: () => { closeBell(); setView("chat"); } }, "Sohbeti ac")),
    h("div", { class: "brow" }, h("span", {}, "Yeni / degisen not: ", h("b", {}, c.notes)),
      h("button", { class: "btn sm", type: "button", onclick: () => { closeBell(); S.f.fresh = true; setView("active"); } }, "Goster")),
    h("div", { class: "brow" }, h("span", {}, "Toplam: ", h("b", {}, c.total))),
    h("button", { class: "btn", type: "button", disabled: !c.total, onclick: markAllSeen }, "Hepsini okundu say"));
}
function markAllSeen() {
  S.prevSeen = Date.now(); ls.set(LS_SEEN, String(S.prevSeen));
  S.seenNotes = {}; ls.set("atolye-seen-notes", "{}");
  S.f.fresh = false;
  markChatSeen(); render();
}
addSafeListener($("bell"), "click", () => {
  const pop = $("pop-bell"); pop.hidden = !pop.hidden;
  $("bell").setAttribute("aria-expanded", String(!pop.hidden));
  if (!pop.hidden) fillBell();
}, {}, 'bell-click');
addSafeListener(document, "click", e => { if (!e.target.closest("#bellwrap")) closeBell(); }, {}, 'bell-close-outside');
addSafeListener($("fresh-clear"), "click", () => { S.f.fresh = false; renderCards(); }, {}, 'fresh-clear-click');
function onChat(snap) {
  const prev = S.chatIds;
  S.chat = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(m => typeof m.at === "number").reverse();
  if (prev) {
    const fresh = S.chat.filter(m => !prev.has(m.id) && m.a !== S.meId && m.at > S.liveSince);
    const viewing = S.view === "chat" && !document.hidden;
    if (fresh.length) {
      playSound("chat");
      if (!viewing) {
        const last = fresh[fresh.length - 1];
        render().then(() => notify({ chat: true, by: last.a, text: last.poll ? "oylama baslatti 📊" : last.sticker || last.cst ? "sticker gonderdi" : last.voice ? "sesli mesaj gonderdi 🎤" : (last.files || []).length ? "dosya gonderdi" : (last.imgs || []).length ? "fotograf gonderdi" : "mesaj gonderdi",
          title: (last.t || (last.poll && last.poll.q) || (last.sticker && STICKERS[last.sticker] ? STICKERS[last.sticker].join(" ") : "") || ((last.files || [])[0] || {}).name || "Fotograf").slice(0, 140) }));
      }
    }
  }
  S.chatIds = new Set(S.chat.map(m => m.id));
  if (S.view === "chat" && !document.hidden) markChatSeen();
  render();
}
function renderChat(forceBottom) {
  const chatLog = $("chat-log");
  const nearBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 80;
  chatLog.replaceChildren();
  if (!S.chat.length) chatLog.append(h("div", { class: "empty" }, h("strong", {}, "Sohbet bos"),
    "Fikirlerden bagimsiz konusmak icin buraya yaz. Mesajlar kaydedilir, ikiniz de gorursunuz."));
  let lastDay = "", lastBy = null, lastAt = 0, lineDone = false;
  const lastMine = [...S.chat].reverse().find(x => x.a === S.meId);
  for (const m of S.chat) {
    if (!lineDone && S.view === "chat" && S.unreadFrom != null && m.a !== S.meId && m.at > S.unreadFrom && m.at <= S.unreadUntil) {
      const cnt = S.chat.filter(x => x.a !== S.meId && x.at > S.unreadFrom && x.at <= S.unreadUntil).length;
      chatLog.append(h("div", { class: "unread-line" }, cnt + " okunmamis mesaj")); lineDone = true; lastBy = null;
    }
    const d = new Date(m.at);
    const day = d.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });
    if (day !== lastDay) { chatLog.append(h("div", { class: "day" }, day)); lastDay = day; lastBy = null; }
    const mine = m.a === S.meId, grouped = lastBy === m.a && m.at - lastAt < 5 * 60 * 1000;
    let del = null;
    if (mine) {
      del = h("button", { class: "mdel", type: "button" }, "sil");
      addSafeListener(del, "click", async () => {
        if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = "emin misin? tekrar tikla"; return; }
        await write(() => S.db.doc("chat/" + m.id).delete());
      }, {}, 'chat-del-' + m.id);
    }
    chatLog.append(h("div", { class: "msg" + (mine ? " me" : ""), style: "--uc:" + ucol(m.a), "data-mid": m.id },
      grouped ? h("span", { class: "ph" }) : avatar(m.a, "sm"),
      h("div", { class: "mb" },
        !grouped && h("div", { class: "mh" }, nameEl(m.a), " ", h("span", { class: "mt" }, d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }))),
        m.re && m.re.id ? h("button", { type: "button", class: "mquote", style: "--qc:" + ucol(m.re.a), title: "Yanitlanan mesaja git", onclick: () => jumpTo(m.re.id) },
          h("b", {}, who(m.re.a)), " ", m.re.t || "…") : null,
        (m.imgs || []).length ? h("div", { class: "mimgs" }, m.imgs.map(id => h("img", { src: imgUrl(id), alt: "", loading: "lazy",
          onclick: () => lightbox(id),
          onload: () => { const l = $("chat-log"); if (l.scrollHeight - l.scrollTop - l.clientHeight < 400) l.scrollTop = l.scrollHeight; } }))) : null,
        (m.files || []).length ? h("div", { class: "mfiles" }, m.files.map(fl => fl.type && fl.type.startsWith("video/")
          ? h("video", { src: imgUrl(fl.id), controls: true, preload: "metadata", playsinline: true })
          : h("a", { class: "mfile", href: imgUrl(fl.id), target: "_blank", rel: "noopener", title: "Yeni sekmede ac" },
              h("span", { class: "fx" }, String(fl.name || "").split(".").pop().slice(0, 4) || "dosya"),
              h("span", { class: "fn" }, fl.name || "dosya"), h("span", { class: "fs" }, fmtSize(fl.size || 0))))) : null,
        m.voice && m.voice.id ? h("div", { class: "mvoice" }, h("audio", { src: imgUrl(m.voice.id), controls: true, preload: "metadata" }),
          h("span", { class: "fs" }, "🎤 " + fmtDur(m.voice.dur || 0))) : null,
        m.poll ? pollEl(m) : null,
        m.sticker && STICKERS[m.sticker] ? stickerEl(m.sticker) : null,
        m.cst && m.cst.img ? customStickerEl({ a: m.cst.by || m.a, img: m.cst.img, label: m.cst.label }) : null,
        S.editing === m.id ? editBox(m)
          : m.t ? h("div", { class: "mx" + (BIG_EMOJI.test(m.t) && m.t.length <= 12 ? " big" : "") }, linkify(m.t), m.editedAt ? h("span", { class: "edited" }, " (duzenlendi)") : null) : null,
        h("div", { class: "macts" }, mine ? seenTick(m, lastMine && lastMine.id === m.id) : null,
          h("button", { class: "mdel", type: "button", onclick: () => setReply(m) }, "↩ yanitla"),
          mine && m.t && S.editing !== m.id ? h("button", { class: "mdel", type: "button", onclick: () => startEdit(m) }, "✎ duzenle") : null, del))));
    lastBy = m.a; lastAt = m.at;
  }
  if (forceBottom || nearBottom) chatLog.scrollTop = chatLog.scrollHeight;
  const ta = S.editing && $("edit-in");
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}
S.chatImgs = []; S.chatFiles = []; S.chatUploading = 0;
/* file types the platform's asset store accepts (besides images); 20 MB per file is a platform limit */
const FILE_TYPES = { pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json" };
function fileType(f) {
  const ext = (String(f.name || "").split(".").pop() || "").toLowerCase();
  return FILE_TYPES[ext] || (Object.values(FILE_TYPES).includes(f.type) ? f.type : null);
}
const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
function renderChatAtt() {
  const box = $("chat-att");
  box.hidden = !S.chatImgs.length && !S.chatFiles.length && !S.chatUploading;
  box.replaceChildren();
  for (const fl of S.chatFiles) box.append(h("div", { class: "attf" }, h("span", {}, fl.name), h("span", { class: "fs" }, fmtSize(fl.size)),
    h("button", { type: "button", "aria-label": "Dosyayi cikar", onclick: () => {
      S.chatFiles = S.chatFiles.filter(x => x !== fl); renderChatAtt();
      if (S.assets) S.assets.delete(fl.id).catch(() => {});
    } }, "×")));
  for (const id of S.chatImgs) box.append(h("div", { class: "thumb" }, h("img", { src: imgUrl(id), alt: "" }),
    h("button", { type: "button", "aria-label": "Fotografi cikar", onclick: () => {
      S.chatImgs = S.chatImgs.filter(x => x !== id); renderChatAtt();
      if (S.assets) S.assets.delete(id).catch(() => {});
    } }, "×")));
  for (let i = 0; i < S.chatUploading; i++) box.append(h("div", { class: "thumb loading" }, "yukleniyor"));
}
async function addChatImages(files) {
  files = [...files];
  if (!files.length) return;
  if (!S.assets) { toast("Dosya eklemek icin sayfanin sahibi seni Duzenleyici yapmali."); return; }
  const imgs = files.filter(f => IMG_TYPES.includes(f.type)), others = files.filter(f => !IMG_TYPES.includes(f.type));
  S.chatUploading += files.length; renderChatAtt();
  if (imgs.length) {
    const got = await uploadMedia(imgs, { set textContent(v) { if (v) toast(v); } });
    S.chatImgs.push(...got.images);
  }
  for (const f of others) {
    const type = fileType(f);
    if (!type) toast((f.name || "Dosya") + ": bu tur yuklenemiyor. Gorsel, PDF, MP4/WEBM, TXT, MD, CSV ve JSON destekleniyor.");
    else if (f.size > 20 * 1024 * 1024) toast((f.name || "Dosya") + " 20 MB'tan buyuk. Maksimum 20 MB dosya boyutu.");
    else {
      try { const r = await S.assets.upload(f, { type }); S.chatFiles.push({ id: r.id, name: String(f.name || "dosya").slice(0, 120), type, size: f.size }); }
      catch (e) { toast(assetErr(e)); }
    }
  }
  S.chatUploading -= files.length; renderChatAtt();
  $("chat-in").focus();
}
async function sendChat() {
  const inp = $("chat-in"), t = inp.value.trim(), imgs = S.chatImgs.slice(), files = S.chatFiles.slice();
  if ((!t && !imgs.length && !files.length) || !S.meId) return;
  if (S.chatUploading) { toast("Dosya yukleniyor, bir saniye…"); return; }
  inp.value = ""; S.chatImgs = []; S.chatFiles = []; renderChatAtt();
  const re = S.replyTo || null; S.replyTo = null; renderReplyBar();
  const ok = await write(() => S.db.collection("chat").add({ a: S.meId, t: t.slice(0, 4000), at: Date.now(), imgs, files, re }));
  if (!ok) { inp.value = t; S.chatImgs = imgs; S.chatFiles = files; renderChatAtt(); S.replyTo = re; renderReplyBar(); } else setSafeTimeout(() => renderChat(true), 0);
}
/* voice messages: record with the microphone, upload the clip as an asset (webm/mp4 container), store {voice:{id,type,dur}} in chat */
const fmtDur = s => Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0");
S.rec = null;
async function toggleVoice() {
  const btn = $("voice-btn");
  if (S.rec) { S.rec.mr.stop(); return; }
  if (!S.assets) { toast("Sesli mesaj gondermek icin sayfanin sahibi seni Duzenleyici yapmali."); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { toast("Bu tarayici ses kaydini desteklemiyor."); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  // Artifact cercevesi mikrofona izin vermiyor (Izinler menusunde de cikmaz); sesli sohbet ayri sayfada calisir.
  catch (e) { toast("Claude sayfasi mikrofona izin vermiyor. Sesli sohbet icin 📞 dugmesini kullan; yeni sekmede acilir."); return; }
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks = [], start = Date.now();
  const tick = setSafeInterval(() => { btn.textContent = "■ " + fmtDur((Date.now() - start) / 1000); }, 500);
  S.rec = { mr };
  btn.classList.add("rec"); btn.setAttribute("aria-pressed", "true"); btn.textContent = "■ 0:00"; btn.title = "Kaydi bitir ve gonder";
  mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  mr.onstop = async () => {
    clearSafeInterval(tick); stream.getTracks().forEach(t => t.stop()); S.rec = null;
    btn.classList.remove("rec"); btn.setAttribute("aria-pressed", "false"); btn.textContent = "🎤"; btn.title = "Sesli mesaj kaydet: bir kez tikla baslasin, tekrar tikla gonderilsin";
    const dur = (Date.now() - start) / 1000;
    if (dur < 0.7 || !chunks.length) { toast("Kayit cok kisa, gonderilmedi."); return; }
    const type = (mr.mimeType || mime).includes("mp4") ? "video/mp4" : "video/webm";
    const blob = new Blob(chunks, { type });
    if (blob.size > 20 * 1024 * 1024) { toast("Sesli mesaj 20 MB'tan buyuk, gonderilemedi."); return; }
    toast("Sesli mesaj gonderiliyor…");
    let r;
    try { r = await S.assets.upload(blob, { type }); } catch (e) { toast(assetErr(e)); return; }
    const re = S.replyTo || null; S.replyTo = null; renderReplyBar();
    if (await write(() => S.db.collection("chat").add({ a: S.meId, t: "", at: Date.now(), voice: { id: r.id, type, dur: Math.round(dur) }, re })))
      setSafeTimeout(() => renderChat(true), 0);
  };
  mr.start(1000);
  if (S.recMax) clearSafeTimeout(S.recMax);
  S.recMax = setSafeTimeout(() => { if (S.rec && S.rec.mr === mr) mr.stop(); }, 5 * 60 * 1000);
}
addSafeListener($("voice-btn"), "click", toggleVoice, {}, 'voice-btn-click');
/* read receipts: each person keeps chatseen/<id> = time they last looked at the chat */
S.seenBy = {};
let seenTimer = null;
function pushSeen() {
  clearSafeTimeout(seenTimer);
  seenTimer = setSafeTimeout(() => { if (S.db && S.meId) S.db.doc("chatseen/" + S.meId).set({ at: Date.now() }).catch(() => {}); }, 800);
}
function seenTick(m, isLast) {
  const seenIds = Object.entries(S.seenBy || {}).filter(([id, v]) => id !== S.meId && v && v.at >= m.at).map(([id]) => id);
  const t = new Date(m.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const label = seenIds.length
    ? "✓✓" + (isLast ? " " + seenIds.map(who).join(", ") + " gordu" : "")
    : "✓" + (isLast ? " Iletildi, henuz gorulmedi" : "");
  return h("span", { class: "tick" + (seenIds.length ? " seen" : ""),
    title: seenIds.length ? "Gordu: " + seenIds.map(who).join(", ") : "Gonderildi (" + t + "), henuz gorulmedi" }, label);
}
/* edit your own text messages in place */
S.editing = null; S.editDraft = "";
function startEdit(m) { S.editing = m.id; S.editDraft = m.t || ""; renderChat(false); }
function cancelEdit() { S.editing = null; renderChat(false); }
function editBox(m) {
  const ta = h("textarea", { class: "field", id: "edit-in", rows: "2", "aria-label": "Mesaji duzenle" });
  ta.value = S.editDraft;
  addSafeListener(ta, "input", () => { S.editDraft = ta.value; }, {}, 'edit-input-' + m.id);
  addSafeListener(ta, "keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveEdit(m); }
    else if (e.key === "Escape") { e.stopPropagation(); cancelEdit(); }
  }, {}, 'edit-keydown-' + m.id);
  return h("div", { class: "editbox" }, ta, h("div", { class: "macts" },
    h("button", { class: "btn sm primary", type: "button", onclick: () => saveEdit(m) }, "Kaydet"),
    h("button", { class: "btn sm ghost", type: "button", onclick: cancelEdit }, "Iptal")));
}
async function saveEdit(m) {
  const t = S.editDraft.trim();
  if (!t) { toast("Mesaj bos olamaz. Silmek icin “sil”i kullan."); return; }
  if (t === m.t) { cancelEdit(); return; }
  if (await write(() => S.db.doc("chat/" + m.id).update({ t: t.slice(0, 4000), editedAt: Date.now() }))) cancelEdit();
}

/* reply to a message: a short quote travels with the new message */
S.replyTo = null;
function msgSnippet(m) {
  if (m.t) return m.t.replace(/\s+/g, " ").slice(0, 120);
  if (m.sticker && STICKERS[m.sticker]) return STICKERS[m.sticker].join(" ");
  if (m.poll) return "Oylama: " + m.poll.q;
  if (m.cst) return "Sticker" + (m.cst.label ? ": " + m.cst.label : "");
  if ((m.imgs || []).length) return "Fotograf";
  if ((m.files || []).length) return "Dosya: " + (m.files[0].name || "");
  return "…";
}
function setReply(m) {
  S.replyTo = { id: m.id, a: m.a, t: msgSnippet(m) };
  renderReplyBar(); $("chat-in").focus();
}
function renderReplyBar() {
  const bar = $("replybar"), r = S.replyTo;
  bar.hidden = !r; bar.replaceChildren();
  if (!r) return;
  bar.style.setProperty("--qc", ucol(r.a));
  bar.append(h("span", {}, "↩ "), nameEl(r.a), h("span", {}, " adli kisiye yanit:"), h("span", { class: "rt" }, r.t),
    h("button", { class: "btn ghost sm", type: "button", "aria-label": "Yaniti iptal et", onclick: () => { S.replyTo = null; renderReplyBar(); } }, "×"));
}
function jumpTo(id) {
  const el = document.querySelector('[data-mid="' + String(id).replace(/[^A-Za-z0-9_-]/g, "") + '"]');
  if (!el) { toast("Bu mesaj artik sohbette yok"); return; }
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  setSafeTimeout(() => el.classList.remove("flash"), 1500);
}
addSafeListener($("chat-in"), "keydown", e => { if (e.key === "Escape" && S.replyTo) { S.replyTo = null; renderReplyBar(); } }, {}, 'chat-in-keydown-escape');
addSafeListener($("chat-file"), "change", e => { const fs = [...e.target.files]; e.target.value = ""; addChatImages(fs); }, {}, 'chat-file-change');
addSafeListener($("chat-in"), "paste", e => {
  const fs = [...((e.clipboardData && e.clipboardData.files) || [])];
  if (fs.length) { e.preventDefault(); addChatImages(fs); }
}, {}, 'chat-in-paste');
addSafeListener($("chat"), "dragover", e => { e.preventDefault(); $("chat").classList.add("drag"); }, {}, 'chat-dragover');
addSafeListener($("chat"), "dragleave", e => { if (e.target === $("chat")) $("chat").classList.remove("drag"); }, {}, 'chat-dragleave');
addSafeListener($("chat"), "drop", e => { e.preventDefault(); $("chat").classList.remove("drag"); addChatImages(e.dataTransfer.files); }, {}, 'chat-drop');

/* emoji picker and the team's own sticker set */
const EMOJI = {
  "Yuzler": "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😜 🤪 😎 🤩 🥳 😏 😒 😔 😢 😭 😤 😡 🤯 😱 🤔 🤫 🙄 😴 🤤 😬 🥲 💀 👻 🤖",
  "El": "👍 👎 👏 🙌 👋 🤝 🙏 💪 ✌️ 🤞 👌 🤌 👀 🫡 ☝️ 👉",
  "Oyun": "🎮 🕹️ 👾 🎲 🏆 🥇 ⚔️ 🛡️ 🏹 💣 💎 🪙 🗺️ 🧩 🐉 🧟 🧙 🚀 👑 🔑 💰 🎯",
  "Simge": "❤️ 🧡 💛 💚 💙 💜 🖤 💔 🔥 ✨ ⭐ ⚡ 💥 💯 ✅ ❌ ⚠️ ❓ ❗ 🐛 🎉 💡 📌 ⏳"
};
const STICKERS = {
  yaniyor: ["🔥", "YANIYOR"], koptum: ["😂", "KOPTUM"], helal: ["👏", "HELAL"], akil: ["🤯", "AKIL ALMAZ"],
  oldum: ["💀", "OLDUM"], oyna: ["🎮", "OYNAYALIM"], bug: ["🐛", "BUG VAR"], tamam: ["✅", "TAMAMDIR"],
  uyku: ["😴", "UYKUM VAR"], gazla: ["🚀", "GAZLA"], sevdim: ["❤️", "SEVDIM"], emin: ["🤔", "EMIN DEGILIM"],
  gg: ["🏆", "GG"], bekle: ["⏳", "BEKLE"], efsane: ["👑", "EFSANE"], noluyor: ["😱", "NOLUYOR"],
  bendecalisiyor: ["🤷", "BENDE CALISIYOR"], ozellik: ["🙃", "BUG DEGIL OZELLIK"], deadline: ["😰", "DEADLINE YARIN"], kahve: ["☕", "KAHVE LAZIM"],
  patladi: ["💥", "KOD PATLADI"], yarin: ["🫠", "YARIN BAKARIZ"], beyin: ["🧠", "BEYNIM.EXE COKTU"], spagetti: ["🍝", "SPAGETTI KOD"],
  yolunda: ["🙂", "HER SEY YOLUNDA"], ctrlz: ["⏪", "CTRL+Z"], boss: ["🐉", "BOSS FIGHT"], lag: ["🐢", "LAG VAR"],
  teksatir: ["😵", "TEK SATIR DEGISTI"], patch: ["🩹", "PATCH GELIYOR"], nerf: ["🔨", "NERF SART"], buff: ["💪", "BUFF LAZIM"],
  kaydet: ["💾", "KAYDETTIN MI?"], rage: ["🤬", "RAGE QUIT"], easter: ["🥚", "EASTER EGG"], sabah: ["🌅", "SABAH OLDU"]
};
const BIG_EMOJI = /^(?:\p{Extended_Pictographic}|️|‍|\s)+$/u;
const STK_KINDS = ["fikir", "mekanik", "hikaye", "sanat", "gorev", "hata", "videolar"];
function stickerEl(key, tag, extra) {
  const [e, label] = STICKERS[key], k = STK_KINDS[Object.keys(STICKERS).indexOf(key) % STK_KINDS.length];
  return h(tag || "div", Object.assign({ class: "stk", style: `--sc:var(--k-${k});--sb:var(--k-${k}-bg)` }, extra || {}),
    h("span", { class: "se" }, e), h("span", { class: "st" }, label));
}
S.epTab = "Yuzler";
function renderEmojiPop() {
  const pop = $("emoji-pop");
  const keepLabel = $("stk-label") ? $("stk-label").value : "";
  const tabs = Object.keys(EMOJI).concat(["Sticker"]);
  pop.replaceChildren(h("div", { class: "etabs" }, tabs.map(t => h("button", { type: "button", "aria-pressed": String(S.epTab === t),
    onclick: () => { S.epTab = t; renderEmojiPop(); } }, t))),
    S.epTab === "Sticker"
      ? h("div", { class: "sgrid" },
          (S.stickers || []).map(st => h("div", { class: "stkwrap" },
            customStickerEl(st, "button", { type: "button", title: st.label || "", onclick: () => sendCustomSticker(st) }),
            st.a === S.meId ? h("button", { class: "stkdel", type: "button", "aria-label": "Sticker'i sil", onclick: () => write(() => S.db.doc("stickers/" + st.id).delete()) }, "×") : null)),
          Object.keys(STICKERS).map(k => stickerEl(k, "button", { type: "button", title: STICKERS[k][1], onclick: () => sendSticker(k) })))
      : h("div", { class: "egrid" }, EMOJI[S.epTab].split(" ").map(e => h("button", { type: "button", onclick: () => insertEmoji(e) }, e))),
    S.epTab === "Sticker" && S.assets && S.meId ? h("div", { class: "stkadd" },
      h("input", { class: "field", id: "stk-label", maxlength: "24", placeholder: "Kendi sticker'in: yazi (istege bagli)" }),
      h("label", { class: "btn sm", for: "stk-file" }, "+ Resim sec ve ekle",
        h("input", { type: "file", id: "stk-file", accept: IMG_TYPES.join(","), hidden: true, onchange: addCustomSticker }))) : null);
  if ($("stk-label")) $("stk-label").value = keepLabel;
}
function customStickerEl(st, tag, extra) {
  return h(tag || "div", Object.assign({ class: "stk cst", style: "--sc:" + ucol(st.a) + ";--sb:var(--paper-2)" }, extra || {}),
    h("img", { src: imgUrl(st.img), alt: "" }), st.label ? h("span", { class: "st" }, st.label) : null);
}
async function sendCustomSticker(st) {
  if (!S.meId) return;
  toggleEmoji(false);
  if (await write(() => S.db.collection("chat").add({ a: S.meId, t: "", at: Date.now(), cst: { img: st.img, label: st.label || "", by: st.a } })))
    setSafeTimeout(() => renderChat(true), 0);
}
async function addCustomSticker(e) {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  const label = ($("stk-label").value || "").trim().toLocaleUpperCase("tr").slice(0, 24);
  const got = await uploadMedia([f], { set textContent(v) { if (v) toast(v); } });
  if (!got.images[0]) return;
  if (await write(() => S.db.collection("stickers").add({ a: S.meId, img: got.images[0], label, at: Date.now() }))) {
    $("stk-label").value = ""; toast("Sticker eklendi, ikiniz de kullanabilirsiniz");
  }
}
function toggleEmoji(open) {
  const pop = $("emoji-pop");
  pop.hidden = open === undefined ? !pop.hidden : !open;
  $("emoji-btn").setAttribute("aria-expanded", String(!pop.hidden));
  if (!pop.hidden) renderEmojiPop();
}
function insertEmoji(e) {
  const inp = $("chat-in");
  const s = inp.selectionStart != null ? inp.selectionStart : inp.value.length, en = inp.selectionEnd != null ? inp.selectionEnd : s;
  inp.setRangeText(e, s, en, "end"); inp.focus();
}
async function sendSticker(key) {
  if (!S.meId) return;
  toggleEmoji(false);
  if (await write(() => S.db.collection("chat").add({ a: S.meId, t: "", at: Date.now(), sticker: key }))) setSafeTimeout(() => renderChat(true), 0);
}
addSafeListener($("emoji-btn"), "click", () => toggleEmoji(), {}, 'emoji-btn-click');

/* polls on any topic: a chat message with poll {q, opts, closed}; votes in pv {userId: optionIndex} */
S.pollDraft = null;
function togglePollForm(open) {
  const pop = $("poll-pop");
  pop.hidden = open === undefined ? !pop.hidden : !open;
  $("poll-btn").setAttribute("aria-expanded", String(!pop.hidden));
  if (!pop.hidden) { if (!S.pollDraft) S.pollDraft = { q: "" }; renderPollForm(); setSafeTimeout(() => $("poll-q") && $("poll-q").focus(), 0); }
}
function renderPollForm() {
  const d = S.pollDraft, pop = $("poll-pop");
  const q = h("input", { class: "field", id: "poll-q", maxlength: "200", placeholder: "Ne oylansin? Orn: Ana karakter hangi sinif olsun?" });
  q.value = d.q; addSafeListener(q, "input", () => { d.q = q.value; }, {}, 'poll-q-input');
  addSafeListener(q, "keydown", e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); startPoll(); } }, {}, 'poll-q-keydown');
  pop.replaceChildren(h("span", { class: "label" }, "Yeni oylama · onay / ret"), q,
    h("div", { class: "actions" },
      h("button", { class: "btn primary sm", type: "button", onclick: startPoll }, "Oylamayi baslat"),
      h("button", { class: "btn ghost sm", type: "button", onclick: () => togglePollForm(false) }, "Vazgec")),
    h("p", { class: "err", id: "poll-err" }));
}
async function startPoll() {
  const q = S.pollDraft.q.trim();
  if (!q) { $("poll-err").textContent = "Oylamanin konusunu yaz."; return; }
  if (await write(() => S.db.collection("chat").add({ a: S.meId, t: "", at: Date.now(), poll: { q: q.slice(0, 200), opts: ["✓ Onayliyorum", "✕ Reddediyorum"], yn: true, closed: false }, pv: {} }), $("poll-err"))) {
    S.pollDraft = null; togglePollForm(false); setSafeTimeout(() => renderChat(true), 0);
  }
}
function pollEl(m) {
  const p = m.poll, pv = m.pv || {}, closed = !!p.closed;
  const votes = Object.entries(pv).filter(([, v]) => typeof v === "number");
  const total = votes.length, mine = typeof pv[S.meId] === "number" ? pv[S.meId] : null;
  const counts = (p.opts || []).map((_, i) => votes.filter(([, v]) => v === i).length), top = Math.max(0, ...counts);
  return h("div", { class: "poll" + (closed ? " closed" : "") },
    h("div", { class: "pq" }, "📊 ", p.q),
    (p.opts || []).map((o, i) => {
      const voters = votes.filter(([, v]) => v === i).map(([id]) => id), pct = total ? Math.round(voters.length * 100 / total) : 0;
      return h("button", { class: "popt" + (mine === i ? " on" : "") + (closed && total && counts[i] === top ? " win" : ""), type: "button",
        disabled: closed || !S.canWrite || !S.meId, style: "--p:" + pct + "%" + (p.yn ? ";--uc:var(--k-" + (i === 0 ? "gorev" : "hata") + ")" : ""),
        onclick: () => votePoll(m, mine === i ? null : i) },
        h("span", { class: "pl" }, (mine === i && !p.yn ? "✓ " : "") + o + (mine === i && p.yn ? "  (senin oyun)" : "")), h("span", { class: "pc" }, voters.length + " oy · %" + pct),
        voters.length ? h("span", { class: "pav" }, voters.map(id => h("span", { title: who(id) }, avatar(id, "sm")))) : null);
    }),
    h("div", { class: "pf" }, total + " kisi oy verdi" + (closed ? " · oylama kapandi" : mine === null ? " · oy vermek icin bir secenege bas" : " · degistirmek icin baska secenege bas"),
      m.a === S.meId && !closed ? h("button", { class: "mdel", type: "button", style: "opacity:1", onclick: () => write(() => S.db.doc("chat/" + m.id).update({ poll: { closed: true } })) }, "oylamayi kapat") : null));
}
async function votePoll(m, i) {
  if (!S.meId || (m.poll && m.poll.closed)) return;
  await write(() => S.db.doc("chat/" + m.id).update({ pv: { [S.meId]: i } }));
}
addSafeListener($("poll-btn"), "click", () => { toggleEmoji(false); togglePollForm(); }, {}, 'poll-btn-click');
/* composedPath keeps the click's ancestors even when a re-render has already removed the clicked button */
const clickedIn = (e, ...ids) => e.composedPath().some(el => el && ids.includes(el.id));
addSafeListener(document, "click", e => { if (!clickedIn(e, "poll-pop", "poll-btn")) { const pp = $("poll-pop"); if (!pp.hidden) togglePollForm(false); } }, {}, 'poll-close-outside');
addSafeListener(document, "click", e => { if (!e.composedPath().some(el => el && (el.id === "emoji-pop" || el.id === "emoji-btn"))) toggleEmoji(false); }, {}, 'emoji-close-outside');
addSafeListener(document, "keydown", e => { if (e.key === "Escape" && !$("emoji-pop").hidden) toggleEmoji(false); }, {}, 'emoji-close-escape');
addSafeListener($("f-chat"), "submit", e => { e.preventDefault(); sendChat(); }, {}, 'f-chat-submit');
addSafeListener($("chat-in"), "keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
}, {}, 'chat-in-keydown-enter');
addSafeListener(document, "visibilitychange", () => { if (!document.hidden && S.view === "chat") markChatSeen(); }, {}, 'chat-visibilitychange');

/* ---------- game progress + release notes ---------- */
const UPD_TYPES = { ozellik: ["Yeni ozellik", "gorev"], duzeltme: ["Hata duzeltme", "hata"], icerik: ["Icerik / hikâye", "hikaye"], denge: ["Denge / ayar", "mekanik"], gorsel: ["Gorsel / ses", "sanat"], diger: ["Diger", "fikir"] };
const PHASES = { fikir: "Fikir asamasi", prototip: "Prototip", alfa: "Alfa", beta: "Beta", yayin: "Yayinda" };
const PHASE_ORDER = Object.keys(PHASES);
S.updates = []; S.updPrev = null; S.updSeen = Number(ls.get("atolye-upd-seen")) || 0;
function markUpdSeen() { S.updSeen = Date.now(); ls.set("atolye-upd-seen", String(S.updSeen)); }
function startUpdates() {
  if (S.updUnsub || !S.db) return;
  S.updUnsub = S.db.collection("updates").orderBy("at", "desc").limit(200).onSnapshot(snap => {
    const prev = S.updPrev;
    S.updates = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(u => typeof u.at === "number");
    const fresh = prev ? S.updates.filter(u => !prev.has(u.id) && u.a !== S.meId && u.at > S.liveSince) : [];
    S.updPrev = new Set(S.updates.map(u => u.id));
    if (S.view === "upd" && !document.hidden) markUpdSeen();
    if (fresh.length) {
      playSound("new");
      render().then(() => notify({ upd: true, by: fresh[0].a, text: "guncelleme yayinladi", title: (fresh[0].ver ? fresh[0].ver + " · " : "") + fresh[0].title }));
    } else render();
  }, () => {});
  startBuilds();
}
/* ---------- game files: version history (newest = guncel, older ones stay) ---------- */
S.builds = []; S.buildPrev = null; S.buildDel = null; S.buildUploading = false;
const BUILD_MAX = 20 * 1024 * 1024, BUILD_FILES = 5;
function startBuilds() {
  if (S.buildUnsub || !S.db) return;
  S.buildUnsub = S.db.collection("builds").orderBy("at", "desc").limit(200).onSnapshot(snap => {
    const prev = S.buildPrev;
    S.builds = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(b => typeof b.at === "number");
    const fresh = prev ? S.builds.filter(b => !prev.has(b.id) && b.a !== S.meId && b.at > S.liveSince) : [];
    S.buildPrev = new Set(S.builds.map(b => b.id));
    if (fresh.length) {
      playSound("new");
      render().then(() => notify({ upd: true, by: fresh[0].a, text: "oyunun yeni surumunu yukledi", title: fresh[0].ver + (fresh[0].note ? " · " + fresh[0].note : "") }));
    } else render();
  }, () => {});
}
function renderBuilds() {
  const list = $("build-list"); if (!list || !S.builds) return;
  $("bd-file").disabled = !S.assets;
  $("bd-submit").disabled = S.buildUploading;
  $("bd-submit").textContent = S.buildUploading ? "Yukleniyor…" : "Surumu yukle";
  list.replaceChildren();
  if (!S.builds.length) list.append(h("div", { class: "empty" }, h("strong", {}, "Henuz oyun dosyasi yok"),
    "Soldan oyunun guncel surumunu yukle. Her yeni yukleme en uste \"guncel\" olarak gelir, eskiler asagida saklanir."));
  S.builds.forEach((b, i) => {
    const mine = b.a === S.meId && S.canWrite;
    const files = Array.isArray(b.files) ? b.files : [];
    const link = typeof b.link === "string" && /^https?:\/\//i.test(b.link) ? b.link : null;
    list.append(h("article", { class: "airun" + (i ? " old" : ""), style: "--uc:" + ucol(b.a) },
      h("div", { class: "airh" }, h("span", { class: "uver" }, b.ver || "surum"), i ? h("span", { class: "bold" }, "eski") : h("span", { class: "bcur" }, "guncel"),
        h("span", { class: "mt", style: "margin-left:auto" }, new Date(b.at).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }))),
      b.note ? h("div", { class: "aians" }, b.note) : null,
      files.length || link ? h("div", { class: "mfiles", style: "width:100%" },
        files.map(fl => h("a", { class: "mfile", href: imgUrl(fl.id), target: "_blank", rel: "noopener", download: fl.name || "dosya", title: "Indir" },
          h("span", { class: "fx" }, String(fl.name || "").split(".").pop().slice(0, 4) || "dosya"),
          h("span", { class: "fn" }, fl.name || "dosya"), h("span", { class: "fs" }, fmtSize(fl.size || 0)))),
        link ? h("a", { class: "mfile", href: link, target: "_blank", rel: "noopener noreferrer", title: "Baglantiyi ac" },
          h("span", { class: "fx" }, "link"), h("span", { class: "fn" }, link.replace(/^https?:\/\//i, "")), h("span", { class: "fs" }, "dis baglanti")) : null) : null,
      h("div", { class: "airh" }, avatar(b.a, "sm"), nameEl(b.a), h("span", { class: "mt" }, " · " + ago(b.at)),
        mine && S.buildDel !== b.id ? h("span", { class: "own", style: "margin-left:auto" },
          h("button", { type: "button", class: "del", onclick: () => { S.buildDel = b.id; renderBuilds(); } }, "sil")) : null),
      mine && S.buildDel === b.id ? h("div", { class: "confirm" }, h("span", {}, "Bu surum ve dosyalari silinsin mi?"),
        h("button", { class: "btn danger sm", type: "button", onclick: async () => {
          const cur = S.builds.find(x => x.id === b.id); if (!cur || cur.a !== S.meId) return;
          if (await write(() => S.db.doc("builds/" + b.id).delete())) {
            S.buildDel = null; toast("Surum silindi");
            if (S.assets) for (const fl of files) S.assets.delete(fl.id).catch(() => {});
          }
        } }, "Evet, sil"),
        h("button", { class: "btn ghost sm", type: "button", onclick: () => { S.buildDel = null; renderBuilds(); } }, "Vazgec")) : null));
  });
}
addSafeListener($("f-build"), "submit", async e => {
  e.preventDefault();
  if (!S.meId || S.buildUploading) return;
  const err = $("bd-err"); err.textContent = "";
  const ver = $("bd-ver").value.trim().slice(0, 20), note = $("bd-note").value.trim().slice(0, 200);
  const link = $("bd-link").value.trim().slice(0, 500), picked = [...$("bd-file").files];
  if (!ver) { err.textContent = "Surum adini yaz (or. v0.4)."; return; }
  if (!picked.length && !link) { err.textContent = "Bir dosya sec ya da baglanti ekle."; return; }
  if (link && !/^https?:\/\//i.test(link)) { err.textContent = "Baglanti http:// veya https:// ile baslamali."; return; }
  if (picked.length && !S.assets) { err.textContent = "Dosya yuklemek icin sayfanin sahibi seni Duzenleyici yapmali. Simdilik baglanti ekleyebilirsin."; return; }
  if (picked.length > BUILD_FILES) { err.textContent = "Bir surume en fazla " + BUILD_FILES + " dosya eklenebilir."; return; }
  for (const f of picked) {
    const type = IMG_TYPES.includes(f.type) ? f.type : fileType(f);
    if (!type) { err.textContent = (f.name || "Dosya") + ": bu tur yuklenemiyor. Zip/exe gibi paketleri Drive veya itch.io'ya yukleyip baglantisini ekle. Desteklenen: gorsel, PDF, MP4/WEBM, TXT, MD, CSV, JSON."; return; }
    if (f.size > BUILD_MAX) { err.textContent = (f.name || "Dosya") + " cok buyuk (" + fmtSize(f.size) + "). Dosya basina en fazla 20 MB yuklenebilir; buyuk dosyalar icin baglanti ekle."; return; }
  }
  S.buildUploading = true; renderBuilds();
  const files = [];
  try {
    for (const f of picked) {
      const type = IMG_TYPES.includes(f.type) ? f.type : fileType(f);
      const r = await S.assets.upload(f, { type });
      files.push({ id: r.id, name: String(f.name || "dosya").slice(0, 120), type, size: f.size });
    }
  } catch (x) {
    const c = (x && x.code) || "";
    err.textContent = c === "unsupported_type" ? "Bu dosya turu yuklenemiyor. Zip/exe gibi paketler icin baglanti ekle."
      : c === "quota_or_state" ? "Dosya alani dolu. Eski surumlerden birini silip tekrar dene."
      : assetErr(x).replace("Gorsel yuklenemedi", "Dosya yuklenemedi").replace("gorsel yukleyemiyorsun", "dosya yukleyemiyorsun");
    for (const fl of files) S.assets.delete(fl.id).catch(() => {});
    S.buildUploading = false; renderBuilds(); return;
  }
  const doc = { a: S.meId, at: Date.now(), ver, note, files, link: link || "" };
  const ok = await write(() => S.db.collection("builds").add(doc), err);
  S.buildUploading = false;
  if (ok) {
    $("bd-ver").value = ""; $("bd-note").value = ""; $("bd-link").value = ""; $("bd-file").value = "";
    toast(ver + " guncel surum olarak yuklendi, ekibe bildirim gitti");
  } else for (const fl of files) S.assets.delete(fl.id).catch(() => {});
  renderBuilds();
});
function renderUpd() {
  const list = $("upd-list"); if (!list) return;
  renderBuilds();
  const unread = S.updates.filter(u => u.a !== S.meId && u.at > S.updSeen).length;
  $("n-upd").hidden = !unread || S.view === "upd"; $("n-upd").textContent = unread;
  const p = (S.settings && S.settings.progress) || {};
  const pct = Math.max(0, Math.min(100, Number(p.pct) || 0));
  $("upd-bar").style.width = pct + "%";
  if (document.activeElement !== $("upd-pct")) { $("upd-pct").value = pct; $("upd-pctv").textContent = "%" + pct; }
  if (document.activeElement !== $("upd-phase")) $("upd-phase").value = p.phase || "fikir";
  const curI = PHASE_ORDER.indexOf(PHASES[p.phase] ? p.phase : "fikir");
  for (const o of $("upd-phase").options) { const i = PHASE_ORDER.indexOf(o.value); o.disabled = i > curI + 1 || (i === curI + 1 && pct < 100); }
  $("upd-pmeta").textContent = p.at ? (PHASES[p.phase] || "Fikir asamasi") + " · %" + pct + " · son guncelleyen " + who(p.by) + ", " + ago(p.at) : "Henuz durum girilmedi. Asamayi ve yuzdeyi sec, herkes gorsun.";
  list.replaceChildren();
  if (!S.updates.length) list.append(h("div", { class: "empty" }, h("strong", {}, "Henuz guncelleme notu yok"),
    "Oyunda bir sey degistiginde soldan not ekle: surum, ne eklendi, ne duzeltildi. Ekip buradan takip eder."));
  for (const u of S.updates) {
    const t = UPD_TYPES[u.type] || UPD_TYPES.diger;
    const mine = u.a === S.meId && S.canWrite;
    let del = null;
    if (mine && !(S.updEdit && S.updEdit.id === u.id) && S.updDel !== u.id) {
      del = h("span", { class: "own", style: "margin-left:auto" },
        h("button", { type: "button", onclick: () => { S.updEdit = { id: u.id, ver: u.ver || "", title: u.title || "", body: u.body || "" }; S.updDel = null; renderUpd(); if ($("ue-title")) $("ue-title").focus(); } }, "duzenle"),
        h("button", { type: "button", class: "del", onclick: () => { S.updDel = u.id; S.updEdit = null; renderUpd(); } }, "sil"));
    }
    if (mine && S.updEdit && S.updEdit.id === u.id) { list.append(updEditForm(u)); continue; }
    list.append(h("article", { class: "airun", style: "--uc:" + ucol(u.a) },
      h("div", { class: "airh" }, u.ver ? h("span", { class: "uver" }, u.ver) : null, h("span", { class: "tag", style: kindVars(t[1]) }, t[0]),
        typeof u.pct === "number" ? h("span", { class: "mt" }, "oyun %" + u.pct) : null,
        h("span", { class: "mt", style: "margin-left:auto" }, new Date(u.at).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }))),
      h("h3", { class: "utitle" }, u.title),
      u.body ? h("div", { class: "aians" }, mdLite(u.body)) : null,
      h("div", { class: "airh" }, avatar(u.a, "sm"), nameEl(u.a), h("span", { class: "mt" }, " · " + ago(u.at) + (u.ed ? " · duzenlendi" : "")), del),
      mine && S.updDel === u.id ? h("div", { class: "confirm" }, h("span", {}, "Bu guncelleme notu silinsin mi?"),
        h("button", { class: "btn danger sm", type: "button", onclick: async () => {
          const cur = S.updates.find(x => x.id === u.id); if (!cur || cur.a !== S.meId) return;
          if (await write(() => S.db.doc("updates/" + u.id).delete())) { S.updDel = null; toast("Guncelleme notu silindi"); }
        } }, "Evet, sil"),
        h("button", { class: "btn ghost sm", type: "button", onclick: () => { S.updDel = null; renderUpd(); } }, "Vazgec")) : null));
  }
}
function updEditForm(u) {
  const e = S.updEdit, foc = document.activeElement && document.activeElement.id;
  const verIn = h("input", { class: "field", id: "ue-ver", value: e.ver, maxlength: "20", placeholder: "Surum (orn. v0.3)", "aria-label": "Surum" });
  const titleIn = h("input", { class: "field", id: "ue-title", value: e.title, maxlength: "120", placeholder: "Baslik", "aria-label": "Baslik" });
  const bodyIn = h("textarea", { class: "field", id: "ue-body", rows: "5", placeholder: "Ne degisti?", "aria-label": "Aciklama" });
  bodyIn.value = e.body;
  addSafeListener(verIn, "input", () => { e.ver = verIn.value; }, {}, 'upd-edit-ver-input');
  addSafeListener(titleIn, "input", () => { e.title = titleIn.value; }, {}, 'upd-edit-title-input');
  addSafeListener(bodyIn, "input", () => { e.body = bodyIn.value; }, {}, 'upd-edit-body-input');
  const err = h("p", { class: "err" });
  const save = async () => {
    const title = e.title.trim(); if (!title) { err.textContent = "Baslik bos olamaz."; return; }
    const cur = S.updates.find(x => x.id === u.id); if (!cur || cur.a !== S.meId) { S.updEdit = null; renderUpd(); return; }
    if (await write(() => S.db.doc("updates/" + u.id).update({ ver: e.ver.trim(), title, body: e.body.trim(), ed: Date.now() }), err)) { S.updEdit = null; renderUpd(); toast("Guncelleme notu duzenlendi"); }
  };
  const box = h("article", { class: "airun", style: "--uc:" + ucol(u.a) + ";display:grid;gap:8px" },
    h("div", { class: "airh" }, h("strong", {}, "Guncelleme notunu duzenle")),
    verIn, titleIn, bodyIn, err,
    h("div", { class: "actions" },
      h("button", { class: "btn primary sm", type: "button", onclick: save }, "Kaydet"),
      h("button", { class: "btn ghost sm", type: "button", onclick: () => { S.updEdit = null; renderUpd(); } }, "Vazgec")));
  if (foc && /^ue-/.test(foc)) setSafeTimeout(() => { const el = $(foc); if (el) el.focus(); }, 0);
  return box;
}
async function saveProgress(patch) {
  if (await write(() => S.db.doc("team/settings").update({ progress: Object.assign({ at: Date.now(), by: S.meId }, patch) }))) toast("Oyunun durumu guncellendi");
}
addSafeListener($("upd-pct"), "input", e => { $("upd-pctv").textContent = "%" + e.target.value; $("upd-bar").style.width = e.target.value + "%"; }, {}, 'upd-pct-input');
addSafeListener($("upd-pct"), "change", e => saveProgress({ pct: Number(e.target.value) }), {}, 'upd-pct-change');
addSafeListener($("upd-phase"), "change", e => {
  const p = (S.settings && S.settings.progress) || {};
  const cur = PHASES[p.phase] ? p.phase : "fikir", pct = Number(p.pct) || 0;
  const from = PHASE_ORDER.indexOf(cur), to = PHASE_ORDER.indexOf(e.target.value);
  if (to > from + 1) { e.target.value = cur; toast("Asamalar sirayla gecilir, aradaki asamayi atlayamazsin."); return; }
  if (to === from + 1 && pct < 100) { e.target.value = cur; toast("Bu asama henuz %" + pct + ". Once %100 tamamla, sonra sonraki asamaya gecebilirsin."); return; }
  saveProgress(to === from + 1 ? { phase: e.target.value, pct: 0 } : { phase: e.target.value });
});
addSafeListener($("f-upd"), "submit", async e => {
  e.preventDefault();
  const title = $("upd-title").value.trim(); if (!title || !S.meId) return;
  const p = (S.settings && S.settings.progress) || {};
  const doc = { a: S.meId, at: Date.now(), ver: $("upd-ver").value.trim().slice(0, 20), type: $("upd-type").value, title: title.slice(0, 120),
    body: $("upd-body").value.trim().slice(0, 8000), pct: Math.max(0, Math.min(100, Number(p.pct) || 0)) };
  if (await write(() => S.db.collection("updates").add(doc), $("upd-err"))) {
    $("upd-title").value = ""; $("upd-body").value = ""; toast("Guncelleme yayinlandi, ekibe bildirim gitti");
  }
});

/* ---------- settings ---------- */
function updateInviteCode() {
  const invLinkEl = $("inv-link-value");
  if (invLinkEl && S.settings && S.settings.inviteToken) {
    invLinkEl.textContent = S.settings.inviteToken;
  } else if (invLinkEl) {
    invLinkEl.textContent = "(henüz davet kodu yok)";
  }
}

addSafeListener($("btn-settings"), "click", () => {
  const pop = $("pop-settings"); pop.hidden = !pop.hidden;
  $("btn-settings").setAttribute("aria-expanded", String(!pop.hidden));
  if (!pop.hidden) {
    // Populate project URL in invite link field
    updateInviteCode();
  }
}, {}, 'btn-settings-click');
addSafeListener(document, "click", e => {
  if (!e.target.closest(".menu")) { $("pop-settings").hidden = true; $("btn-settings").setAttribute("aria-expanded", "false"); }
}, {}, 'settings-close-outside');
addSafeListener($("f-game"), "submit", async e => {
  e.preventDefault();
  if (await write(() => S.db.doc("team/settings").update({ game: $("st-game").value.trim() }))) toast("Oyun adi kaydedildi");
}, {}, 'f-game-submit');

/* invite code copy button - copy just the invite code */
addSafeListener($("btn-copy-invite"), "click", () => {
  if (!S.settings || !S.settings.inviteToken) {
    toast("Henüz davet kodu yok");
    return;
  }
  navigator.clipboard.writeText(S.settings.inviteToken).then(() => toast("Davet kodu kopyalandi")).catch(() => toast("Kopyalanamadi"));
}, {}, 'btn-copy-invite-click');

/* generate new invite link button */
addSafeListener($("btn-generate-invite"), "click", async () => {
  if (!S.settings || !S.meId) return;
  const newToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  if (await write(() => S.db.doc("team/settings").update({ inviteToken: newToken }))) {
    updateInviteCode();
    toast("Yeni davet kodu olusturuldu");
  }
}, {}, 'btn-generate-invite-click');

/* apply invite code from input */
addSafeListener($("btn-apply-invite"), "click", () => {
  const input = $("invite-code-input");
  if (!input) return;
  const code = input.value.trim();
  if (!code) {
    toast("Davet kodu girin");
    return;
  }
  // Navigate to URL with invite parameter
  const link = location.origin + location.pathname + "?invite=" + encodeURIComponent(code);
  window.location.href = link;
}, {}, 'btn-apply-invite-click');

addSafeListener($("btn-logout"), "click", () => {
  ls.del(LS_USERNAME);
  S.meId = null;
  S.username = null;
  S.canWrite = false;
  S.welcomeShown = false;
  route();
}, {}, 'btn-logout-click');

addSafeListener($("btn-publish"), "click", () => {
  alert("Yerel build'i guncellemek icin:\n1. 'dist/index.html' dosyasini olustur: 'node build.js'\n2. Yerel sunucuda test et: 'npx serve dist -p 55450'\n3. GitHub Pages'e deploy: 'git push origin main'");
}, {}, 'btn-publish-click');

// Kullanici Listesi butonu - event delegation ile (buton DOM'da olmasa bile calisir)
// Bu sayede buton DOM'a eklendiginde (giris yapildiginda panel gorundugunde) otomatik calisir
addSafeListener(document, "click", e => {
  if (e.target.closest("#btn-user-list")) showUserListModal();
}, {}, 'btn-user-list-delegate');

function showUserListModal() {
  // Mevcut kullanicilari topla
  const users = [];

  // Mevcut kullanici
  if (S.meId) {
    users.push({
      id: S.meId,
      name: S.username || "Sen",
      isCurrent: true
    });
  }

  // Diger kullanicilar (profiles'den)
  for (const [id, profile] of Object.entries(S.profiles)) {
    if (id !== S.meId) {
      users.push({
        id,
        name: profile.name || "Arkadasin",
        isCurrent: false
      });
    }
  }

  // LocalStorage'dan bilinen kullanicilari da ekle (profiles'de olmayabilir)
  const storedUsername = ls.get(LS_USERNAME);
  const storedMeId = ls.get("atolye-meid");

  // Modal olustur
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Kullanici Listesi</h3>
        <button class="modal-close" aria-label="Kapat">×</button>
      </div>
      <div class="modal-body">
        ${users.length === 0
          ? '<p class="empty">Henuz kullanici yok.</p>'
          : users.map(u => `
            <div class="user-item" data-id="${u.id}">
              <span class="user-name">${escapeHtml(u.name)}${u.isCurrent ? ' (Sen)' : ''}</span>
              ${!u.isCurrent ? `<button class="btn danger btn-sm user-remove" data-id="${u.id}" title="Kullaniciyi cikar">Cikar</button>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Kapatma olaylari
  addSafeListener(modal.querySelector(".modal-close"), "click", () => modal.remove(), {}, 'modal-close-btn');
  addSafeListener(modal, "click", (e) => { if (e.target === modal) modal.remove(); }, {}, 'modal-close-overlay');

  // Cikarma butonlari
  modal.querySelectorAll(".user-remove").forEach(btn => {
    addSafeListener(btn, "click", async (e) => {
      const userId = e.target.dataset.id;
      if (confirm("Bu kullaniciyi cikarmak istediginizden emin misiniz?")) {
        await removeUser(userId);
        modal.remove();
        showUserListModal(); // Listeyi yenile
      }
    }, {}, 'user-remove-' + btn.dataset.id);
  });

  // ESC tusu ile kapatma
  const handleEsc = (e) => {
    if (e.key === "Escape") {
      modal.remove();
      clearListeners('user-list-esc');
    }
  };
  addSafeListener(document, "keydown", handleEsc, {}, 'user-list-esc');
}

async function removeUser(userId) {
  try {
    // LocalStorage'dan sil
    if (S.meId === userId) {
      ls.del(LS_USERNAME);
      ls.del("atolye-meid");
      S.meId = null;
      S.username = null;
      S.canWrite = false;
    }

    // Profiles'den sil
    delete S.profiles[userId];

    // Firestore'dan sil
    await S.db.doc("users/" + userId).delete().catch(() => {});

    // Pings tablosundan da sil
    await S.db.doc("pings/" + userId).delete().catch(() => {});

    toast("Kullanici cikarildi");
  } catch (e) {
    error("Kullanici cikarma hatasi:", e);
    toast("Kullanici cikarilamadi: " + e.message);
  }
}

/* ---------- images ---------- */
const IMG_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const VID_TYPES = ["video/mp4", "video/webm"];
const imgUrl = id => "/_blob/" + id;
S.newImages = []; S.newVideos = []; S.uploading = 0;
function mediaOk(n, m) {
  const im = (n.images || []).length, vd = (n.videos || []).length;
  return m === "all" || (m === "text" && !im && !vd) || (m === "image" && im > 0) || (m === "video" && vd > 0);
}
function cardMedia(n) {
  const im = n.images || [], vd = n.videos || [];
  if (!im.length && !vd.length) return null;
  const label = [im.length && im.length + " gorsel", vd.length && vd.length + " video"].filter(Boolean).join(" · ");
  const el = im.length ? h("img", { src: imgUrl(im[0]), alt: "", loading: "lazy" })
    : h("video", { src: imgUrl(vd[0]), controls: true, preload: "metadata", playsinline: true, onclick: e => e.stopPropagation() });
  return h("div", { class: "card-img" + (im.length ? "" : " vid"), onclick: im.length ? null : e => e.stopPropagation() }, el, h("span", { class: "imgn" }, label));
}
function assetErr(e) {
  const c = (e && e.code) || "bilinmiyor";
  if (c === "too_large") return "Dosya 20 MB'tan buyuk.";
  if (c === "unsupported_type") return "Sadece PNG, JPG, GIF, WEBP gorseller ve MP4, WEBM videolar yuklenebilir.";
  if (c === "quota_or_state") return "Gorsel alani dolu. Eski gorselleri kaldirip tekrar dene.";
  if (c === "rate_limited") return "Cok hizli yukleniyor. Biraz bekleyip tekrar dene.";
  if (c === "not_granted" || c === "capability_disabled") return "Bu hesapla gorsel yukleyemiyorsun. Sahibi seni Duzenleyici yapmali.";
  return "Gorsel yuklenemedi (" + c + ").";
}
async function uploadMedia(files, errEl) {
  const out = { images: [], videos: [] };
  if (!S.assets) { errEl.textContent = "Gorsel ve video yukleme sadece Duzenleyicilere acik."; return out; }
  for (const f of files) {
    const isImg = IMG_TYPES.includes(f.type), isVid = VID_TYPES.includes(f.type);
    if (!isImg && !isVid) { errEl.textContent = (f.name || "Dosya") + ": sadece PNG, JPG, GIF, WEBP gorseller ve MP4, WEBM videolar yuklenebilir."; continue; }
    if (f.size > 20 * 1024 * 1024) { errEl.textContent = (f.name || "Dosya") + " 20 MB'tan buyuk."; continue; }
    try { const id = (await S.assets.upload(f, { type: f.type })).id; (isImg ? out.images : out.videos).push(id); }
    catch (e) { errEl.textContent = assetErr(e); }
  }
  return out;
}
function lightbox(id) {
  const lb = h("div", { class: "lightbox", role: "dialog", "aria-label": "Gorsel", onclick: () => lb.remove() }, h("img", { src: imgUrl(id), alt: "" }));
  document.body.append(lb);
}
function renderNewThumbs() {
  const box = $("nw-thumbs"); box.replaceChildren();
  for (const id of S.newImages) box.append(h("div", { class: "thumb" }, h("img", { src: imgUrl(id), alt: "" }),
    h("button", { type: "button", "aria-label": "Gorseli cikar", onclick: () => {
      S.newImages = S.newImages.filter(x => x !== id); renderNewThumbs();
      if (S.assets) S.assets.delete(id).catch(() => {});
    } }, "×")));
  for (const id of S.newVideos) box.append(h("div", { class: "thumb" }, h("video", { src: imgUrl(id) + "#t=0.1", muted: true, preload: "metadata" }),
    h("button", { type: "button", "aria-label": "Videoyu cikar", onclick: () => {
      S.newVideos = S.newVideos.filter(x => x !== id); renderNewThumbs();
      if (S.assets) S.assets.delete(id).catch(() => {});
    } }, "×")));
  for (let i = 0; i < S.uploading; i++) box.append(h("div", { class: "thumb loading" }, "yukleniyor"));
  $("nw-submit").disabled = S.uploading > 0;
}
async function addNewImages(files) {
  files = [...files].filter(f => f.type.startsWith("image/") || f.type.startsWith("video/"));
  if (!files.length) return;
  $("nw-err").textContent = "";
  S.uploading += files.length; renderNewThumbs();
  const got = await uploadMedia(files, $("nw-err"));
  S.uploading -= files.length; S.newImages.push(...got.images); S.newVideos.push(...got.videos); renderNewThumbs();
}
addSafeListener($("nw-file"), "change", e => { const fs = [...e.target.files]; e.target.value = ""; addNewImages(fs); }, {}, 'nw-file-change');
addSafeListener($("f-new"), "paste", e => {
  const fs = [...((e.clipboardData && e.clipboardData.files) || [])];
  if (fs.length) { e.preventDefault(); addNewImages(fs); }
}, {}, 'f-new-paste');
addSafeListener($("f-new"), "dragover", e => { e.preventDefault(); $("f-new").classList.add("drag"); }, {}, 'f-new-dragover');
addSafeListener($("f-new"), "dragleave", () => $("f-new").classList.remove("drag"), {}, 'f-new-dragleave');
addSafeListener($("f-new"), "drop", e => { e.preventDefault(); $("f-new").classList.remove("drag"); addNewImages(e.dataTransfer.files); }, {}, 'f-new-drop');

/* ---------- new note ---------- */
function renderNewKinds() {
  const box = $("nw-kinds"); box.replaceChildren();
  for (const [k, n] of KINDS) box.append(h("button", {
    type: "button", class: "chip k", style: kindVars(k), "aria-pressed": String(S.newKind === k),
    onclick: () => { S.newKind = k; renderNewKinds(); }
  }, h("span", { class: "dot", style: `background:var(--k-${k})` }), n));
}
addSafeListener($("f-new"), "submit", async e => {
  e.preventDefault();
  const title = $("nw-title").value.trim(); if (!title) return;
  const now = Date.now(), btn = $("nw-submit");
  btn.disabled = true;
  const ok = await write(() => S.db.collection("notes").add({
    title, body: $("nw-body").value.trim(), kind: S.newKind, status: "acik",
    author: S.meId, createdAt: now, updatedAt: now, updatedBy: S.meId, replies: [], images: S.newImages.slice(), videos: S.newVideos.slice()
  }), $("nw-err"));
  btn.disabled = false;
  if (ok) { $("nw-title").value = ""; $("nw-body").value = ""; S.newImages = []; S.newVideos = []; renderNewThumbs(); toast("Not eklendi"); }
});

/* ---------- filters ---------- */
/* starred open notes live in their own tab and leave the work desk; starred finished notes stay in Bitenler */
function inView(n) { return S.view === "done" ? n.status === "bitti" : n.status !== "bitti" && (S.view === "star") === !!n.starred; }
function setView(v) {
  if (v !== "chat") S.unreadFrom = null;
  S.view = v; S.f.status = "all";
  const chat = v === "chat", upd = v === "upd", wide = chat || upd;
  $("wrap").classList.toggle("chatmode", wide);
  $("chat").hidden = !chat; $("upd").hidden = !upd; $("cards").hidden = wide; $("mainbar").hidden = wide;
  if (upd) { markUpdSeen(); renderUpd(); }
  renderFilters(); renderCards();
  if (chat) { renderChat(true); markChatSeen(); setSafeTimeout(() => $("chat-in").focus(), 0); }
}
addSafeListener($("tab-active"), "click", () => setView("active"), {}, 'tab-active-click');
addSafeListener($("tab-star"), "click", () => setView("star"), {}, 'tab-star-click');
addSafeListener($("tab-done"), "click", () => setView("done"), {}, 'tab-done-click');
addSafeListener($("tab-chat"), "click", () => setView("chat"), {}, 'tab-chat-click');
addSafeListener($("tab-upd"), "click", () => setView("upd"), {}, 'tab-upd-click');
addSafeListener($("q"), "input", e => { S.f.q = e.target.value.trim().toLocaleLowerCase("tr"); renderCards(); }, {}, 'q-input');
function seg(boxId, opts, key) {
  const box = $(boxId); box.replaceChildren();
  for (const [v, n] of opts) box.append(h("button", {
    type: "button", "aria-pressed": String(S.f[key] === v),
    onclick: () => { S.f[key] = v; renderFilters(); renderCards(); }
  }, n));
}
function renderFilters() {
  seg("flt-who", [["all", "Hepsi"], ["me", "Benim"], ["them", "Arkadasin"]], "who");
  const inDone = S.view === "done";
  $("lbl-status").hidden = $("flt-status").hidden = inDone;
  if (!inDone) {
    seg("flt-status", [["all", "Hepsi"]].concat(STATUS.filter(s => s[0] !== "bitti"), [["working", "Ilgilenilen"]]), "status");
    $("flt-status").style.gridTemplateColumns = "repeat(2, 1fr)";
  }
  seg("flt-media", [["all", "Hepsi"], ["text", "Metin"], ["image", "Gorsel"], ["video", "Video"]], "media");
  const box = $("flt-kinds"); box.replaceChildren();
  const count = k => S.notes.filter(n => inView(n) && (k === "all" || n.kind === k)).length;
  for (const [k, n] of [["all", "Hepsi"]].concat(KINDS)) box.append(h("button", {
    type: "button", class: k === "all" ? "chip" : "chip k", style: k !== "all" && kindVars(k), "aria-pressed": String(S.f.kind === k),
    onclick: () => { S.f.kind = k; renderFilters(); renderCards(); }
  }, k !== "all" && h("span", { class: "dot", style: `background:var(--k-${k})` }), n, h("span", { class: "n" }, count(k))));
}

/* ---------- main render ---------- */
/* fresh = changed by someone else since my last visit, unless I opened that note since */
function isFresh(n) {
  const keep = S.prevSeen;
  if (!keep) return false;
  S.prevSeen = Math.max(keep, (S.seenNotes || {})[n.id] || 0);
  try { return isFresh0(n); } finally { S.prevSeen = keep; }
}
/* red dot: someone else shared this note after my last visit and I haven't opened it yet */
function isUnseenNew(n) {
  const since = S.prevSeen || S.liveSince;
  if (!S.meId || n.author === S.meId || !since) return false;
  return n.createdAt > since && !(S.seenNotes || {})[n.id];
}
function isFresh0(n) {
  if (!S.prevSeen) return false;
  if (n.updatedAt > S.prevSeen && n.updatedBy !== S.meId) return true;
  if (Object.entries(n.votes || {}).some(([uid, val]) => val && uid !== S.meId && val.at > S.prevSeen)) return true;
  if (workers(n).some(w => w.id !== S.meId && w.at > S.prevSeen)) return true;
  if (Object.values(n.rvotes || {}).some(m => Object.entries(m || {}).some(([uid, val]) => val && uid !== S.meId && val.at > S.prevSeen))) return true;
  return (n.replies || []).some(r => r.at > S.prevSeen && r.a !== S.meId);
}
async function render() {
  try {
    const ids = new Set();
    for (const n of S.notes) { ids.add(n.author); ids.add(n.updatedBy); for (const r of n.replies || []) ids.add(r.a); }
    if (S.meId) ids.add(S.meId);
    for (const m of S.chat || []) ids.add(m.a);
    for (const u of S.updates || []) ids.add(u.a);
    if (S.settings && S.settings.progress && S.settings.progress.by) ids.add(S.settings.progress.by);
    if (S.settings && S.settings.createdBy) ids.add(S.settings.createdBy);
    ids.delete(undefined); ids.delete(null);
    if (S.user && ids.size) S.profiles = await S.user.profiles([...ids]);
    computeColors(); S.lastIds = ids; /* watchPings(); */ renderAvList(); renderPeople(ids); renderNewKinds(); renderFilters(); renderCards(); renderEvents(); renderSheetLive(); renderChat(false); renderChatBadge(); renderUpd();
  } catch (e) {
    error("Render error:", e);
  }
}
/* online status: everyone with the page open is in the room; closing the tab leaves it */
const PRES = { on: "cevrimici", away: "arka planda", off: "cevrimdisi" };
S.online = {};
async function startPresence() {
  try {
    const room = window.claude && window.claude.use ? await window.claude.use("room") : null;
    if (!room) return voiceFallback();
    S.room = room;
    const push = () => { room.presence({ visible: !document.hidden }).catch(() => {}); if (document.hidden) markLastSeen(S.meId); };
    push();
    addSafeListener(document, "visibilitychange", push, {}, 'presence-visibilitychange');
    addSafeListener(window, "pagehide", () => markLastSeen(S.meId), {}, 'presence-pagehide');
    /* typing indicator: presence.typing is true while I type, cleared 3 s after the last key or on send */
    let typingTimer = null, typingOn = false;
    const setTyping = v => { if (v !== typingOn) { typingOn = v; room.presence({ typing: v }).catch(() => {}); } };
    addSafeListener($("chat-in"), "input", () => {
      setTyping(!!$("chat-in").value.trim());
      clearSafeTimeout(typingTimer); typingTimer = setSafeTimeout(() => setTyping(false), 3000);
    }, {}, 'chat-typing-input');
    addSafeListener($("f-chat"), "submit", () => { clearSafeTimeout(typingTimer); setTyping(false); }, {}, 'chat-typing-submit');
    addSafeListener($("chat-in"), "keydown", e => { if (e.key === "Enter" && !e.shiftKey) { clearSafeTimeout(typingTimer); setTyping(false); } }, {}, 'chat-typing-keydown');
    addSafeListener($("chat-in"), "blur", () => { clearSafeTimeout(typingTimer); setTyping(false); }, {}, 'chat-typing-blur');
    room.onPeers(ch => {
      const typing = new Set();
      for (const p of ch.peers) if (p.kind === "viewer" && p.by && p.by !== S.meId && p.presence && p.presence.typing === true) typing.add(p.by);
      S.typing = typing; renderTyping();
      for (const p of ch.left)
        if (p.kind === "viewer" && p.by && p.by !== S.meId && !ch.peers.some(q => q.by === p.by)) markLastSeen(p.by);
      const on = {};
      for (const p of ch.peers) if (p.kind === "viewer" && p.by) {
        const vis = !p.presence || p.presence.visible !== false;
        on[p.by] = on[p.by] === "on" || vis ? "on" : "away";
      }
      S.online = on;
      renderPeople(S.lastIds || new Set());
    }, () => {});
    startVoiceCall(room);
  } catch (e) {
    error("startPresence error:", e);
    voiceFallback();
  }
}
/* live voice chat: WebRTC audio between everyone who joined, signalled over room topic "voice";
   presence.voice marks who is in the call, and of each pair the lower peer label sends the offer */
// Artifact cercevesi mikrofonu engelliyor; sesli sohbet GitHub Pages'teki sayfada acilir.
function openVoicePage() {
  window.open("https://dukkanci.github.io/-oyun-atolyesi/efsane-proje/ses/#" + ((S.settings && S.settings.createdAt) || ""), "_blank");
  toast("Sesli sohbet yeni sekmede aciliyor");
}
/* room yoksa da 📞 gorunsun: dogrudan GitHub sayfasini acar */
function voiceFallback() {
  $("vcall").hidden = false;
  $("vc-join").textContent = "📞 Sesli sohbet baslat";
  addSafeListener($("vc-join"), "click", openVoicePage, {}, 'vc-join-fallback');
}
function startVoiceCall(room) {
  if (!window.RTCPeerConnection || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return voiceFallback();
  const V = { me: null, stream: null, muted: false, pcs: {}, pend: {} };
  const box = $("vcall"); box.hidden = false;
  const sig = (to, kind, extra) => room.emit("voice", Object.assign({ to, kind }, extra)).catch(() => {});
  const close = peer => {
    const pc = V.pcs[peer]; if (!pc) return;
    delete V.pcs[peer]; delete V.pend[peer];
    try { pc.close(); } catch (e) {}
    const a = document.getElementById("vc-a-" + peer); if (a) a.remove();
  };
  const makePc = peer => {
    if (V.pcs[peer]) return V.pcs[peer];
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    V.pcs[peer] = pc; V.pend[peer] = [];
    V.stream.getTracks().forEach(t => pc.addTrack(t, V.stream));
    pc.onicecandidate = e => { if (e.candidate) sig(peer, "ice", { cand: e.candidate.toJSON() }); };
    pc.ontrack = e => {
      let a = document.getElementById("vc-a-" + peer);
      if (!a) { a = document.createElement("audio"); a.id = "vc-a-" + peer; a.autoplay = true; a.hidden = true; document.body.appendChild(a); }
      a.srcObject = e.streams[0]; a.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") close(peer); };
    return pc;
  };
  const flush = async peer => {
    const pc = V.pcs[peer], q = V.pend[peer] || [];
    V.pend[peer] = [];
    for (const c of q) await pc.addIceCandidate(c).catch(() => {});
  };
  const callPeers = () => room.peers().filter(p => !p.sameTab && p.presence && p.presence.voice === true);
  const sync = () => {
    const mine = room.peers().find(p => p.sameTab); if (mine) V.me = mine.peer;
    const inCall = callPeers();
    if (V.stream && V.me) {
      for (const p of inCall) if (!V.pcs[p.peer] && V.me < p.peer) {
        const pc = makePc(p.peer);
        pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => sig(p.peer, "offer", { sdp: pc.localDescription.sdp })).catch(() => close(p.peer));
      }
      for (const peer of Object.keys(V.pcs)) if (!inCall.some(p => p.peer === peer)) close(peer);
    }
    const who$ = $("vc-who"); who$.textContent = "";
    const ids = [...new Set(inCall.filter(p => p.kind === "viewer" && p.by).map(p => p.by))];
    if (V.stream) ids.unshift(S.meId);
    if (ids.length) {
      who$.append("Sesli sohbette: ");
      ids.forEach((id, i) => {
        if (i) who$.append(", ");
        const muted = id === S.meId ? V.muted : inCall.some(p => p.by === id && p.presence.vm === true);
        who$.append(h("span", { class: muted ? "" : "talk" }, who(id) + (muted ? " 🔇" : "")));
      });
    }
    box.classList.toggle("on", !!V.stream);
    $("vc-join").textContent = V.stream ? "📴 Ayril" : ids.length ? "📞 Sesli sohbete katil" : "📞 Sesli sohbet baslat";
    $("vc-mute").hidden = !V.stream;
    $("vc-mute").textContent = V.muted ? "🔇" : "🎙️";
    $("vc-mute").classList.toggle("muted", V.muted);
  };
  room.on("voice", async m => {
    const d = m.data;
    if (m.sameTab || !V.stream || !d || d.to !== V.me || typeof d.kind !== "string") return;
    const from = m.peer;
    try {
      if (d.kind === "offer" && typeof d.sdp === "string") {
        close(from);
        const pc = makePc(from);
        await pc.setRemoteDescription({ type: "offer", sdp: d.sdp });
        await flush(from);
        await pc.setLocalDescription(await pc.createAnswer());
        sig(from, "answer", { sdp: pc.localDescription.sdp });
      } else if (d.kind === "answer" && typeof d.sdp === "string" && V.pcs[from]) {
        await V.pcs[from].setRemoteDescription({ type: "answer", sdp: d.sdp });
        await flush(from);
      } else if (d.kind === "ice" && d.cand && typeof d.cand === "object") {
        const pc = V.pcs[from];
        if (pc && pc.remoteDescription) await pc.addIceCandidate(d.cand).catch(() => {});
        else (V.pend[from] = V.pend[from] || []).push(d.cand);
      } else if (d.kind === "bye") close(from);
    } catch (e) { close(from); }
  }, () => {});
  room.onPeers(sync, () => {});
  const leave = () => {
    if (!V.stream) return;
    for (const peer of Object.keys(V.pcs)) { sig(peer, "bye"); close(peer); }
    V.stream.getTracks().forEach(t => t.stop());
    V.stream = null; V.muted = false;
    room.presence({ voice: null, vm: null }).catch(() => {});
    sync();
  };
  addSafeListener($("vc-join"), "click", async () => {
    if (V.stream) return leave();
    try {
      V.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      return openVoicePage();
    }
    V.muted = false;
    room.presence({ voice: true, vm: false }).catch(() => {});
    sync();
    toast("Sesli sohbete katildin");
  }, {}, 'vc-join-click');
  addSafeListener($("vc-mute"), "click", () => {
    if (!V.stream) return;
    V.muted = !V.muted;
    V.stream.getAudioTracks().forEach(t => (t.enabled = !V.muted));
    room.presence({ vm: V.muted }).catch(() => {});
    sync();
  }, {}, 'vc-mute-click');
  addSafeListener(window, "pagehide", leave, {}, 'voice-pagehide');
}
/* last time someone was online: written when their tab hides or closes, and by whoever sees them leave */
S.lastSeenOnline = {};
function markLastSeen(id) { if (S.db && id) S.db.doc("lastseen/" + id).set({ at: Date.now() }).catch(() => {}); }
function presLabel(id, st) {
  const at = S.lastSeenOnline[id];
  return PRES[st] + (st === "off" && at && typeof at === 'number' && !isNaN(at) ? " · son gorulme " + ago(at) : "");
}
setSafeInterval(() => { if (S.lastIds) renderPeople(S.lastIds); }, 60000);
S.typing = new Set();
function renderTyping() {
  const box = $("typing"), ids = [...S.typing];
  box.hidden = !ids.length;
  box.replaceChildren();
  if (!ids.length) return;
  ids.forEach((id, i) => { if (i) box.append(", "); box.append(nameEl(id)); });
  box.append(" yaziyor", h("span", { class: "tdots", "aria-hidden": "true" }, h("i"), h("i"), h("i")));
}
function renderOnlineLine() {
  const box = $("chat-online"); if (!box) return;
  box.replaceChildren();
  if (!S.room) return;
  for (const id of S.lastIds || []) if (id !== S.meId) {
    const st = S.online[id] || "off";
    box.append(h("span", { class: "pst2 " + st }, h("span", { class: "pdot inl " + st }), who(id) + " " + presLabel(id, st)));
  }
}
function renderPeople(ids) {
  renderOnlineLine();
  const box = $("people"); box.replaceChildren();
  for (const id of ids) {
    const st = id === S.meId ? "on" : S.room ? (S.online[id] || "off") : null;
    const chip = h("span", { class: "ppl", title: who(id) + (st ? " · " + PRES[st] : "") },
      h("span", { class: "avwrap" }, avatar(id), st ? h("span", { class: "pdot " + st }) : null), nameEl(id),
      st && id !== S.meId ? h("span", { class: "pst2 " + st }, presLabel(id, st)) : null);
    if (id !== S.meId && S.canWrite && S.meId) {
      const out = S.pingOut[id];
      let st = "";
      if (out && out.from === S.meId) {
        const seenAt = out.seenAt;
        const at = out.at;
        if (seenAt && typeof seenAt === 'number' && at && typeof at === 'number' && seenAt >= at) {
          st = "gordu ✓";
        } else if (seenAt) {
          st = "bekliyor…";
        }
      }
      chip.append(h("button", { class: "pingbtn", type: "button", title: "Durt: sesli uyari gider", onclick: () => sendPing(id) }, "Durt"),
        ...(st ? [h("span", { class: "pst" }, st)] : []));
    }
    box.append(chip);
  }
  renderTotals();
}
function renderCards() {
  const f = S.f;
  const list = S.notes.filter(n =>
    (f.kind === "all" || n.kind === f.kind) &&
    inView(n) &&
    (!f.fresh || isFresh(n)) &&
    (S.view === "done" || f.status === "all" || (f.status === "working" ? workers(n).length > 0 : n.status === f.status)) &&
    mediaOk(n, f.media) &&
    (f.who === "all" || (f.who === "me") === (n.author === S.meId)) &&
    (!f.q || ((n.title || "") + " " + (n.body || "")).toLocaleLowerCase("tr").includes(f.q))
  ).sort((a, b) => byPin(a, b) || byStar(a, b));
  const viewAll = S.notes.filter(inView);
  const doneAll = S.notes.filter(n => n.status === "bitti");
  $("count").textContent = list.length + " / " + viewAll.length + " not";
  $("fresh-clear").hidden = !f.fresh;
  const starAll = S.notes.filter(n => n.status !== "bitti" && n.starred).length;
  $("n-active").textContent = S.notes.length - doneAll.length - starAll;
  $("n-star").textContent = starAll;
  $("n-done").textContent = doneAll.length;
  $("tab-active").setAttribute("aria-selected", String(S.view === "active"));
  $("tab-star").setAttribute("aria-selected", String(S.view === "star"));
  $("tab-done").setAttribute("aria-selected", String(S.view === "done"));
  $("tab-chat").setAttribute("aria-selected", String(S.view === "chat"));
  $("tab-upd").setAttribute("aria-selected", String(S.view === "upd"));
  const sum = $("donesum"); sum.replaceChildren();
  sum.hidden = S.view !== "done" || !doneAll.length;
  if (!sum.hidden) {
    sum.append(h("span", { class: "label" }, "Bitirdikleriniz"));
    for (const [k, t] of KINDS) {
      const c = doneAll.filter(n => n.kind === k).length;
      if (c) sum.append(h("span", { class: "tag", style: kindVars(k) }, KICON[k] + " " + c + " " + t));
    }
  }
  const box = $("cards"); box.replaceChildren();
  if (S.notes.length && !viewAll.length) {
    box.append(S.view === "done"
      ? h("div", { class: "empty" }, h("strong", {}, "Henuz biten bir sey yok"), "Bir notu acip ✓ Bitti dediginizde buraya tasinir ve calisma masasindan kalkar.")
      : S.view === "star"
      ? h("div", { class: "empty" }, h("strong", {}, "Henuz yildizli gorev yok"), "Calisma masasindaki bir notun ☆ dugmesine bastiginda buraya tasinir; yildizi kaldirinca masaya geri doner.")
      : h("div", { class: "empty" }, h("strong", {}, "Masa tertemiz"), "Her sey bitmis ya da yildizli. Yildizlilari ★ Yildizlilar, bitenleri ✓ Bitenler sekmesinde bulabilir ya da yeni bir not ekleyebilirsin."));
    return;
  }
  if (!S.notes.length) {
    box.append(h("div", { class: "empty" }, h("strong", {}, "Atolye bos"),
      "Soldaki kutudan ilk notu ekle: bir oyun fikri, bir mekanik ya da yapilacak bir is. Arkadasin girdiginde hepsini gorecek."));
    return;
  }
  if (!list.length) { box.append(h("div", { class: "empty" }, h("strong", {}, "Eslesen not yok"), "Filtreleri ya da aramayi degistir.")); return; }
  for (const n of list) {
    const rc = (n.replies || []).length;
    box.append(h("div", {
      role: "button", tabindex: "0", class: "card" + (n.status === "bitti" ? " done" : "") + (n.starred ? " starred" : "") + (n.pinned ? " pinned" : ""), style: kindVars(n.kind) + ";--uc:" + ucol(n.author),
      onclick: () => openSheet(n.id),
      onkeydown: e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openSheet(n.id); } }
    },
      isUnseenNew(n) && h("span", { class: "reddot", title: "Yeni paylasildi, henuz acmadin", "aria-label": "Yeni not" }),
      isFresh(n) && h("span", { class: "newdot" }, "yeni"),
      n.pinned && h("span", { class: "pin-badge", title: "Sabitlenmis" }, "📌"),
      h("div", { class: "meta" }, h("span", { class: "tag" }, (KICON[n.kind] || "") + " " + (KIND[n.kind] || n.kind)),
        n.status !== "acik" && h("span", { class: "status " + n.status },
          n.status === "bitti" ? "✓ Bitti · " + ago(n.doneAt || n.updatedAt) : STATUS_N[n.status]), starBtn(n), pinBtn(n)),
      workBanner(n),
      h("h3", {}, n.title),
      cardMedia(n),
      n.body && h("div", { class: "body" }, n.body),
      links(n.body).length ? h("div", { class: "lnks" }, links(n.body).slice(0, 3).map(linkCard)) : null,
      n.kind === "fikir" && voteBox(n),
      h("div", { class: "meta" }, h("span", { class: "by" }, avatar(n.author, "sm"), nameEl(n.author)), h("span", {}, ago(n.createdAt)), workBtn(n), finishBtn(n)),
      rc ? h("div", { class: "card-replies" },
        rc > 3 && h("div", { class: "more" }, "+" + (rc - 3) + " onceki yanit"),
        n.replies.slice(-3).map(r => h("div", { class: "cr" }, avatar(r.a, "sm"),
          h("div", { style: "--uc:" + ucol(r.a) }, h("span", { class: "crw" }, nameEl(r.a), " · " + ago(r.at)), h("div", { class: "crt" }, linkify(r.t)), n.kind === "fikir" ? replyVotes(n, r, true) : null)))
      ) : null
    ));
  }
}
/* ---------- links ---------- */
const URL_RE = /https?:\/\/[^\s<>"']+/g;
const links = text => [...new Set((text || "").match(URL_RE) || [])];
function linkCard(u) {
  let host;
  try { host = new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return null; }
  const yt = /(^|\.)youtube\.com$|^youtu\.be$/.test(host);
  return h("a", { class: "lnk" + (yt ? " yt" : ""), href: u, target: "_blank", rel: "noopener noreferrer",
    title: "Yeni sekmede ac", onclick: e => e.stopPropagation() },
    h("span", { class: "lk" }, yt ? "▶ YouTube" : "↗ " + host), h("span", { class: "lu" }, u));
}
function linkify(text) {
  const out = []; let last = 0;
  for (const m of (text || "").matchAll(URL_RE)) {
    out.push(text.slice(last, m.index));
    out.push(h("a", { href: m[0], target: "_blank", rel: "noopener noreferrer", onclick: e => e.stopPropagation() }, m[0]));
    last = m.index + m[0].length;
  }
  out.push((text || "").slice(last));
  return out;
}

/* ---------- who is working on what ---------- */
const workers = n => Object.entries(n.working || {}).filter(([, v]) => v).sort((a, b) => a[1].at - b[1].at).map(([id, v]) => ({ id, at: v.at }));
/* someone else claimed it and I haven't joined: I may not close or delete it */
function lockedFor(n) {
  const ws = workers(n);
  return ws.length && !ws.some(w => w.id === S.meId) ? ws : null;
}
function lockMsg(n, del) {
  const names = workers(n).map(w => who(w.id)).join(" ve ");
  return names + " bu konuyla ilgileniyor. " + (del ? "Silmek" : "Bitirmek") + " icin once “Ben ilgileniyorum” de ya da " + names + " bitirsin.";
}
function workBanner(n) {
  const ws = workers(n);
  if (!ws.length || n.status === "bitti") return null;
  return h("div", { class: "working" }, h("span", { class: "wico", "aria-hidden": "true" }, "⚒"),
    h("div", { class: "wl" }, ws.map(w => h("span", { class: "wp" }, avatar(w.id, "sm"), nameEl(w.id))),
      h("span", { class: "ws" }, "ilgileniyor · " + ago(ws[0].at) + " basladi")));
}
function workBtn(n) {
  if (!S.canWrite || !S.meId || n.status === "bitti") return null;
  const mine = !!(n.working || {})[S.meId];
  return h("button", { type: "button", class: "wb" + (mine ? " on" : ""), "aria-pressed": String(mine),
    onclick: e => { e.stopPropagation(); toggleWork(n); } }, mine ? "⚒ Ilgileniyorsun · birak" : "⚒ Ben ilgileniyorum");
}
/* one-click finish straight from the card (same rules as the sheet's ✓ Bitti) */
function finishBtn(n) {
  if (!S.canWrite || !S.meId || n.status === "bitti" || lockedFor(n)) return null;
  return h("button", { type: "button", class: "wb fin", title: "Notu bitti olarak isaretle",
    onclick: e => { e.stopPropagation(); finishNote(n.id); } }, "✓ Bitir");
}
async function finishNote(id) {
  const cur = S.notes.find(x => x.id === id); if (!cur || cur.status === "bitti") return;
  if (lockedFor(cur)) { toast(lockMsg(cur)); return; }
  const at = Date.now();
  if (await write(() => S.db.doc("notes/" + id).update({ status: "bitti", doneAt: at, updatedAt: at, updatedBy: S.meId })))
    toast("Bitti! Not, Bitenler paneline tasindi");
}
async function toggleWork(n) {
  const mine = !!(n.working || {})[S.meId], at = Date.now();
  const patch = { working: { [S.meId]: mine ? null : { at } } };
  if (!mine && n.status === "acik") patch.status = "suruyor";
  if (await write(() => S.db.doc("notes/" + n.id).update(patch)))
    toast(mine ? "Artik bu konuyla ilgilenmiyorsun" : "Herkes bu konuyla ilgilendigini goruyor");
}

/* ---------- stars: shared by the whole team, anyone may star any note (not limited to the author) ---------- */
const byStar = (a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0);
function starBtn(n) {
  const on = !!n.starred, can = !!(S.canWrite && S.meId);
  return h("button", { type: "button", class: "star" + (on ? " on" : ""), "aria-pressed": String(on), disabled: !can,
    "aria-label": on ? "Yildizi kaldir" : "Yildizla",
    title: on ? "Yildizli" + (n.starred.by ? " · " + who(n.starred.by) + " yildizladi" : "") + (can ? " · kaldirmak icin tikla" : "") : "Onemli: yildizla, hep en basta dursun",
    onclick: e => { e.stopPropagation(); toggleStar(n.id); } }, on ? "★" : "☆");
}
async function toggleStar(id) {
  const cur = S.notes.find(x => x.id === id); if (!cur || !S.meId) return;
  const on = !cur.starred;
  if (await write(() => S.db.doc("notes/" + id).update({ starred: on ? { by: S.meId, at: Date.now() } : null })))
    toast(on ? (cur.status === "bitti" ? "Yildizlandi" : "Yildizlandi, not ★ Yildizlilar sekmesine tasindi") : (cur.status === "bitti" ? "Yildiz kaldirildi" : "Yildiz kaldirildi, not calisma masasina dondu"));
}

/* ---------- pins: pinned notes sit at the very top (above starred) ---------- */
const byPin = (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.pinnedAt || 0) - (a.pinnedAt || 0);
function pinBtn(n) {
  const on = !!n.pinned, can = !!(S.canWrite && S.meId);
  return h("button", { type: "button", class: "pin" + (on ? " on" : ""), "aria-pressed": String(on), disabled: !can,
    "aria-label": on ? "Sabitlemeyi kaldir" : "Sabitle",
    title: on ? "Sabitlenmis" + (n.pinnedBy ? " · " + who(n.pinnedBy) + " sabitledi" : "") + (can ? " · kaldirmak icin tikla" : "") : "Onemli: sabitle, her zaman en ustte dursun",
    onclick: e => { e.stopPropagation(); togglePin(n.id); } }, on ? "📌" : "📍");
}
async function togglePin(id) {
  const cur = S.notes.find(x => x.id === id); if (!cur || !S.meId) return;
  const on = !cur.pinned;
  const patch = on ? { pinned: true, pinnedAt: Date.now(), pinnedBy: S.meId } : { pinned: null, pinnedAt: null, pinnedBy: null };
  if (await write(() => S.db.doc("notes/" + id).update(patch)))
    toast(on ? (cur.status === "bitti" ? "Sabitlendi" : "Sabitlendi, not en ustte duracak") : (cur.status === "bitti" ? "Sabitleme kaldirildi" : "Sabitleme kaldirildi, not normal siraya dondu"));
}

/* ---------- idea voting ---------- */
const vget = (n, id) => { const x = (n.votes || {})[id]; return x && x.v || null; };
function voteBox(n) {
  const people = [...new Set((S.colorOrder || []).concat(Object.keys(n.votes || {})))].filter(Boolean);
  if (!people.length && S.meId) people.push(S.meId);
  const yes = people.filter(id => vget(n, id) === "yes").length, no = people.filter(id => vget(n, id) === "no").length;
  const [cls, text] = people.length && yes === people.length ? ["ok", "✓ Onaylandi"]
    : people.length && no === people.length ? ["bad", "✕ Reddedildi"]
    : yes && no ? ["mixed", "Gorus ayriligi"]
    : ["wait", "Oy bekleniyor"];
  const mine = vget(n, S.meId);
  const btns = S.canWrite && S.meId ? [
    h("button", { type: "button", class: "vb yes" + (mine === "yes" ? " on" : ""), "aria-pressed": String(mine === "yes"),
      onclick: () => vote(n.id, mine === "yes" ? null : "yes") }, "✓ Onayla"),
    h("button", { type: "button", class: "vb no" + (mine === "no" ? " on" : ""), "aria-pressed": String(mine === "no"),
      onclick: () => vote(n.id, mine === "no" ? null : "no") }, "✕ Reddet")
  ] : [];
  return h("div", { class: "votes", onclick: e => e.stopPropagation() },
    h("div", { class: "vhead" }, h("span", { class: "verdict " + cls }, text), btns),
    h("div", { class: "voters" }, people.map(id => {
      const v = vget(n, id);
      return h("span", { class: "voter " + (v || "wait") }, avatar(id, "sm"), nameEl(id),
        h("span", { class: "vv" }, v === "yes" ? "✓ onayladi" : v === "no" ? "✕ reddetti" : "bekliyor"));
    })));
}
const rkey = r => r.a + "_" + r.at;
function replyVotes(n, r, compact) {
  const ents = Object.entries(((n.rvotes || {})[rkey(r)]) || {}).filter(([, v]) => v);
  const yesIds = ents.filter(([, v]) => v.v === "yes").map(([id]) => id);
  const noIds = ents.filter(([, v]) => v.v === "no").map(([id]) => id);
  const mineE = ents.find(([id]) => id === S.meId), mine = mineE ? mineE[1].v : null;
  const can = !!(S.canWrite && S.meId);
  const btn = (v, label, ids) => h("button", { type: "button", class: "rv " + v + (mine === v ? " on" : ""), disabled: !can,
    "aria-pressed": String(mine === v), "aria-label": (v === "yes" ? "Onayla" : "Reddet") + ", " + ids.length + " oy",
    title: ids.length ? ids.map(who).join(", ") : "Henuz kimse",
    onclick: e => { e.stopPropagation(); voteReply(n.id, r, mine === v ? null : v); } }, label + " " + ids.length);
  return h("div", { class: "rvotes", onclick: e => e.stopPropagation() },
    btn("yes", "✓", yesIds), btn("no", "✕", noIds),
    !compact && ents.length ? h("span", { class: "rvn" }, ents.map(([id, v]) => h("span", {}, nameEl(id), v.v === "yes" ? " onayladi" : " reddetti"))) : null);
}
async function voteReply(noteId, r, v) {
  if (!S.meId) return;
  const at = Date.now();
  await write(() => S.db.doc("notes/" + noteId).update({ rvotes: { [rkey(r)]: { [S.meId]: v ? { v, at } : null } } }));
}
async function vote(id, v) {
  if (!S.meId) return;
  const at = Date.now();
  if (await write(() => S.db.doc("notes/" + id).update({ votes: { [S.meId]: v ? { v, at } : null } })))
    toast(v === "yes" ? "Onay verdin" : v === "no" ? "Reddettin" : "Oyunu geri aldin");
}

function renderEvents() {
  const evs = [];
  const addEvent = (at, by, text, note) => {
    if (typeof at === 'number' && !isNaN(at)) evs.push({ at, by, text, note });
  };
  for (const n of S.notes) {
    addEvent(n.createdAt, n.author, "not ekledi: ", n);
    if (n.updatedAt - n.createdAt > 2000 && !(n.replies || []).some(r => r.at === n.updatedAt))
      addEvent(n.updatedAt, n.updatedBy, "notu guncelledi: ", n);
    for (const r of n.replies || []) addEvent(r.at, r.a, "yanit yazdi: ", n);
    for (const [uid, val] of Object.entries(n.votes || {})) if (val) addEvent(val.at, uid, val.v === "yes" ? "onay verdi: " : "reddetti: ", n);
    for (const w of workers(n)) addEvent(w.at, w.id, "ilgilenmeye basladi: ", n);
    if (n.starred && n.starred.at) addEvent(n.starred.at, n.starred.by, "★ yildizladi: ", n);
    for (const m of Object.values(n.rvotes || {})) for (const [uid, val] of Object.entries(m || {}))
      if (val) addEvent(val.at, uid, val.v === "yes" ? "bir yorumu onayladi: " : "bir yorumu reddetti: ", n);
  }
  evs.sort((a, b) => b.at - a.at);
  const box = $("events"); box.replaceChildren();
  if (!evs.length) { box.append(h("p", { class: "hint" }, "Ikinizin ekledigi, duzenledigi ve yanitladigi her sey burada sirayla gorunur.")); return; }
  for (const e of evs.slice(0, 40)) box.append(h("div", {
    class: "ev" + (S.prevSeen && e.at > S.prevSeen && e.by !== S.meId ? " fresh" : ""),
    role: "button", tabindex: "0", onclick: () => openSheet(e.note.id),
    onkeydown: ev => { if (ev.key === "Enter") openSheet(e.note.id); }
  }, avatar(e.by, "sm"), h("div", {},
    h("div", { class: "what" }, nameEl(e.by), " " + e.text, e.note.title),
    h("div", { class: "when" }, ago(e.at)))));
}

/* ---------- detail sheet ---------- */
function closeSheet() { S.openId = null; S.rEdit = null; S.rDel = null; $("sheet-root").replaceChildren(); }
addSafeListener(document, "keydown", e => {
  if (e.key !== "Escape") return;
  const lb = document.querySelector(".lightbox");
  if (lb) lb.remove(); else if (S.openId) closeSheet();
}, {}, 'global-escape');

function openSheet(id) {
  const n = S.notes.find(x => x.id === id); if (!n) return;
  S.openId = id;
  markNoteSeen(id);
  const ref = S.db.doc("notes/" + id);
  const kindSel = h("select", { class: "field", id: "sh-kind" }, KINDS.map(([k, t]) => h("option", { value: k, selected: n.kind === k }, t)));
  const statSel = h("select", { class: "field", id: "sh-status" }, STATUS.map(([k, t]) => h("option", { value: k, selected: n.status === k }, t)));
  const titleIn = h("input", { class: "title-in", id: "sh-title", value: n.title, maxlength: "120", "aria-label": "Baslik" });
  const bodyIn = h("textarea", { class: "field", id: "sh-body", rows: "8", "aria-label": "Not" });
  bodyIn.value = n.body || "";
  const saveErr = h("p", { class: "err" });
  const delBox = h("div", {});
  /* only the note's author may edit its content or delete it; others can still finish / reopen */
  const own = n.author === S.meId;
  if (!own) {
    titleIn.readOnly = true; bodyIn.readOnly = true; kindSel.disabled = true; statSel.disabled = true;
    titleIn.classList.add("ro"); bodyIn.classList.add("ro");
  }

  const save = async () => {
    const cur = S.notes.find(x => x.id === id); if (!cur) return;
    const patch = cur.author === S.meId
      ? { title: titleIn.value.trim() || cur.title, body: bodyIn.value.trim(), kind: kindSel.value, status: statSel.value }
      : { title: cur.title, body: cur.body || "", kind: cur.kind, status: statSel.value };
    if (patch.title === cur.title && patch.body === (cur.body || "") && patch.kind === cur.kind && patch.status === cur.status) { toast("Degisiklik yok"); return; }
    const finishing = patch.status === "bitti" && cur.status !== "bitti";
    if (finishing && lockedFor(cur)) { statSel.value = cur.status; saveErr.textContent = lockMsg(cur); return; }
    const reopening = cur.status === "bitti" && patch.status !== "bitti";
    patch.updatedAt = Date.now(); patch.updatedBy = S.meId;
    if (finishing) patch.doneAt = patch.updatedAt;
    if (await write(() => ref.update(patch), saveErr)) {
      if (finishing) { closeSheet(); toast("Bitti! Not, Bitenler paneline tasindi"); }
      else if (reopening) { closeSheet(); toast(cur.starred ? "Not tekrar acildi, ★ Yildizlilar sekmesine dondu" : "Not tekrar calisma masasina dondu"); }
      else toast("Kaydedildi");
    }
  };
  const askDelete = () => {
    const curD = S.notes.find(x => x.id === id);
    if (curD && curD.author !== S.meId) { saveErr.textContent = "Bu notu sadece yazan kisi silebilir."; return; }
    if (curD && lockedFor(curD)) { saveErr.textContent = lockMsg(curD, true); return; }
    delBox.replaceChildren(h("div", { class: "confirm" }, h("span", {}, "Bu not ve yanitlari silinsin mi?"),
      h("button", { class: "btn danger", type: "button", onclick: async () => {
        if (await write(() => ref.delete(), saveErr)) { closeSheet(); toast("Not silindi"); }
      } }, "Evet, sil"),
      h("button", { class: "btn ghost", type: "button", onclick: () => delBox.replaceChildren() }, "Vazgec")));
  };

  const replyIn = h("textarea", { class: "field", id: "sh-reply", rows: "2", placeholder: "Yanit yaz, Enter ile gonder…", style: "min-height:60px" });
  const sendReply = async () => {
    const t = replyIn.value.trim(); if (!t) return;
    const cur = S.notes.find(x => x.id === id); if (!cur) return;
    const at = Date.now();
    const replies = (cur.replies || []).concat([{ a: S.meId, t, at }]);
    if (await write(() => ref.update({ replies, updatedAt: at, updatedBy: S.meId }), saveErr)) replyIn.value = "";
  };
  addSafeListener(replyIn, "keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendReply(); }
  }, {}, 'sh-reply-keydown');
  const addImgs = async e => {
    const files = [...e.target.files]; e.target.value = "";
    const got = await uploadMedia(files, saveErr); if (!got.images.length && !got.videos.length) return;
    const cur = S.notes.find(x => x.id === id); if (!cur) return;
    const at = Date.now();
    if (await write(() => ref.update({ images: (cur.images || []).concat(got.images), videos: (cur.videos || []).concat(got.videos), updatedAt: at, updatedBy: S.meId }), saveErr)) toast("Eklendi");
  };

  const sheet = h("div", { class: "scrim", onclick: e => { if (e.target === e.currentTarget) closeSheet(); } },
    h("div", { class: "sheet", role: "dialog", "aria-label": "Not ayrintisi" },
      h("div", { class: "sheet-head" }, h("span", { class: "label", id: "sh-meta" }), h("span", { id: "sh-star", style: "margin-left:auto;display:inline-flex" }), h("button", { class: "btn ghost", type: "button", onclick: closeSheet }, "Kapat")),
      titleIn,
      h("div", { class: "row2" },
        h("label", {}, h("span", { class: "label" }, "Tur"), kindSel),
        h("label", {}, h("span", { class: "label" }, "Durum"), statSel)),
      h("div", { id: "sh-work", class: "actions" }),
      h("div", { id: "sh-votes" }),
      bodyIn,
      h("div", { class: "lnks", id: "sh-links" }),
      h("div", { class: "gallery", id: "sh-gallery" }),
      S.assets && h("label", { class: "btn sm", for: "sh-file" }, "Gorsel / video ekle",
        h("input", { type: "file", id: "sh-file", accept: IMG_TYPES.concat(VID_TYPES).join(","), multiple: true, hidden: true, onchange: addImgs })),
      h("div", { class: "actions" },
        own && h("button", { class: "btn primary", type: "button", onclick: save }, "Degisiklikleri kaydet"),
        n.status !== "bitti"
          ? h("button", { class: "btn", type: "button", onclick: () => { statSel.value = "bitti"; save(); } }, "✓ Bitti")
          : h("button", { class: "btn", type: "button", onclick: () => { statSel.value = "acik"; save(); } }, "Tekrar ac"),
        own && h("button", { class: "btn ghost danger", type: "button", onclick: askDelete }, "Sil"),
        !own && h("span", { class: "hint", style: "flex-basis:100%" }, "Bu notu " + who(n.author) + " yazdi; icerigini sadece o duzenleyip silebilir. Sen yanit yazabilir, yildizlayabilir, bitirebilirsin."),
        h("span", { class: "hint", id: "sh-changed" })),
      saveErr, delBox,
      h("span", { class: "label" }, "Konusma"),
      h("div", { class: "replies", id: "sh-replies" }),
      replyIn,
      h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: sendReply }, "Yanitla"),
        S.canWrite && (S.colorOrder || []).filter(x => x !== S.meId).map(pid =>
          h("button", { class: "pingbtn", type: "button", onclick: () => sendPing(pid, id) }, "Bu not icin durt: " + who(pid))),
        h("span", { class: "hint" }, "Enter gonderir · Shift + Enter yeni satir"))
    ));
  sheet.dataset.base = String(n.updatedAt);
  $("sheet-root").replaceChildren(sheet);
  renderSheetLive();
  renderCards(); renderTotals();
  titleIn.focus();
}
function renderSheetLive() {
  if (!S.openId) return;
  const n = S.notes.find(x => x.id === S.openId);
  if (!n) { closeSheet(); toast("Bu not silindi"); return; }
  const meta = $("sh-meta"); if (!meta) return;
  meta.textContent = who(n.author) + " yazdi · " + ago(n.createdAt);
  const shs = $("sh-star"); if (shs) shs.replaceChildren(starBtn(n));
  const base = Number($("sheet-root").firstChild.dataset.base);
  $("sh-changed").textContent = n.updatedAt > base && n.updatedBy !== S.meId
    ? who(n.updatedBy) + " bu notu az once degistirdi. Kaydedersen senin hâlin gecerli olur." : "";
  const lk = n.status !== "bitti" && lockedFor(n);
  $("sh-work").replaceChildren(...[workBanner(n), workBtn(n),
    lk ? h("span", { class: "hint", style: "flex-basis:100%" }, "Kilitli: bu notu sadece ilgilenen kisi bitirebilir ya da silebilir.") : null].filter(Boolean));
  const bo = $("sh-status").querySelector('option[value="bitti"]');
  if (bo) bo.disabled = !!lk;
  $("sh-links").replaceChildren(...links(n.body).map(linkCard).filter(Boolean));
  const vbx = $("sh-votes"); vbx.replaceChildren();
  if (n.kind === "fikir") vbx.append(voteBox(n));
  const gal = $("sh-gallery"); gal.replaceChildren();
  const media = (n.images || []).map(x => ["images", x]).concat((n.videos || []).map(x => ["videos", x]));
  for (const [field, mid] of media) {
    const rm = S.canWrite && n.author === S.meId && h("button", { class: "btn ghost sm", type: "button" }, "Kaldir");
    if (rm) addSafeListener(rm, "click", async () => {
      if (rm.dataset.sure !== "1") { rm.dataset.sure = "1"; rm.textContent = "Emin misin? Tekrar tikla"; return; }
      const cur = S.notes.find(x => x.id === n.id); if (!cur) return;
      const at = Date.now();
      if (await write(() => S.db.doc("notes/" + n.id).update({ [field]: (cur[field] || []).filter(x => x !== mid), updatedAt: at, updatedBy: S.meId })))
        if (S.assets) S.assets.delete(mid).catch(() => {});
    }, {}, 'gallery-rm-' + field + '-' + mid);
    const el = field === "images"
      ? h("img", { src: imgUrl(mid), alt: "", loading: "lazy", onclick: () => lightbox(mid) })
      : h("video", { src: imgUrl(mid), controls: true, preload: "metadata", playsinline: true });
    gal.append(h("figure", { class: field === "videos" ? "vid" : null }, el, rm));
  }
  const box = $("sh-replies"); box.replaceChildren();
  const rs = n.replies || [];
  if (!rs.length) box.append(h("p", { class: "hint", style: "margin:0" }, "Henuz yanit yok. Fikrini asagiya yaz."));
  const hadFocus = document.activeElement && document.activeElement.id === "sh-redit";
  for (const r of rs) box.append(h("div", { class: "reply", style: "--uc:" + ucol(r.a) }, avatar(r.a),
    h("div", {}, h("div", { class: "who" }, nameEl(r.a), " · " + ago(r.at), r.ed ? h("span", { class: "mt" }, " · duzenlendi") : null, replyOwn(n, r)),
      replyBody(n, r), n.kind === "fikir" ? replyVotes(n, r, false) : null)));
  if (hadFocus && $("sh-redit")) $("sh-redit").focus();
}
function replyOwn(n, r) {
  if (!S.canWrite || !S.meId || r.a !== S.meId) return null;
  const k = rkey(r);
  if ((S.rEdit && S.rEdit.key === k) || S.rDel === k) return null;
  return h("span", { class: "own" },
    h("button", { type: "button", onclick: () => { S.rEdit = { noteId: n.id, key: k, t: r.t }; S.rDel = null; renderSheetLive(); if ($("sh-redit")) $("sh-redit").focus(); } }, "duzenle"),
    h("button", { type: "button", class: "del", onclick: () => { S.rDel = k; S.rEdit = null; renderSheetLive(); } }, "sil"));
}
function replyBody(n, r) {
  const k = rkey(r), mine = r.a === S.meId;
  if (mine && S.rEdit && S.rEdit.key === k && S.rEdit.noteId === n.id) {
    const ta = h("textarea", { class: "field", id: "sh-redit", rows: "2", style: "min-height:60px", "aria-label": "Yaniti duzenle" });
    ta.value = S.rEdit.t;
    addSafeListener(ta, "input", () => { if (S.rEdit) S.rEdit.t = ta.value; }, {}, 'redit-input-' + k);
    addSafeListener(ta, "keydown", e => { if (e.key === "Escape") { e.stopPropagation(); S.rEdit = null; renderSheetLive(); } }, {}, 'redit-keydown-' + k);
    return h("div", {}, ta, h("div", { class: "actions", style: "margin-top:6px" },
      h("button", { class: "btn primary sm", type: "button", onclick: () => saveReplyEdit(n.id, k) }, "Kaydet"),
      h("button", { class: "btn ghost sm", type: "button", onclick: () => { S.rEdit = null; renderSheetLive(); } }, "Vazgec")));
  }
  if (mine && S.rDel === k) return h("div", {}, h("div", { class: "bubble" }, linkify(r.t)),
    h("div", { class: "confirm" }, h("span", {}, "Bu yanit silinsin mi?"),
      h("button", { class: "btn danger sm", type: "button", onclick: () => deleteReply(n.id, k) }, "Evet, sil"),
      h("button", { class: "btn ghost sm", type: "button", onclick: () => { S.rDel = null; renderSheetLive(); } }, "Vazgec")));
  return h("div", { class: "bubble" }, linkify(r.t));
}
async function saveReplyEdit(id, k) {
  const t = ((S.rEdit && S.rEdit.t) || "").trim(); if (!t) { toast("Yanit bos olamaz; silmek istersen \"sil\"i kullan"); return; }
  const cur = S.notes.find(x => x.id === id); if (!cur) return;
  const r0 = (cur.replies || []).find(x => rkey(x) === k);
  if (!r0 || r0.a !== S.meId) { S.rEdit = null; renderSheetLive(); return; }
  const at = Date.now();
  const replies = cur.replies.map(x => rkey(x) === k ? Object.assign({}, x, { t, ed: at }) : x);
  if (await write(() => S.db.doc("notes/" + id).update({ replies, updatedAt: at, updatedBy: S.meId }))) { S.rEdit = null; renderSheetLive(); toast("Yanit guncellendi"); }
}
async function deleteReply(id, k) {
  const cur = S.notes.find(x => x.id === id); if (!cur) return;
  const r0 = (cur.replies || []).find(x => rkey(x) === k);
  if (!r0 || r0.a !== S.meId) { S.rDel = null; renderSheetLive(); return; }
  const at = Date.now();
  if (await write(() => S.db.doc("notes/" + id).update({ replies: cur.replies.filter(x => rkey(x) !== k), updatedAt: at, updatedBy: S.meId }))) { S.rDel = null; renderSheetLive(); toast("Yanit silindi"); }
}

renderNewKinds();
boot();

