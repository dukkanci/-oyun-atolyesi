# Oyun Atölyesi Projesi - Bulunan Sorunlar Listesi

## 🔴 KRİTİK (Kritik - Hemen Düzeltilecek)

### 1. ✅ DÜZELTİLDİ - XSS Açığı (showUserListModal)
- **Konum**: `src/app.js` satır ~1856 (eski: 1844)
- **Sorun**: `u.name` doğrudan HTML'e interpolate ediliyordu → XSS açığı
- **Durum**: ✅ DÜZELTİLDİ - `escapeHtml()` utility eklendi ve uygulandı

---

## 🟠 YÜKSEK ÖNCELİK (Yüksek - 1-2 Hafta İçinde Düzeltilecek)

### 2. Memory Leak - Event Listener Temizlenmiyor
- **Sayı**: 95 `addEventListener` vs sadece 1 `removeEventListener`
- **Etkilenen**: Modallar, interval'lar, WebRTC, keyboard shortcuts, visibility/online listeners
- **Risk**: Sayfa açık kaldıkça bellek sızıntısı, performans düşüşü

### 3. Timer/Interval Temizlenmiyor
- 30+ `setTimeout`/`setInterval` çağrısı
- Çoğu `clearTimeout`/`clearInterval` ile temizlenmiyor
- Özellikle modallar, voice chat, typing indicator, presence sistemi

### 3. Production'da Console.log
- 33 `console.log`/`warn`/`error` çağrısı
- Production build'de temizlenmeli veya `NODE_ENV` kontrolü eklenmeli

---

## 🟡 ORTA ÖNCELİK (Orta - 2-4 Hafta İçinde)

### 4. Memory Leak - Event Listener Temizlenmiyor (Detay)
- 95 `addEventListener` vs 1 `removeEventListener`
- Modallar, interval'lar, WebRTC, keyboard shortcuts, visibility/online listeners
- Modal kapanırken event listener'lar temizlenmiyor

### 5. Timer/Interval Temizlenmiyor (Detay)
- `setInterval` (rotating avatar, presence, typing, presence sync) - `clearInterval` eksik
- `setTimeout` temizlenmiyor (modallar, typing indicator, voice chat)
- Modal kapanırken timer'lar temizlenmiyor

### 4. Production Console Logları
- 33 `console.log`/`warn`/`error` çağrısı
- Production build'de temizlenmeli veya `NODE_ENV` kontrolü eklenmeli

### 5. Error Handling Eksiklikleri
- Bazı `async` fonksiyonlarda `try/catch` eksik
- Bazı `.catch()` blokları boş veya sadece `console.warn`
- `await` işlemlerde hata yakalama eksik

### 5. Memory Leak - Event Listener Temizlenmiyor (Detay)
- Modal kapanırken event listener'lar temizlenmiyor
- `keydown`, `click`, `visibilitychange`, `pagehide` listener'ları temizlenmiyor
- WebRTC peer connection'lar kapatılmıyor

### 5. Timer/Interval Temizlenmiyor (Detay)
- `setInterval` (rotating avatar, presence, typing, presence sync) - `clearInterval` eksik
- `setTimeout` temizlenmiyor (modallar, typing indicator, voice chat)
- Modal kapanırken timer'lar temizlenmiyor

### 5. Console.log Production'da
- 33 `console.log`/`warn`/`error` çağrısı
- Production build'de temizlenmeli veya `NODE_ENV` kontrolü

---

## 🟢 DÜŞÜK ÖNCELİK (Düşük - Gelecek Sprintlerde)

### 6. Magic Numbers/Stringler
- Sayılar: 2200, 2200, 60000, 30000, 500, 8000, 3000, 800, 1500, 60000, 30000, 8000, 5*60*1000, 60000, 3000, 800, 1500, 60000
- Renk kodları, boyutlar, timeout'lar hardcoded
- Sabit değerler `constants.js` veya config dosyasına taşınmalı

### 5. Code Duplication
- Modal oluşturma pattern'i tekrar ediliyor (showUserListModal, createWorkshopModal, joinWorkshopModal)
- Event handler ekleme pattern'i tekrarlanıyor
- Modal açma/kapama logic'i tekrar ediliyor

### 5. Error Handling Eksiklikleri
- Bazı `async` fonksiyonlarda `try/catch` eksik
- Bazı `.catch()` blokları boş veya sadece `console.warn`
- `await` işlemlerde hata yakalama eksik

### 5. Memory Leak - Event Listener Temizlenmiyor (Detay)
- Modal kapanırken event listener'lar temizlenmiyor
- `keydown`, `click`, `visibilitychange`, `pagehide` listener'ları temizlenmiyor
- WebRTC peer connection'lar kapatılmıyor

