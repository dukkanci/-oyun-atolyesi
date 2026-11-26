# Workshop (Atölye) Sistemi İyileştirmeleri - Tasarım Dokümanı

**Tarih:** 2026-01-26  
**Versiyon:** 1.0  
**Durum:** Onaylandı

---

## 1. Intent ve Amaç

Mevcut workshop (atölye) sisteminde şu sorunlar var:
1. Workshop'lar per-user localStorage'da saklanıyor → sayfa yenilendiğinde kayboluyor, başkaları göremiyor
2. Global paylaşım yok → herkes sadece kendi oluşturduklarını görüyor
3. Üye sayısı/online durumu yok
4. "Katıl" butonu yok → sadece oluşturulan atölyelere tıklanabiliyor
5. Atölyeler offline olunca kayboluyor

**Amaç:** Global, kalıcı, gerçek zamanlı workshop sistemi oluşturmak.

---

## 2. Hedefler, Non-Hedefler, Anti-Hedefler

### Hedefler
- ✅ Global `workshops` collection (Firebase + localStorage fallback)
- ✅ Tüm atölyeler lobide herkes tarafından görülebilir
- ✅ Her atölye için: üye sayısı (max 5), oluşturulma tarihi, "Katıl/Aç" butonu
- ✅ "Katıl" butonu: üye değilse "Katıl", üye ise "Aç" gösterir
- ✅ Dolu atölyelerde (5/5) "Katıl" disabled + "Dolu" yazısı
- ✅ Silme yetkisi: Oluşturan + Admin
- ✅ Real-time üye sayısı güncellemesi (Firebase onSnapshot)
- ✅ localStorage fallback (Firebase yoksa çalışır)

### Non-Hedefler
- ❌ Chat/voice chat atölye içinde (ayrı feature)
- ❌ Atölye içinde rol/yetki sistemi (sadece creator/admin)
- ❌ Atölye arama/filtreleme (ilk versiyon için)

### Anti-Hedefler
- ❌ Mevcut localStorage mimarisi bozulmamalı (fallback korunaklı)
- ❌ Firebase zorunlu olmamalı (localStorage fallback çalışmalı)
- ❌ Mevcut lobby UI bozulmamalı, sadece genişletilmeli

---

## 3. Kısıtlamalar

