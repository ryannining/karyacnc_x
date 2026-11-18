# Rencana Implementasi — Jalur Tol "JOB" di KaryaCNC (JSON terstruktur)

> **Kepada:** AI implementer di repo **KaryaCNC** (folder ini).
> **Tujuan:** membuat **jalur tol** (fast lane) penerimaan job **terstruktur (JSON)** di KaryaCNC, menggantikan konversi berlebihan jalur teks warisan (Inkscape→extension). Model JOB **lengkap** (mampu menampung semua semantik jalur Inkscape yang sudah ada), sementara MiniSketch mengirim **subset** — field yang tidak dikirim memakai default. Jalur teks lama tetap dipertahankan (backward-compatible).
> **Status:** rencana matang (belum implementasi).

## ⚡ PRIORITAS TERBARU (fokus internal dulu)

**Ruang lingkup sekarang: murni internal frontend KaryaCNC.**
- Tujuan utama yang dikejar: **optimasi saat pindah-pindah job history** — begitu history memakai format **JOB (JSON)** terstruktur, restore **tidak perlu lagi parse teks protokol** (`pathstoText1`).
- Inkscape tetap mengirim teks; teks itu dikonversi **sekali** ke JOB saat ingest, lalu disimpan & dipulihkan sebagai JOB.
- **Defer (bukan sekarang):** backend JSON detection (`SKETCH_JOB_RECEIVED`), sender MiniSketch, multi-frame, gambar besar. Unit-area dibuka setelah internal stabil.
- Urutan kerja: **F2 → F3 → F4** (frontend), barulah **F1 → F5** (backend & MiniSketch) saat dibutuhkan.

---

## 0. Kompas (apa yang kita bangun)

```
                    ┌────────────────────────────────────────┐
 Inkscape text ───► │ pathstoText1 (lama)                     │
 (legacy, dipertahankan) │  └─(refactor)─► jobFromInkscapeText() │
                    └───────────────────┬────────────────────┘
                                        │  JOB (kanonik, JSON)
 MiniSketch JSON ───► jobFromMiniSketchJSON() ──┘
                                        │
                                        ▼
                               ┌─────────────────┐
                               │ hydrateJob(job)  │ → parsedGeometryData + gcstyle
                               │ (satu titik masuk)│   + ink_images + engravebounds
                               └────────┬────────┘   + cuttabs/starttabs
                                        ▼
                               myFunction() fast-path → G-code
```

Prinsip: **satu model JOB kanonik, satu jalur hydrate, dua adapter masukan** (Inkscape text, MiniSketch JSON). History menyimpan JOB.

---

## 1. Model JOB (kanonik)

Representasi lengkap yang menangkap seluruh semantik jalur Inkscape sekarang.

### 1.1 Skema JSON

```jsonc
{
  "version": 1,
  "source": "minisketch" | "inkscape",      // asal
  "origin": { "x": 0, "y": 0 },             // origin bbox (mm)
  "units": "mm",
  "paths": [
    {
      "id": "p1",
      "op": "cut" | "engrave" | "vcarve" | "pocket" | "mark"
          | "cut_tab" | "start_point" | "clip" | "travel",
      "sub": null | "half_dpi",              // hanya untuk engrave
      "depth": 3.0 | null,                   // mm; null = pakai default profile
      "fill": "none" | "flip" | "gray" | "yellow",
      "toolWidth": 0 | null,                 // stroke-width (tool diameter)
      "closed": true,
      "pts": [[0,0],[10,0],[10,10]]
    }
  ],
  "images": [
    {
      "src": "data:image/png;base64,...",
      "x": 0, "y": 0, "w": 20, "h": 20,
      "transform": null
    }
  ],
  "specials": {
    "cutTabs": [[[x1,y1],[x2,y2]], ...],      // segmen 2 titik
    "startTabs": [[[x1,y1],[x2,y2]], ...],
    "engraveBounds": [[[x,y], ...], ...]      // poligon area clip
  }
}
```

### 1.2 Pemetaan semantik (dari encoding lama → JOB)

| Warisan (teks/warna) | JOB |
|---|---|
| stroke `#000000` | `op:"cut"` |
| stroke `#0000ff` | `op:"engrave"`, `sub:null` |
| stroke `#008080` poligon | `op:"engrave"`, `sub:"half_dpi"` |
| stroke `#00ffff` | `op:"vcarve"` |
| stroke `#800080` | `op:"pocket"` |
| stroke `#ff0000` | `op:"mark"` |
| stroke `#800000` (2 titik) | `op:"cut_tab"` |
| stroke `#008080` (2 titik) | `op:"start_point"` |
| stroke `#ffff00` | `op:"clip"` |
| stroke `#00ff00` | `op:"travel"` |
| stroke `#008000` | `op:"travel"`, fill `gray` |
| byte hijau di stroke (CNC) | `depth = parseInt("0x"+GG)*0.1` |
| fill `#ffff00` | `fill:"yellow"` (flip offset) |
| fill `#808000` | `fill:"gray"` |
| closed (tebak toleransi) | `closed` eksplisit |
| `I,x,y,w,h` + base64 | `images[]` |
| `X:scale` | `origin`/`units` |