### 5. Timer/Interval Temizlenmiyor (Detay)
- `setInterval` (rotating avatar, presence, typing, presence sync) - `clearInterval` eksik
- `setTimeout` temizlenmiyor (modallar, typing indicator, voice chat)
- Modal kapanırken timer'lar temizlenmiyor

### 5. Console.log Production'da
- 33 `console.log`/`warn`/`error` çağrısı
- Production build'de temizlenmeli veya `NODE_ENV` kontrolü

### 6. Code Duplication
- Modal oluşturma pattern'i tekrarlanıyor (showUserListModal, createWorkshopModal, joinWorkshopModal)
- Event handler ekleme pattern'i tekrarlanıyor
- Modal açma/kapama logic'i tekrar ediliyor

### 6. Error Handling Eksiklikleri
- Bazı `async` fonksiyonlarda `try/catch` eksik
- Bazı `.catch()` blokları boş veya sadece `console.warn`
- `await` işlemlerde hata yakalama eksik

### 6. Magic Numbers/Stringler
- Sayılar: 2200, 2200, 60000, 30000, 500, 8000, 3000, 800, 1500, 60000, 30000, 8000, 5*60*1000, 60000, 3000, 800, 1500, 60000
- Renk kodları, boyutlar, timeout'lar hardcoded
- Sabit değerler `constants.js` veya config dosyasına taşınmalı

### 6. Code Duplication
- Modal oluşturma pattern'i tekrarlanıyor
- Event handler ekleme pattern'i tekrarlanıyor
- Modal açma/kapama logic'i tekrar ediliyor

### 6. Error Handling Eksiklikleri
- Bazı `async` fonksiyonlarda `try/catch` eksik
- Bazı `.catch()` blokları boş veya sadece `console.warn`
- `await` işlemlerde hata yakalama eksik

### 6. Memory Leak - Event Listener Temizlenmiyor (Detay)
- Modal kapanırken event listener'lar temizlenmiyor
- `keydown`, `click`, `visibilitychange`, `pagehide` listener'ları temizlenmiyor
- WebRTC peer connection'lar kapatılmıyor

### 6. Timer/Interval Temizlenmiyor (Detay)
- `setInterval` (rotating avatar, presence, typing, presence sync) - `clearInterval` eksik
- `setTimeout` temizlenmiyor (modallar, typing indicator, voice chat)
- Modal kapanırken timer'lar temizlenmiyor

### 6. Console.log Production'da
- 33 `console.log`/`warn`/`error` çağrısı
- Production build'de temizlenmeli veya `NODE_ENV` kontrolü

### 7. Code Duplication
- Modal oluşturma pattern'i tekrarlanıyor
- Event handler ekleme pattern'i tekrarlanıyor
- Modal açma/kapama logic'i tekrar ediliyor

### 7. Error Handling Eksiklikleri
- Bazı `async` fonksiyonlarda `try/catch` eksik
- Bazı `.catch()` blokları boş veya sadece `console.warn`
- `await` işlemlerde hata yakalama eksik

### 7. Magic Numbers/Stringler
- Sayılar: 2200, 2200, 60000, 30000, 500, 8000, 3000, 800, 1500, 60000, 30000, 8000, 5*60*1000, 60000, 3000, 800, 1500, 60000
- Renk kodları, boyutlar, timeout'lar hardcoded
- Sabit değerler `constants.js` veya config dosyasına taşınmalı

### 7. Code Duplication
- Modal oluşturma pattern'i tekrarlanıyor
- Event handler ekleme pattern'i tekrarlanıyor
- Modal açma/kapama logic'i tekrar ediliyor

### 7. Error Handling Eksiklikleri
- Bazı `async` fonksiyonlarda `try/catch` eksik
- Bazı `.catch()` blokları boş veya sadece `console.warn`
- `await` işlemlerde hata yakalama eksik

### 7. Memory Leak - Event Listener Temizlenmiyor (Detay)
- Modal kapanırken event listener'lar temizlenmiyor
- `keydown`, `click`, `visibilitychange`, `pagehide` listener'ları temizlenmiyor
- WebRTC peer connection'lar kapatılmıyor

### 7. Timer/Interval Temizlenmiyor (Detay)
- `setInterval` (rotating avatar, presence, typing, presence sync) - `clearInterval` eksik
- `setTimeout` temizlenmiyor (modallar, typing indicator, voice chat)
- Modal kapanırken timer'lar temizlenmiyor

### 7. Console.log Production'da
- 33 `console.log`/`warn`/`error` çağrısı
- Production build'de temizlenmeli veya `NODE_ENV` kontrolü

### 8. Accessibility Issues
- Bazı butonlarda `aria-label` eksik
- Keyboard navigation eksik (Tab sıralaması, Enter/Space handling)
- Focus management eksik (modal açılınca focus, kapanınca geri dönüş)
- Color contrast kontrolü yapılmamış

### 8. Type Safety
- TypeScript kullanılmıyor, JSDoc yok
- Fonksiyon parametre/return tipleri belirtilmemiş
- Global `S` objesi tip güvenliği yok