- Firebase/Supabase entegrasyonu zaten var → buna inşa edilecek
- localStorage fallback korunmalı (offline/online mod)
- Max üye sayısı: 5 (configurable)
- Silme yetkisi: Creator + Admin (settings'te `isAdmin` flag)
- Max üye sayısı: 5 (configurable, `maxMembers` field)

---

## 4. Yaklaşımlar ve Seçim

### Yaklaşım 1: Sadece Firebase (Reddedildi)
- ❌ Offline/online mod kırılır
- ❌ localStorage fallback kırılır

### Yaklaşım 2: Sadece localStorage + storage event (Reddedildi)
- ❌ Cross-tab sync zayıf
- ❌ Gerçek zamanlı üye sayısı zayıf
- ❌ Firebase altyapısı boşa gider

### Yaklaşım 3: Hybrid (Firebase + localStorage Fallback) ✅ **SEÇİLDİ**
- ✅ Firebase varsa: real-time, persistent, global
- ✅ Firebase yoksa: localStorage + storage event sync
- ✅ Mevcut altyapı korunur
- ✅ Offline/online mod çalışır

---

## 4. Veri Modeli

### Workshop Document (Firebase `workshops` collection / localStorage `atolye-global-workshops`)

```javascript
{
  id: "ws_timestamp_random",           // unique ID
  game: "Proje Fener",                  // atölye adı
  inviteToken: "abc123...",             // davet kodu
  createdBy: "user_abc123",             // oluşturucu userId
  createdAt: 1706284800000,             // timestamp
  updatedAt: 1706284800000,             // son güncelleme
  members: {                            // üye listesi
    "user_abc123": { joinedAt: 1706284800000, lastSeen: 1706288400000 },
    "user_def456": { joinedAt: 1706285000000, lastSeen: 1706288400000 }
  },
  memberCount: 2,                       // cache'li sayaç (hızlı okuma için)
  maxMembers: 5,                        // max üye sayısı (configurable)
  isDeleted: false                      // soft delete
}
```

### localStorage Key'ler
- `atolye-global-workshops` - global workshop listesi (fallback)
- `atolye-workshops` - per-user workshop cache (eski, korunaklı)

### Admin Flag
- `settings.isAdmin` boolean flag (settings collection'da)
- Veya `createdBy === S.meId` kontrolü

---

## 5. UI Değişiklikleri

### Lobide Workshop Listesi (renderLobby)
**Mevcut:** Sadece kullanıcının kendi atölyeleri
**Yeni:** Tüm global atölyeler

| Alan | Mevcut | Yeni |
|------|--------|------|
| Liste | Sadece user'ın atölyeleri | Tüm global atölyeler |
| Üye sayısı | Yok | `memberCount / maxMembers` (örn. "2/5") |
| Oluşturulma tarihi | Var | Var (güncellenmiş) |
| Buton | Sadece tıklama → aç | "Katıl" (üye değilse) / "Aç" (üye ise) |
| Doluluk | Yok | "Dolu" badge'i (5/5) + disabled |

**Buton Mantığı:**
```javascript
if (userIsMember) {
  button.text = "Aç";
  button.onclick = () => switchWorkshop(ws.id);
} else if (ws.memberCount >= ws.maxMembers) {
  button.text = "Dolu";
  button.disabled = true;
} else {
  button.text = "Katıl";
  button.onclick = () => joinWorkshop(ws.id);
}
```

### Silme Yetkisi
```javascript
const canDelete = ws.createdBy === S.meId || S.isAdmin;
```

---

## 6. Fonksiyonlar (API)

### Global Workshop Yönetimi
```javascript
// Global workshop listesi yükle (Firebase + fallback)
async function loadGlobalWorkshops()

// Global workshop kaydet (Firebase + fallback)
async function saveGlobalWorkshops(workshops)

// Firebase real-time listener başlat
function startGlobalWorkshopsListener()

// localStorage fallback sync
function setupLocalStorageSync()

// Workshop oluştur
async function createWorkshop(gameName)

// Workshop'a katıl
async function joinWorkshop(workshopId)

// Workshop'tan çık
async function leaveWorkshop(workshopId)

// Workshop sil (creator/admin)
async function deleteWorkshop(workshopId)

// Lobide render et
function renderLobby()
```

### Firebase Listener
```javascript
// workshops collection onSnapshot
// memberCount anlık güncellenir
// lobby UI real-time yenilenir
```

### localStorage Fallback
```javascript
// Key: atolye-global-workshops
// storage event → cross-tab sync
// Firebase yoksa otomatik aktif
```

---

## 7. Implementasyon Sırası

1. **Veri Modeli & Yardımcı Fonksiyonlar** - `createWorkshop`, `joinWorkshop`, `leaveWorkshop`, `deleteWorkshop`, `loadGlobalWorkshops`, `saveGlobalWorkshops`
2. **Firebase Listener** - `startGlobalWorkshopsListener()` real-time `onSnapshot`
3. **localStorage Fallback** - `atolye-global-workshops` key + `storage` event sync
4. **Lobi UI Güncelleme** - `renderLobby()`: üye sayısı, "Katıl/Aç" butonu, doluluk göstergesi
4. **Katılma/Çıkma/Silme İşlemleri** - `joinWorkshop()`, `leaveWorkshop()`, `deleteWorkshop()` (creator/admin kontrolü)
5. **Admin Flag** - Settings'e `isAdmin` field ekle veya `createdBy` kontrolü
5. **Admin Flag** - Settings'e `isAdmin` field ekle veya `createdBy` kontrolü
6. **Test & Doğrulama**

---

## 8. Başarım Kriterleri

- [ ] Yeni atölye oluşturulduğunda lobide görünür ve sayfa yenilendiğinde kalıcı
- [ ] Başka bir kullanıcı "Katıl" butonuna basıp katılabiliyor
- [ ] Üye sayısı real-time güncelleniyor (2/5, 3/5, vb.)
- [ ] Dolu atölyede (5/5) "Katıl" butonu disabled + "Dolu" yazıyor
- [ ] Oluşturan atölyeyi silebiliyor
- [ ] Admin atölyeyi silebiliyor
- [ ] Firebase yoksa localStorage fallback çalışıyor
- [ ] Mevcut localStorage verileri bozulmuyor (geriye uyumluluk)

---

## 8. Notlar

- Mevcut `atolye-workshops` (per-user) localStorage key'i korunacak, migration yapılmayacak
- Yeni global sistem `atolye-global-workshops` key'ini kullanacak
- Firebase `workshops` collection adı kullanılacak
- `maxMembers` default 5, ileride settings'ten değiştirilebilir
- Soft delete (`isDeleted: true`) kullanılacak, hard delete yok

---

*Bu doküman onaylandıktan sonra implementasyona geçilecektir.*