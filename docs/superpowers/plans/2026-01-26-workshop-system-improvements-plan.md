# Workshop Sistemi İyileştirmeleri Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Global, kalıcı, gerçek zamanlı workshop (atölye) sistemi oluşturmak - tüm kullanıcıların tüm atölyeleri görebileceği, üye sayısı/online durumu anlık görülebileceği, katılma/çıkma/silme işlemleri yapılabileceği sistem.

**Architecture:** Hybrid approach - Firebase `workshops` collection (real-time onSnapshot) + localStorage fallback (`atolye-global-workshops` key + storage event sync). Mevcut Firebase/Supabase entegrasyonu üzerine inşa edilir.

**Tech Stack:** Firebase Firestore (onSnapshot), localStorage (fallback), vanilla JS (app.js), existing build system (build.js)

**Spec:** `docs/superpowers/specs/2026-01-26-workshop-system-improvements-design.md`

## Global Constraints

- Mevcut `atolye-workshops` (per-user localStorage) key'i korunacak, migration yapılmayacak
- Yeni global sistem `atolye-global-workshops` localStorage key'ini kullanacak
- Firebase `workshops` collection adı kullanılacak
- `maxMembers` default 5, ileride settings'ten değiştirilebilir
- Soft delete (`isDeleted: true`) kullanılacak, hard delete yok
- Mevcut `atolye-workshops` (per-user) localStorage key'i korunacak, migration yapılmayacak
- Firebase/Supabase entegrasyonu zaten var → buna inşa edilecek
- localStorage fallback korunmalı (offline/online mod)
- Mevcut lobby UI bozulmamalı, sadece genişletilmeli

## Review Focus

1. **Workshop silme yetkisi** - Sadece creator ve admin silebilmeli, diğer üyeler silememeli
2. **Max üye limiti (5)** - Dolu atölyede "Katıl" butonu disabled + "Dolu" yazmalı
- ✅ **Veri modeli** - `workshops` collection: `{id, game, inviteToken, createdBy, createdAt, updatedAt, members, memberCount, maxMembers: 5, isDeleted}`
- ✅ **Real-time listener** - Firebase onSnapshot ile üye sayısı anlık güncellenmeli
- ✅ **localStorage fallback** - Firebase yoksa `atolye-global-workshops` + storage event sync çalışmalı
- ✅ **Silme yetkisi** - Creator (`createdBy`) veya Admin (`settings.isAdmin`) silebilmeli
- ✅ **Max üye limiti** - 5 üye dolunca "Katıl" disabled + "Dolu" yazmalı

---

### Task 1: Veri Modeli ve Yardımcı Fonksiyonlar (Global Workshop CRUD)

**Files:**
- Modify: `src/app.js:435-530` (Lobby/Workshop Management section)

**Interfaces:**
- Consumes: `S.db`, `S.meId`, `ls` (localStorage wrapper), `S.settings`
- Produces: `loadGlobalWorkshops()`, `saveGlobalWorkshops()`, `createWorkshop()`, `joinWorkshop()`, `leaveWorkshop()`, `deleteWorkshop()`, `loadGlobalWorkshops()`

- [ ] **Step 1: Write failing test for createWorkshop**

```javascript
// Test: createWorkshop creates workshop with correct structure
const workshop = await createWorkshop("Test Atölye");
assert(workshop.id.startsWith("ws_"));
assert(workshop.game === "Test Atölye");
assert(workshop.members[S.meId] !== undefined);
assert(workshop.memberCount === 1);
assert(workshop.maxMembers === 5);
```

- [ ] **Step 2: Run test to verify it fails**

Run: Manual browser console test
Expected: `createWorkshop` not updated yet

- [ ] **Step 3: Implement global workshop CRUD functions in `src/app.js`**

Replace existing `loadUserWorkshops`, `saveUserWorkshops`, `addWorkshopToUser`, `removeWorkshopFromUser`, `createWorkshop` with new global versions:
- `loadGlobalWorkshops()` - Firebase `workshops` collection + localStorage fallback
- `saveGlobalWorkshops(workshops)` - Firebase batch write + localStorage sync
- `createWorkshop(gameName)` - creates workshop with `members: {meId: {joinedAt, lastSeen}}`, `memberCount: 1`, `maxMembers: 5`
- `joinWorkshop(workshopId)` - adds user to members, increments memberCount
- `leaveWorkshop(workshopId)` - removes user from members, decrements memberCount
- `deleteWorkshop(workshopId)` - checks `createdBy === S.meId || S.isAdmin`, soft deletes

- [ ] **Step 4: Run test to verify it passes**