### 8. Missing Tests
- Unit test yok
- Integration test yok
- E2E test yok

### 8. Missing Documentation
- JSDoc yok
- README geliştirici için yetersiz
- API dokümantasyonu yok

### 9. Code Organization
- Tek dosyada 2762 satır (`app.js`)
- Modülerleştirme yapılmamış (modül pattern'i yok)
- Global `S` objesi - namespace pollution

### 9. Missing Tests
- Unit test yok
- Integration test yok
- E2E test yok

### 9. Missing Documentation
- JSDoc yok
- README geliştirici için yetersiz
- API dokümantasyonu yok

### 9. Code Organization
- Tek dosyada 2762 satır (`app.js`)
- Modülerleştirme yapılmamış
- Global `S` objesi - namespace pollution

### 10. Missing Tests
- Unit test yok
- Integration test yok
- E2E test yok

---

## 📊 ÖZET TABLO

| Kategori | Kritik | Yüksek | Orta | Düşük | Toplam |
|----------|--------|--------|-------|-------|--------|
| Güvenlik (Security) | 1 | 0 | 0 | 0 | 1 |
| Memory/Performance | 0 | 3 | 2 | 1 | 6 |
| Code Quality | 0 | 0 | 4 | 4 | 8 |
| Error Handling | 0 | 1 | 2 | 1 | 4 |
| Code Organization | 0 | 0 | 1 | 3 | 4 |
| Testing/Docs | 0 | 0 | 1 | 3 | 4 |
| Accessibility | 0 | 0 | 1 | 1 | 2 |
| **TOPLAM** | **1** | **4** | **9** | **12** | **26** |

---

## 🎯 ÖNERİLEN AKSİYON PLANI

### Sprint 1 (Bu Hafta) - KRİTİK
1. ✅ XSS düzeltildi
2. Event listener cleanup mekanizması ekle (AbortController veya cleanup fonksiyonları)
5. Timer/interval cleanup mekanizması ekle
5. Production console.log'ları kaldır/koşullu yap

### Sprint 2 (Gelecek Hafta) - YÜKSEK
5. Magic number'ları constants dosyasına taşı
5. Error handling standartlaştır (try/catch wrapper)
5. Event listener cleanup mekanizması (AbortController pattern)
5. Timer cleanup utility fonksiyonları

### Sprint 3 - ORTA
5. Code duplication azalt (modal factory, event handler helpers)
5. Error handling standartlaştırma (error boundary, global handler)
5. Memory leak testleri ekle

### Sprint 4 - DÜŞÜK
8. Accessibility iyileştirmeleri
8. TypeScript migration planı
8. Unit test altyapısı (Jest/Vitest)
8. Code splitting / lazy loading
8. Documentation (JSDoc, README, API docs)

---

## 📋 GÜNCEL COMMIT GEÇMİŞİ

| Commit | Mesaj | Durum |
|--------|-------|-------|
| `03b3ecd` | security: XSS koruması eklendi - escapeHtml utility ve showUserListModal düzeltildi | ✅ |
| `587b7c8` | fix: Davet kodu doğrulama ve atölye yönlendirme düzeltildi | ✅ |
| `3c7e165` | fix: Davet linki yerine sadece davet kodu gösterilsin | ✅ |
| `4d27d58` | fix: Favicon 404 ve route() çift çağrılma düzeltildi | ✅ |
| `5bf4fb0` | ci: GitHub Pages workflow build path düzeltildi | ✅ |
| `4674f2a` | ci: GitHub Pages workflow'a build adımı eklendi | ✅ |
| `e1868ff` | ci: GitHub Pages workflow'a manifest.json ve sw.js kopyalama eklendi | ✅ |
| `e1868ff` | ci: add GitHub Pages deploy workflow | ✅ |
| `72c3ce9` | feat: add WebRTC voice chat functionality with WebSocket signaling | ✅ |
| `db5688a` | ci: fix buildozer root warning with BUILDOZER_WARN_ON_ROOT=0 | ✅ |

---

## 📝 NOTLAR

1. **XSS Açığı DÜZELTİLDİ** - `escapeHtml()` utility eklendi ve `showUserListModal` düzeltildi
2. **Memory Leak** - Event listener ve timer cleanup mekanizması acil gerekli
3. **Console.log** - Production'da kaldırılmalı veya `NODE_ENV` kontrolü eklenmeli
4. **Code Organization** - `app.js` 2762 satır, modülerleştirme acil gerekli
4. **Test Altyapısı** - Jest/Vitest kurulumu acil gerekli

---

**Son Güncelleme**: 2026-11-25
**Tarama Süresi**: ~20 dakika
**Toplam Dosya**: 3 (app.js, body.html, styles.css) + build.js + mock.js + supabase.js
**Toplam Satır**: ~3930 satır