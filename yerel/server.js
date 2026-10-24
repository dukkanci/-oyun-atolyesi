// Atölye'yi claude.ai dışında, yerel ağda çalıştıran küçük sunucu (sadece Node standart kütüphanesi).
// Kullanım: node yerel/server.js [port]   — test: node yerel/server.js --test
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto"), os = require("os");

const KOK = path.join(__dirname, ".."), VERI = path.join(__dirname, "veri"), DOSYALAR = path.join(VERI, "dosyalar");
const DB_DOSYA = path.join(VERI, "db.json");
const MAX_DOSYA = 25 * 1024 * 1024;
const AD = /^[A-Za-z0-9_-]{1,64}$/;
const YASAK = new Set(["__proto__", "constructor", "prototype"]);

// update(): iç içe objeleri birleştirir, null anahtarı siler, diziler olduğu gibi yazılır (Artifact db ile aynı).
function birlestir(hedef, yama) {
  for (const [k, v] of Object.entries(yama)) {
    if (YASAK.has(k)) continue;
    if (v === null) delete hedef[k];
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      if (!hedef[k] || typeof hedef[k] !== "object" || Array.isArray(hedef[k])) hedef[k] = {};
      birlestir(hedef[k], v);
    } else hedef[k] = v;
  }
  return hedef;
}
const temizle = o => JSON.parse(JSON.stringify(o), (k, v) => (YASAK.has(k) ? undefined : v));

if (process.argv.includes("--test")) {
  const assert = require("assert");
  const d = { a: 1, votes: { x: { v: "yes" }, y: { v: "no" } }, imgs: [1, 2] };
  birlestir(d, { votes: { x: null, z: { v: "yes" } }, imgs: [3], yeni: { b: 2 } });
  assert.deepStrictEqual(d, { a: 1, votes: { y: { v: "no" }, z: { v: "yes" } }, imgs: [3], yeni: { b: 2 } });
  birlestir(d, JSON.parse('{"__proto__":{"kirli":1}}'));
  assert.strictEqual({}.kirli, undefined);
  console.log("birlestir testleri geçti");
  process.exit(0);
}

fs.mkdirSync(DOSYALAR, { recursive: true });
// durum: { db: { koleksiyon: { id: veri } }, profiller: { uid: ad }, dosyalar: { id: tür } }
const durum = fs.existsSync(DB_DOSYA) ? JSON.parse(fs.readFileSync(DB_DOSYA, "utf8")) : { db: {}, profiller: {}, dosyalar: {} };
let kayitZamani = null;
function kaydet() {
  clearTimeout(kayitZamani);
  kayitZamani = setTimeout(() => {
    fs.writeFileSync(DB_DOSYA + ".tmp", JSON.stringify(durum));
    fs.renameSync(DB_DOSYA + ".tmp", DB_DOSYA);
  }, 200);
}

const dinleyiciler = new Set();
function yayinla(olay) {
  const s = "data: " + JSON.stringify(olay) + "\n\n";
  for (const res of dinleyiciler) res.write(s);
}

function yaz({ op, yol, veri }) {
  const [kol, id0] = String(yol || "").split("/");
  if (!AD.test(kol) || (id0 !== undefined && !AD.test(id0))) throw new Error("geçersiz yol");
  const k = (durum.db[kol] = durum.db[kol] || {});
  let id = id0;
  if (op === "add") { id = crypto.randomBytes(10).toString("hex"); k[id] = temizle(veri); }
  else if (!id) throw new Error("belge id yok");
  else if (op === "set") k[id] = temizle(veri);
  else if (op === "update") k[id] = birlestir(k[id] || {}, temizle(veri));
  else if (op === "delete") delete k[id];
  else throw new Error("bilinmeyen işlem");
  kaydet();
  yayinla({ kol, id, veri: k[id] || null });
  return { id };
}

