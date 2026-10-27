# Oyun Atölyesi — Claude için proje rehberi

İki kişilik ekibin oyun fikirlerini, notlarını, sohbetini ve build'lerini paylaştığı tek sayfalık uygulama.
Tek başına çalışan HTML/JS olarak çalışır. Veriler tarayıcıda `localStorage` ile saklanır.

- Repo: `dukkanci/-oyun-atolyesi` — `main` = yayındaki sürüm.
- Canlı demo (GitHub Pages): https://dukkanci.github.io/-oyun-atolyesi/efsane-proje/

## Dosya yapısı

| Dosya | Ne işe yarar |
|---|---|
| `src/head.html` | `<!doctype>`, `<head>` başlangıcı, viewport, `<title>`, Google Fonts bağlantıları. 1. satır Artifact'in temel stilini de içerir (dokunma). |
| `src/styles.css` | Uygulamanın bütün CSS'i (tema renkleri `:root` üzerinde, mobil düzen media query'leri). |
| `src/body.html` | Sayfa iskeleti: yükleme ekranı `#s-loading`, şifre/giriş ekranları, ana sekmeler, modal/sheet'ler, `#notifs`, `#pingbar`. |
| `src/app.js` | Bütün uygulama mantığı (sabitler, DB dinleyicileri, render fonksiyonları, olay işleyiciler). |
| `build.js` | `src/` dosyalarını `dist/index.html` içinde birleştirir ve kuralları denetler. |
| `dist/index.html` | **Üretilen** yayın dosyası. Elle düzenlenmez, repoya girmez (`.gitignore`). |
| `CHECKLIST.md` | Yayından önce elle yapılan kontroller. |
| `.github/pull_request_template.md` | PR açıklaması şablonu (özet + kontrol listesi). |

## Yayın dosyası nasıl üretilir

```
node build.js          # dist/index.html üretir
node build.js --check  # sadece kuralları denetler
```

Birleştirme sırası: `head.html` + `<style>` + `styles.css` + `</style>` + `body.html` + `<script>` + `app.js` + `</script>` + `</body></html>`.
Kaynaklar LF ile tutulur, çıktı CRLF yazılır (geçişteki canlı dosyayla bayt bayt aynı olsun diye).
Denetim başarısız olursa build dosya yazmaz ve 1 ile çıkar.

**Yayınlama:** `dist/index.html`'i istediğiniz statik sunucuya (GitHub Pages, Netlify, Vercel, vb.) yükleyin.

**Düzenleme:** Değişiklikler her zaman `src/` içinde yapılır, sonra build alınır.

## Kod düzeni (app.js)