### 1.3 Default jika field tidak dikirim (kemungkinan MiniSketch)
- `depth:null` → gunakan default material profile saat emit.
- `toolWidth:null` → default tool.
- `specials` kosong → tidak ada tab/clip.
- `fill:"none"` → tanpa flip offset.
- `sub` null → engrave resolusi penuh.

---

## 2. Protokol jalur tol (WebSocket)

### 2.1 Deteksi mode
- Frame pertama koneksi:
  - diawali `{` **dan** berisi `"type":"job"` → mode JSON (jalur tol).
  - selain itu → mode teks legacy (buffer + `>REVECTOR2`) — **tidak berubah**.
- `upgrader` & endpoint root tidak berubah; hanya logika `handleConnection` yang ditambah cabang.

### 2.2 Framing
- Kirim **satu frame JSON** utuh per job (atau chunk untuk payload besar, lihat §2.4).
- Backend batasi ukuran (mis. 64MB) untuk keamanan.
- **ACK** dikirim setelah job berhasil di-parse & di-emit.

### 2.3 Contoh payload MiniSketch (subset)
```json
{
  "type": "job", "version": 1, "source": "minisketch",
  "origin": { "x": 0, "y": 0 },
  "paths": [
    { "op": "cut", "depth": 3, "closed": true, "pts": [[0,0],[10,0],[10,10],[0,10]] },
    { "op": "mark", "closed": false, "pts": [[20,20],[30,20]] }
  ],
  "images": []
}
```

### 2.4 Payload besar (gambar)
- Untuk `images[]` dengan base64 besar: izinkan **multi-frame** dengan skema sederhana:
  - frame pertama `{"type":"job","partial":true,"seq":0,"total":N,...}`
  - frame lanjutan `{"type":"job-part","seq":k,"data":"<b64 chunk>"}`
  - frame akhir `{"type":"job-part","seq":N-1,"final":true}`
- Atau cukup kirim mix JSON; **rekomendasi tahap awal**: kirim semua dalam satu frame (batasi ukuran gambar), multi-frame hanya jika data. Sederhanakan dahulu.

---

## 3. Backend (Go, `app.go`)

### 3.1 Struct
```go
type Job struct {
    Version  int      `json:"version"`
    Source   string   `json:"source"`
    Origin   Point    `json:"origin"`
    Units    string   `json:"units"`
    Paths    []JobPath `json:"paths"`
    Images   []JobImage `json:"images"`
}
type JobPath struct {
    ID string `json:"id"` Op string `json:"op"`
    Sub string `json:"sub"` Depth *float64 `json:"depth"`
    Fill string `json:"fill"` ToolWidth float64 `json:"toolWidth"`
    Closed bool `json:"closed"` Pts [][2]float64 `json:"pts"`
}
type JobImage struct { Src string `json:"src"` X,Y,W,H float64 `json:"x,y,w,h"` Transform string `json:"transform"` }
```

### 3.2 `handleConnection` — cabang baru
```go
if strings.HasPrefix(text, "{") && strings.Contains(text, `"type":"job"`) {
    var job Job
    if err := json.Unmarshal([]byte(text), &job); err != nil { … }
    a.emit("SKETCH_JOB_RECEIVED", job)   // event baru
    conn.WriteMessage(websocket.TextMessage, []byte("ACK"))
    continue
}
// … jalur legacy tidak berubah (buffer + >REVECTOR2) …
```

### 3.3 Tambahan
- Validasi minimal (ukuran, tipe), batas panjang, `sync.Mutex` bila perlu.
- Jangan simpan job di backend — langsung emit ke frontend (seperti `WS_MESSAGE_RECEIVED`).

---

## 4. Frontend KaryaCNC (JS)

### 4.1 Adapter masukan (menghasilkan JOB)
- `jobFromInkscapeText(buff)` — **refactor** dari logika `pathstoText1` agar *mengembalikan JOB* (bukan langsung mengisi global). Perilaku output G-code **identik**.
- `jobFromMiniSketchJSON(payload)` — baru; field opsional diisi default (§1.3).

### 4.2 `hydrateJob(job)` — satu titik masuk
Mengubah JOB → apa yang dikonsumsi mesin (target global):
- `parsedGeometryData[]` = `{points, closed, flip, sty}`
- `gcstyle[]` — bangun via fungsi murni `styFromOp(op, sub, depth, fill, toolWidth)` (faktor keluar dari sniff hex).
- `ink_images[]`, `engravebounds[]`, `cuttabs[]`/`starttabs[]` — dari `job.images` & `job.specials`.
- **Flag per sumber:** untuk `source:"minisketch"` **lewati** join/chain/dedupe/heavy-cleanup (data sudah bersih, `closed` eksplisit). Untuk `"inkscape"` pertahankan pemrosesan lama.

