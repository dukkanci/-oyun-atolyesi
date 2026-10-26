#!/usr/bin/env node
// Oyun Atölyesi — src/ dosyalarını tek bir yayın dosyasında (dist/index.html) birleştirir.
// Kullanım:  node build.js          → dist/index.html üretir (önce kuralları denetler)
//            node build.js --check  → sadece denetler, dosya yazmaz
// Bağımlılık yok; sadece Node.js gerekir.
const fs = require("fs"), path = require("path");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "dist", "index.html");
// Yayındaki sayfa CRLF satır sonlarıyla yayınlandı; çıktı bayt bayt aynı kalsın diye CRLF yazıyoruz.
const EOL = "\r\n";

// İzin verilen dış kaynaklar. Script'ler sadece bu CDN'lerden ve sabit sürümle yüklenebilir.
const SCRIPT_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com", "cdn.tailwindcss.com", "code.jquery.com"];
const STYLE_HOSTS = ["fonts.googleapis.com"];
const PRECONNECT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

const read = f => fs.readFileSync(path.join(SRC, f), "utf8").replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");

const isDev = process.argv.includes("--dev");

function assemble() {
  const parts = [
    read("head.html"),
    "<style>\n", read("styles.css"), "</style>\n",
    read("body.html"),
  ];
  if (isDev) {
    parts.push("<script>\n", read("mock.js"), "</script>\n");
  }
  parts.push("<script>\n", read("app.js"), "</script>\n", "\n</body></html>");
  return parts.join("").replace(/\n/g, EOL);
}

function check(html, js) {
  const errs = [];
  const host = u => { try { return new URL(u).hostname; } catch { return ""; } };

  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)) {
    const u = m[1];
    if (!SCRIPT_HOSTS.includes(host(u))) errs.push("İzin verilmeyen script kaynağı: " + u);
    // Sürüm sabitlenmeli: paket@1.2.3 ya da /1.2.3/ biçiminde tam sürüm olmalı (react@18 gibi yarım sürüm olmaz).
    else if (host(u) !== "cdn.tailwindcss.com" && !/(@|\/)v?\d+\.\d+\.\d+([-.][\w.]+)?(\/|$)/.test(u))
      errs.push("Script sürümü sabit değil (tam sürüm yaz, ör. paket@1.2.3): " + u);
    else if (host(u) === "cdn.tailwindcss.com" && !/\/\d+\.\d+\.\d+/.test(u))
      errs.push("Script sürümü sabit değil: " + u);
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0], href = (tag.match(/\bhref\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!href || !/^https?:/i.test(href)) continue;
    const rel = ((tag.match(/\brel\s*=\s*["']?([^"'>]+)/i) || [])[1] || "").toLowerCase();
    const ok = rel.includes("stylesheet") ? STYLE_HOSTS : rel.includes("preconnect") ? PRECONNECT_HOSTS : [];
    if (!ok.includes(host(href))) errs.push("İzin verilmeyen dış bağlantı (" + rel + "): " + href);
  }
  if (/@import\s+(url\()?["']?https?:/i.test(html)) errs.push("CSS içinde dış @import kullanılmış.");
  if (/\b(sessionStorage|indexedDB|openDatabase)\b/.test(js))
    errs.push("localStorage dışında tarayıcı depolaması kullanılmış (sessionStorage / IndexedDB yasak).");
  if (/document\.cookie/.test(js)) errs.push("Çerez (document.cookie) kullanılmış.");
  if (/createElement\(\s*["']script["']\s*\)|\bimport\(/.test(js)) errs.push("Dinamik script yükleme kullanılmış.");
  return errs;
}

const html = assemble();
const errs = check(html, read("app.js"));
if (errs.length) {
  console.error("Denetim başarısız:\n - " + errs.join("\n - "));
  process.exit(1);
}
if (process.argv.includes("--check")) {
  console.log("Denetim tamam.");
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  console.log("dist/index.html yazıldı (" + Buffer.byteLength(html) + " bayt). Denetim tamam.");
}