- `S` = global durum (`S.db`, `S.assets`, `S.meId`, `S.notes`, dinleyici unsub'ları…).
- `h(tag, attrs, ...kids)` DOM üretir; `$` = `getElementById`.
- Her DB yazması `write(() => ..., errEl)` içinden geçer; hata mesajını Türkçe gösterir.
- `ls` = try/catch'li localStorage sarmalayıcısı (anahtarlar: `atolye-key`, `atolye-seen`).
- Sabitler: `KINDS` (fikir/mekanik/hikaye/sanat/gorev/hata), `STATUS` (acik/suruyor/bitti), `AVATARS`,
  `AV_ALIAS`, `UPD_TYPES`, `PHASES`/`PHASE_ORDER`, `BUILD_FILES`, `BUILD_MAX` (20 MB), `IMG_TYPES`.
- Şifre kilidi: `SHA-256("atolye|" + şifre)` → `team/settings.passHash`.
- `db.doc(...).update()` iç içe objeleri birleştirir; bir anahtara `null` yazmak o anahtarı siler
  (oylar, `working`, `starred` bu şekilde kaldırılır).

## Veritabanı koleksiyonları ve alanlar

Zamanlar `Date.now()` (ms). Kullanıcı kimliği = `user.me()`'den gelen id (`a`, `author`, `by`, `from` alanları).

**`team/settings`** (tek belge)
- `game`, `passHash`, `createdBy`, `createdAt`
- `avatars: { uid: anahtar }` — anahtar `AVATARS` adı, `"rotate"` ya da `"img:<assetId>"`; eski adlar `AV_ALIAS` ile çevrilir (`profesor→baykus`, `berlin→tilki`)
- `progress: { at, by, pct, phase }`
- `claude: { on, since, ack, minutes, by }` — "Claude'a iş ver" anahtarı ve süresi

**`notes`** (`updatedAt` azalan, limit 500)
- `title`, `body`, `kind`, `status` (`acik`|`suruyor`|`bitti`), `author`, `createdAt`, `updatedAt`, `updatedBy`
- `replies: [{ a, t, at, ed? }]` — yanıt anahtarı `rkey(r) = r.a + "_" + r.at`
- `images: [assetId]`, `videos: [assetId]`
- `doneAt` (bitince), `starred: { by, at } | null`
- `votes: { uid: { v: "yes"|"no", at } }`, `rvotes: { rkey: { uid: { v, at } } }`
- `working: { uid: { at } }`
- Başlık/metin/tür düzenleme ve silme sadece yazara açık; bitirme ve durum değiştirme herkese açık.

**`chat`** (`at` azalan, limit 300)
- `a`, `t`, `at`, `imgs: [assetId]`, `files: [{ id, name, type, size }]`, `re` (yanıtlanan mesaj), `editedAt`
- `voice: { id, type, dur }`, `sticker` (hazır sticker anahtarı), `cst: { img, label, by }` (özel sticker)
- `poll: { q, opts, yn, closed }`, `pv: { uid: seçenekIndex }`

**`stickers`**: `a`, `img`, `label`, `at`
**`lastseen/{uid}`**: `at` — **`chatseen/{uid}`**: `at`
**`pings/{uid}`**: `from`, `at`, `note`, `title`, `seenAt`
**`jobs`** (`at` azalan, limit 50): `a`, `t`, `at`, `status` (`bekliyor`|`calisiyor`|`soru`|`bitti`|`iptal`), `answer`
**`updates`** (`at` azalan, limit 200): `a`, `at`, `ver`, `type`, `title`, `body`, `pct`, `ed`
**`builds`** (`at` azalan, limit 200): `a`, `at`, `ver`, `note`, `files: [{ id, name, type, size }]`, `link`

Yeni alan ya da koleksiyon eklersen bu listeyi aynı PR'da güncelle.

## Kurallar

1. **Mevcut notları bozacak alan değişikliği yok.** Alan/koleksiyon adı, değer biçimi (ör. `status` değerleri,
   `rkey` biçimi, asset id saklama şekli) değiştirilmez. Değiştirmek gerçekten gerekiyorsa:
   - Okuma kodu bir süre **hem eski hem yeni** biçimi anlamalı (`AV_ALIAS` örneğindeki gibi).
   - Eski kayıtları yeni biçime çeviren bir **migration adımı** yazılır: açılışta (ör. `boot()` sonrası) bir kez çalışır,
     sadece eski biçimdeki belgelere dokunur, tekrar çalışınca zarar vermez (idempotent), işini
     `team/settings` içinde bir bayrakla (ör. `migrations: { ad: at }`) işaretler.
   - PR açıklamasında migration açıkça belirtilir. Toplu silme yapan migration yazılmaz.
2. **Tarayıcı depolaması:** sadece `localStorage` (her zaman `ls` üzerinden, try/catch'li). `sessionStorage`,
   IndexedDB, çerez yok. Kalıcı ya da paylaşılan veri `S.db`'ye gider.
3. **Dış kaynaklar:** script'ler sadece cdnjs.cloudflare.com, cdn.jsdelivr.net/npm, unpkg.com, cdn.tailwindcss.com,
   code.jquery.com'dan ve **tam sabit sürümle** (`paket@1.2.3`, `react@18` değil) yüklenir. Stil dosyası sadece
   Google Fonts. Geri kalan her şey satır içi. `build.js` bunları denetler.
4. **Arayüz Türkçe.** Yeni buton, mesaj, hata, toast, `aria-label`, placeholder metinleri Türkçe yazılır
   (Türkçe karakterlerle: ş, ğ, ı, İ, ö, ü, ç).
5. Mobil düzen bozulmamalı (telefonda yatay kaydırma yok, güvenli alan `env(safe-area-inset-*)` korunur).

## Çalışma akışı

- `main` korunur; her değişiklik ayrı branch'te (`ozellik/...`, `duzeltme/...`) yapılır ve PR ile birleşir.
- Commit öncesi `node build.js` çalışmalı ve hata vermemeli.
- PR açmadan önce `CHECKLIST.md`'deki kontroller yapılır.
- **Her değişiklikten sonra** Türkçe 3–5 maddelik bir "Ne değişti" özeti yaz; ortak bunu PR açıklaması olarak kullanır
  (şablon: `.github/pull_request_template.md`). DB alanı eklendiyse ya da migration varsa özette belirt.