### 4.3 Pipe
- `myFunction()` fast-path sudah membaca `parsedGeometryData` — **tidak perlu diubah**.
- `refreshgcode()` tetap sama.

### 4.4 History (unifikasi)
- Simpan **JOB** + settings (bukan teks mentah).
- `loadHistoryIndex` → `hydrateJob(job)` langsung (tanpa `pathstoText1`).
- **Migrasi sekali jalan:** entri history lama (teks) terdeteksi → parse sekali → tulis sebagai JOB.

---

## 5. Backward compatibility & jaminan

- Jalur teks Inkscape (`>REVECTOR2`, `WS_MESSAGE_RECEIVED`) **tetap ada**, tidak disentuh.
- Inkscape tetap bisa kirim penuh; sekarang *internal*-nya juga jadi JOB → benefit yang sama (history terstruktur) tanpa mengubah ekstensi.
- MiniSketch lama (mengirim teks) tetap diterima selama memakai protokol teks lama. Jalur tol hanya **alternatif** yang lebih cepat.

---

## 6. Mikro-optimasi transfer (mengapa lebih cepat)

1. **Tanpa serialisasi teks + tanpa re-parse** (`pathstoText1` tidak dijalankan untuk jalur tol).
2. **JSON compact** lebih ringkas daripada protokol teks per-titik.
3. **Spesifik & eksplisit** → tidak ada sniffing warna/depth (eliminasi kerja parsial).
4. Gambar tetap base64 (opsional: bisa dipindah ke data URL referensi; bukan prioritas awal).

---

## 7. Tahapan implementasi

| Fase | Area | Isi |
|---|---|---|
| **F1** | Backend (`app.go`) | Struct Job + deteksi JSON di `handleConnection` + emit `SKETCH_JOB_RECEIVED` + ACK + batas ukuran |
| **F2** | Frontend adapter | `jobFromInkscapeText` (refactor `pathstoText1`) + `jobFromMiniSketchJSON` |
| **F3** | Frontend hydrate | `hydrateJob` → `parsedGeometryData`/`gcstyle`/gambar/specials; listener `SKETCH_JOB_RECEIVED` |
| **F4** | History | simpan JOB + `loadHistoryIndex` via `hydrateJob` + migrasi sekali jalan |
| **F5** | MiniSketch sender | `cncSend()` kirim JSON subset (op/depth/fill/closed/pts/gambar) |
| **F6** | Uji | checklist §8 |

Urutan: **F1→F3** dulu (jalur tol berfungsi), lalu **F4** (history), **F5** (MiniSketch). F2 adalah refactor agar Inkscape juga memakai model sama (bisa setelah F3 stabil).

---

## 8. Checklist uji manual

- [ ] Kirim JSON dari WebSocket client → `SKETCH_JOB_RECEIVED` sampai, G-code tampil benar.
- [ ] Inkscape kirim teks biasa → masih berfungsi seperti sebelumnya (tidak regresi).
- [ ] Mixed: MiniSketch kirim subset → depth default dari profile terpakai.
- [ ] Gambar (base64) dalam job → raster/engrave diproses.
- [ ] History: save → restart → restore menghasilkan job yang sama, tanpa `pathstoText1`.
- [ ] Migrasi history lama (teks) → berhasil diubah ke JOB.
- [ ] Payload besar → batas aman, tidak crash.
- [ ] ACK diterima miniSketch → status "Sent" benar.

---

## 9. Catatan & risiko

- **Refactor `pathstoText1`** berisiko regresi; lakukan bertahap dengan perbandingan output G-code lama vs baru.
- **Jangan ubah `myFunction`** — fast-path sudah ada.
- **Ukuran frame** & `security` (CORS/ukuran) perhatikan.
- **Gambar besar** → pertimbangkan multi-frame atau kompresi di kemudian hari.

---

## 10. Referensi kode

- Backend: `app.go` → `handleConnection`, `StartWSServer`, `emit`.
- Frontend: `frontend/public/appcore.js` → `pathstoText1`, `RBcolor`, `myFunction` (fast-path `parsedGeometryData`), `gcstyle`, `ink_images`, `engravebounds`, `cuttabs`/`starttabs`.
- Frontend: `frontend/public/karyacnc.js` → `WS_MESSAGE_RECEIVED` listener, `savehistory`, `loadHistoryIndex`, `text1`.
- MiniSketch: `minisketch/app.js` → `cncCollectItems`, `cncChains`, `cncPolyline`, `cncBuildPayload`, `cncSend`.
- Dokumen terkait: `revisi/minisketch_fitur_warna_brief.md`, `revisi/minisketch_gcodegen_plan.md`.