Run: Manual browser test - create workshop, verify appears in lobby, refresh page, verify persists

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat: global workshop CRUD with Firebase + localStorage fallback"
```

---

### Task 2: Firebase Real-Time Listener

**Files:**
- Modify: `src/app.js` (add new function `startGlobalWorkshopsListener`)

**Interfaces:**
- Consumes: `S.db`, `S.workshops`, `renderLobby`
- Produces: `startGlobalWorkshopsListener()` - real-time `onSnapshot` listener

- [ ] **Step 1: Write failing test for real-time listener**

```javascript
// Test: listener updates S.workshops and calls renderLobby on change
startGlobalWorkshopsListener();
// Simulate Firebase snapshot with new workshop
// Wait for renderLobby to be called
assert(renderLobbyCalled);
```

- [ ] **Step 2: Run test to verify it fails**

Run: Manual browser test
Expected: `startGlobalWorkshopsListener` not implemented

- [ ] **Step 3: Implement `startGlobalWorkshopsListener()` in `src/app.js`**

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: Manual browser test - open two tabs, create workshop in one, verify appears in other real-time

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat: real-time Firebase listener for global workshops"
```

---

### Task 3: localStorage Fallback + Cross-Tab Sync

**Files:**
- Modify: `src/app.js` (add fallback functions)

**Interfaces:**
- Consumes: `ls` (localStorage wrapper), `S.workshops`, `renderLobby`
- Produces: `loadGlobalWorkshops()`, `saveGlobalWorkshops()`, `setupLocalStorageSync()`

- [ ] **Step 1: Write failing test for localStorage fallback**

```javascript
// Test: when Firebase unavailable, localStorage used
S.db = null; // simulate no Firebase
await loadGlobalWorkshops();
assert(S.workshops.length >= 0); // loads from localStorage
```

- [ ] **Step 2: Run test to verify it fails**

Run: Manual browser test with network offline
Expected: Fallback not implemented

- [ ] **Step 3: Implement localStorage fallback in `src/app.js`**

```javascript
const GLOBAL_WORKSHOPS_KEY = "atolye-global-workshops";

function loadGlobalWorkshops() {
  if (S.db) return; // Firebase will handle via listener
  try {
    const stored = ls.get(GLOBAL_WORKSHOPS_KEY);
    S.workshops = stored ? JSON.parse(stored) : [];
  } catch (e) { S.workshops = []; }
  renderLobby();
}

function saveGlobalWorkshops(workshops) {
  if (S.db) return; // Firebase handles persistence
  try {
    ls.set(GLOBAL_WORKSHOPS_KEY, JSON.stringify(workshops));
  } catch (e) { warn("Global workshops save error:", e); }
}

function setupLocalStorageSync() {
  addSafeListener(window, "storage", e => {
    if (e.key === GLOBAL_WORKSHOPS_KEY && !S.db) {
      loadGlobalWorkshops();
    }
  }, {}, 'global-workshops-sync');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: Manual browser test - open two tabs, disable network, create workshop in one, verify appears in other

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat: localStorage fallback + cross-tab sync for global workshops"
```

---

### Task 4: Lobby UI Güncellemesi (renderLobby)

**Files:**
- Modify: `src/app.js:532-562` (renderLobby function)

**Interfaces:**
- Consumes: `S.workshops`, `S.meId`, `S.isAdmin`, `switchWorkshop`, `joinWorkshop`, `deleteWorkshop`
- Produces: Updated `renderLobby()` with member count, join/open buttons, delete button

- [ ] **Step 1: Write failing test for renderLobby**

```javascript
// Test: renderLobby shows member count and correct buttons
S.workshops = [{ id: "ws_1", game: "Test", memberCount: 2, maxMembers: 5, createdBy: "other_user", members: {} }];
renderLobby();
const items = document.querySelectorAll(".workshop-item");
assert(items.length === 1);
assert(items[0].textContent.includes("2/5")); // member count
assert(items[0].querySelector("button").textContent === "Katıl"); // not member
```

- [ ] **Step 2: Run test to verify it fails**

Run: Manual browser test
Expected: Current renderLobby doesn't show member count or join buttons

- [ ] **Step 3: Update `renderLobby()` in `src/app.js`**

```javascript
function renderLobby() {
  const box = $("lobby-workshops");
  if (!box) return;

  if (S.workshops.length === 0) {
    box.innerHTML = '<div class="empty">Henüz atölye yok. Yeni atölye oluşturun veya davet koduyla katılın.</div>';
    return;
  }

  box.innerHTML = '';
  for (const ws of S.workshops) {
    if (ws.isDeleted) continue; // skip deleted
    
    const isMember = ws.members && ws.members[S.meId];
    const isCreator = ws.createdBy === S.meId;
    const isAdmin = S.isAdmin;
    const canDelete = isCreator || isAdmin;
    const isFull = ws.memberCount >= (ws.maxMembers || 5);
    
    const item = h("div", { class: "workshop-item" },
      h("div", { class: "workshop-info" },
        h("div", { class: "workshop-name" }, ws.game),
        h("div", { class: "workshop-meta" },
          `Üyeler: ${ws.memberCount}/${ws.maxMembers || 5}`,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: Manual browser test - verify member count, "Katıl"/"Aç" buttons, "Dolu" badge, delete button visibility

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat: lobby UI with member count, join/open buttons, delete button"
```

---

### Task 5: Katılma/Çıkma/Silme İşlemleri

**Files:**
- Modify: `src/app.js` (add `joinWorkshop`, `leaveWorkshop`, `deleteWorkshop`)