function govdeOku(req, sinir) {
  return new Promise((ok, red) => {
    const parcalar = []; let boy = 0;
    req.on("data", c => { boy += c.length; if (boy > sinir) { red(Object.assign(new Error("çok büyük"), { code: "too_large" })); req.destroy(); } else parcalar.push(c); });
    req.on("end", () => ok(Buffer.concat(parcalar)));
    req.on("error", red);
  });
}
const json = (res, kod, o) => { res.writeHead(kod, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); };

function sayfa() {
  const html = fs.readFileSync(path.join(KOK, "dist", "index.html"), "utf8");
  return html.replace("<script>", '<script src="/yerel-shim.js"></script><script>');
}

const sunucu = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(sayfa());
    }
    if (req.method === "GET" && url.pathname === "/yerel-shim.js") {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(path.join(__dirname, "shim.js")));
    }
    if (req.method === "GET" && url.pathname === "/api/olaylar") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write("data: " + JSON.stringify({ hepsi: durum.db, profiller: durum.profiller }) + "\n\n");
      dinleyiciler.add(res);
      req.on("close", () => dinleyiciler.delete(res));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/yaz") {
      return json(res, 200, yaz(JSON.parse(await govdeOku(req, 1024 * 1024))));
    }
    if (req.method === "POST" && url.pathname === "/api/profil") {
      const { id, ad } = JSON.parse(await govdeOku(req, 4096));
      if (!AD.test(id) || typeof ad !== "string" || !ad.trim()) return json(res, 400, { hata: "geçersiz profil" });
      durum.profiller[id] = ad.trim().slice(0, 40); kaydet();
      yayinla({ profiller: durum.profiller });
      return json(res, 200, { ok: true });
    }
    const blob = url.pathname.match(/^\/_blob\/?([0-9a-f]{32})?$/);
    if (blob && req.method === "POST" && !blob[1]) {
      const tur = String(url.searchParams.get("type") || "application/octet-stream").slice(0, 100);
      const govde = await govdeOku(req, MAX_DOSYA).catch(e => e);
      if (govde instanceof Error) return json(res, 413, { code: "too_large" });
      const id = crypto.randomBytes(16).toString("hex");
      fs.writeFileSync(path.join(DOSYALAR, id), govde);
      durum.dosyalar[id] = tur; kaydet();
      return json(res, 200, { id });
    }
    if (blob && blob[1] && req.method === "GET") {
      const tur = durum.dosyalar[blob[1]];
      if (!tur) { res.writeHead(404); return res.end(); }
      // Sadece medya türleri sayfa içinde açılır; geri kalanı indirilir (aynı kökenden HTML çalışmasın diye).
      const medya = /^(image\/(png|jpeg|gif|webp)|video\/[\w.+-]+|audio\/[\w.+-]+)$/.test(tur);
      res.writeHead(200, {
        "Content-Type": medya ? tur : "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
        ...(medya ? {} : { "Content-Disposition": "attachment" }),
      });
      return fs.createReadStream(path.join(DOSYALAR, blob[1])).pipe(res);
    }
    if (blob && blob[1] && req.method === "DELETE") {
      delete durum.dosyalar[blob[1]]; kaydet();
      fs.rm(path.join(DOSYALAR, blob[1]), { force: true }, () => {});
      return json(res, 200, { ok: true });
    }
    res.writeHead(404); res.end();
  } catch (e) {
    json(res, 400, { hata: e.message });
  }
});

// SSE bağlantıları uyumasın diye
setInterval(() => { for (const r of dinleyiciler) r.write(": ping\n\n"); }, 25000);

const PORT = Number(process.argv[2]) || 4000;
sunucu.listen(PORT, "0.0.0.0", () => {
  const ipler = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === "IPv4" && !a.internal).map(a => a.address);
  console.log("Atölye yerel sunucusu çalışıyor:");
  console.log("  Bu bilgisayar:  http://localhost:" + PORT);
  for (const ip of ipler) console.log("  Yerel ağ:       http://" + ip + ":" + PORT);
});
