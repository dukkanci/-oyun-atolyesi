# Oyun Atölyesi

Ortak proje platformumuz. Projelerimizi bu repoda geliştiriyoruz.

İki kişilik ekibin oyun fikirlerini, notlarını, sohbetini ve build'lerini paylaştığı tek sayfalık uygulama.
claude.ai'de Artifact olarak yayınlanır: https://claude.ai/artifact/2Nu6jwwvTJm4daV6HsrwyD

> Not: Sayfa claude.ai Artifact çalışma ortamını (paylaşılan veritabanı, dosya deposu vb.) kullanır;
> `dist/index.html` doğrudan tarayıcıda açıldığında bu özellikler çalışmaz.

`main` dalı = yayındaki sürüm. Proje yapısı, veritabanı alanları ve kurallar için **[CLAUDE.md](CLAUDE.md)**'ye bak.

## Yayın dosyasını üretmek

Gerekli olan tek şey [Node.js](https://nodejs.org) (18 veya üstü). `npm install` gerekmez.

```
node build.js
```

ya da

```
npm run build
```

Bu komut `src/` içindeki dosyaları birleştirip **`dist/index.html`** dosyasını üretir. Yayınlanacak dosya budur.
Build, dış script'lerin izinli kaynaktan ve sabit sürümle geldiğini ve localStorage dışında tarayıcı depolaması
kullanılmadığını da denetler. Bir kural bozulursa Türkçe hata verir ve dosya yazmaz.

Sadece denetim için: `node build.js --check` (veya `npm run check`).

`dist/` repoya girmez. Her zaman `src/` içindeki dosyaları düzenle, sonra build al.

## Yayınlamak

1. Değişiklik PR ile `main`'e birleşmiş olmalı.
2. `main`'i çek, `node build.js` çalıştır.
3. [CHECKLIST.md](CHECKLIST.md)'deki kontrolleri yap.
4. Claude Code'a "dist/index.html'i https://claude.ai/artifact/2Nu6jwwvTJm4daV6HsrwyD adresine yayınla" de.
   Adres verilmezse yeni bir sayfa oluşur ve ekip eski sayfada kalır.

## Çalışma düzeni: branch + PR

```
git checkout main
git pull
git checkout -b ozellik/kisa-aciklama      # ya da duzeltme/...
# src/ içinde değişiklik yap
node build.js
git add -A
git commit -m "Kısa açıklama"
git push -u origin ozellik/kisa-aciklama
gh pr create --base main --fill            # ya da GitHub sitesinden "Compare & pull request"
```

PR açıklaması şablondan gelir (`.github/pull_request_template.md`): 3–5 maddelik "Ne değişti" özeti ve kontrol listesi.
Diğer kişi PR'a bakar, sorun yoksa **Merge** eder. Sonra yayın yapılır.

## Ortağı repoya eklemek (collaborator)

Repo sahibi (`dukkanci`) yapar:

1. https://github.com/dukkanci/-oyun-atolyesi → **Settings** → **Collaborators** (sol menü, "Access" altında).
2. **Add people** → ortağın GitHub kullanıcı adını ya da e-postasını yaz → **Add to repository**.
3. Ortağa e-posta ile davet gider. Davet https://github.com/dukkanci/-oyun-atolyesi/invitations adresinden de
   kabul edilebilir. Kabul edince yazma (push) yetkisi olur.
4. Ortak kendi bilgisayarında:
   ```
   git clone https://github.com/dukkanci/-oyun-atolyesi.git
   cd -oyun-atolyesi
   node build.js
   ```

**İsteğe bağlı, önerilir: `main`'e doğrudan push'u kapatmak.** Settings → **Branches** → **Add branch protection rule**
(ya da **Rules → Rulesets**) → Branch name pattern: `main` → **Require a pull request before merging** işaretle → **Create**.
Not: Ücretsiz planda özel (private) repolarda bu koruma çalışmayabilir. O durumda kural sadece anlaşmayla uygulanır:
`main`'e doğrudan push yapılmaz.