**Interfaces:**
- Consumes: `S.db`, `S.meId`, `S.workshops`, `saveGlobalWorkshops`
- Produces: `joinWorkshop(workshopId)`, `leaveWorkshop(workshopId)`, `deleteWorkshop(workshopId)`

- [ ] **Step 1: Write failing test for joinWorkshop**

```javascript
// Test: joinWorkshop adds user to members and increments count
const ws = S.workshops[0];
const initialCount = ws.memberCount;
await joinWorkshop(ws.id);
const updated = S.workshops.find(w => w.id === ws.id);
assert(updated.members[S.meId] !== undefined);
assert(updated.memberCount === initialCount + 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: Manual browser test
Expected: Functions not implemented

- [ ] **Step 3: Implement join/leave/delete in `src/app.js`**

```javascript
async function joinWorkshop(workshopId) {
  if (!S.meId) return;
  const ws = S.workshops.find(w => w.id === workshopId);
  if (!ws) return;
  if (ws.members[S.meId]) return; // already member
  if (ws.memberCount >= (ws.maxMembers || 5)) { toast("Atölye dolu!"); return; }
  
  ws.members[S.meId] = { joinedAt: Date.now(), lastSeen: Date.now() };
  ws.memberCount = Object.keys(ws.members).length;
  ws.updatedAt = Date.now();
  
  if (S.db) {
    await S.db.collection("workshops").doc(workshopId).update({
      members: ws.members,
      memberCount: ws.memberCount,
      updatedAt: ws.updatedAt
    });
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
    await S.db.collection("workshops").doc(workshopId).update({
      members: ws.members,
      memberCount: ws.memberCount,
      updatedAt: ws.updatedAt
    });
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
    await S.db.collection("workshops").doc(workshopId).update({
      isDeleted: true,
      updatedAt: ws.updatedAt
    });
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: Manual browser test - join workshop, verify member count increases, leave workshop, verify decreases, delete as creator, verify removed

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat: join/leave/delete workshop with creator/admin permissions"
```

---

### Task 6: Admin Flag ve Settings Entegrasyonu

**Files:**
- Modify: `src/app.js` (settings listener, isAdmin flag)
- Modify: `src/body.html` (admin UI in settings if needed)

**Interfaces:**
- Consumes: `S.settings`, `S.meId`
- Produces: `S.isAdmin` flag

- [ ] **Step 1: Write failing test for isAdmin**

```javascript
// Test: isAdmin flag set from settings
S.settings = { isAdmin: true };
updateAdminFlag();
assert(S.isAdmin === true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: Manual browser test
Expected: isAdmin not implemented

- [ ] **Step 3: Implement admin flag in `src/app.js`**

```javascript
// In settings listener (around line 412):
db.doc("team/settings").onSnapshot(snap => {
  S.settings = snap.exists ? toCamelCase(snap.data()) : null;
  S.isAdmin = S.settings?.isAdmin === true && S.meId === S.settings?.adminUserId;
  route();
}, () => show("s-noaccess"));
```

Also add `isAdmin` to default settings if not present.

- [ ] **Step 4: Run test to verify it passes**

Run: Manual browser test - set isAdmin in Firebase, verify delete button shows for non-creator

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat: admin flag for workshop deletion permissions"
```

---

### Task 7: Build, Test ve Doğrulama

**Files:**
- Build: `node build.js`
- Test: Manual browser testing

**Interfaces:**
- Consumes: All previous tasks
- Produces: Working deployed version

- [ ] **Step 1: Build the project**

```bash
node build.js
```
Expected: Success, dist/index.html generated

- [ ] **Step 2: Manual integration testing**

Test scenarios:
1. Create workshop → verify appears in lobby, refresh → persists
2. Open second tab/browser → create workshop in one → appears in other real-time
3. Join workshop → member count increases (2/5) → "Aç" button appears
4. Fill workshop to 5/5 → "Katıl" button disabled + "Dolu" badge
5. Leave workshop → member count decreases
6. Delete as creator → workshop removed from all tabs
7. Delete as admin → workshop removed
8. Non-creator/non-admin → no delete button
9. Offline mode (disable network) → localStorage fallback works
10. Cross-tab sync → storage event works

- [ ] **Step 3: Build and deploy**

```bash
node build.js
git add dist/index.html
git commit -m "build: updated dist for workshop improvements"
git push origin main
```

- [ ] **Step 4: Verify production deployment**

Visit: https://dukkanci.github.io/-oyun-atolyesi/efsane-proje/
Verify all test scenarios work in production

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete workshop system improvements - global, real-time, persistent"
git push origin main
```

---

## Execution Notes

**Recommended execution approach:** Native (I implement in this session)
- Tasks are highly dependent on shared interfaces (S.workshops, S.db, ls)
- Small number of focused tasks (7)
- Shared state management makes subagent coordination complex
- Can verify each task manually in browser as I go

**Estimated effort:** ~2-3 hours for complete implementation

**Risk areas:**
- Firebase listener cleanup on logout/route change
- Race conditions in join/leave (use transactions or server timestamps)
- localStorage quota limits (workshops + settings + notes)
- Cross-tab sync timing issues