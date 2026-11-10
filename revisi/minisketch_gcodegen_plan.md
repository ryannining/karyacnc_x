# Rencana Implementasi — Fitur "G-code Generator" di MiniSketch

> **Kepada:** AI implementer di project **MiniSketch asli** (repo sumber; salinan kerja ada di folder `minisketch/` KaryaCNC).
> **Tujuan:** menambah fitur **menghasilkan G-code dari objek terpilih**, dengan atribut per-titik (kedalaman, force titik awal cutting), di dalam MiniSketch — sehingga MiniSketch perlahan mengambil alih fitur generate G-code dari KaryaCNC untuk kasus yang paling sering dipakai.
> **Sifat:** rencana lengkap untuk implementasi. Tidak ada perubahan kode pada dokumen ini.

---

## 0. Ringkasan eksekutif

1. Tambahkan **entitas baru `gcodegen`** ("G-code Generator") — sebuah *group turunan (derived view)* di atas objek master yang dipilih.
2. Ia **tidak memiliki geometri** (read-only dari `masters`) sehingga tidak ada duplikasi-drift; perubahan master hanya menandai **stale** → user klik **Update**.
3. Hidup di **layer khusus "G-code"** (pakai sistem layer yang sudah ada) sehingga bisa **di-hide**.
4. Bawa atribut eksplisit per kontur: **`op`**, **`depth`**, **`startPoint`**, **`closed`** — menggantikan encoding warna/green-channel ala KaryaCNC.
5. **Preset bahan** (depth/feed/power/kerf) = perluasan dari sistem cost presets yang sudah ada.
6. **Reuse** mesin flatten/chain yang sudah ada (`cncPolyline`, `cncChains`, `cncArcSpan`) untuk menghasilkan polylines bersih.
7. Emiter G-code untuk **cut / marking / engrave** (+ opsional dogbone & cut-tab). **Pocket / V-carve / raster** di-delegasikan ke KaryaCNC melalui payload JSON.

---

## 1. Latar belakang & ruang lingkup

### 1.1 Kondisi sekarang
- **MiniSketch** = sketcher 2D constraint-based. Punya: entitas (point/line/circle/arc/spline/text/image/part/array/group), sistem layer (`state.layers`, panel layer, `activeLayer`), clone array (`type:'array'`, `masters`), loop fill (gray/yellow), dan mesin flatten untuk kirim ke CNC (`cncCollectItems`, `cncChains`, `cncPolyline`, `cncBuildPayload`, `cncSend`).
- **KaryaCNC** = aplikasi CAM + driver mesin. Interpretasi operasi dari warna stroke; depth via hack green-channel; rendering banyak algoritma CAM (offset Clipper, dogbone, tabs, pocket, V-carve, raster, sort).

### 1.2 Penggunaan nyata (dari pemilik)
- Paling sering: **cut**, **marking**, **engrave**.
- Kadang: **dogbone**, **cutting tab**.
- **Kedalaman** pakai **preset sesuai bahan** (classic di KaryaCNC), sesekali di-adjust manual.
- Fitur "Send to KaryaCNC" dan sistem warna→operasi **jarang/tidak dipakai** → diganti model eksplisit.

### 1.3 Keputusan desain
- MiniSketch **menghasilkan G-code sendiri untuk kasus sederhana** (cut/mark/engrave), dan **delegasikan advanced** (pocket/V-carve/raster) ke KaryaCNC via JSON.
- Model atribut **eksplisit** (bukan warna) sebagai sumber kebenaran.

---

## 2. Model data

### 2.1 Entitas `gcodegen`

```js
{
  id: "g1",
  type: "gcodegen",
  layer: <number>,                 // id layer "G-code"
  name: "G-code 1",
  masters: [id, ...],              // referensi ID entitas sumber
  presetId: "akrilik-3mm",         // referensi preset bahan
  items: [                         // hasil capture job (cache; dihitung ulang saat Update)
    {
      entityId: <id>,
      op: "cut" | "mark" | "engrave" | "vcarve" | "pocket" | "raster",
      depth: 3.0,                  // mm (dari preset / override)
      feed: 8,                     // mm/s (override opsional)
      power: 80,                   // % laser / daya
      startPt: [x, y] | null,      // forced start point (optional)
      closed: true,
      pts: [[x,y], ...]            // polylines mm; hasil flatten
    }
  ],
  dirty: true,                     // true bila master berubah sejak capture terakhir
  ui: { showOutlines:true, showStartPoints:true, showDepthLabels:false }
}
```

### 2.2 Entry di `state.entities`
- Registrasi seperti entitas lain.
- Jangan menempatkan geometri di sini: `items` adalah *snapshot komputasi*, bukan sumber geometri.

### 2.3 Layer khusus
- Saat create pertama: cari/buat layer bernama **"G-code"** di `state.layers` (default `visible:true`, `locked:true`).
- Semua `gcodegen` memakai layer itu → hide/show via eye-toggle layer.

---

## 3. Preset bahan / CAM

Perluas sistem cost presets yang sudah ada (`COST_KEY`, `costDefaultText`, `costParsePresets`, `costLoadPresets`).

### 3.1 Struktur preset baru
```js
{
  name: "Akrilik 3mm",
  feed: 8,          // cut feed mm/s
  depth: 3.0,       // depth default mm
  power: 80,        // laser power % (atau spindle)
  kerf: 0.2,        // mm
  engraveFeed: 250, // feed engrave mm/s
  engravePower: 60,
  markPower: 20
}
```

- Sediakan daftar default yang meniru profile KaryaCNC (bisa diambil dari `costDefaultText` + data material KaryaCNC).
- Penyimpanan: `localStorage` key baru (mis. `minisketch.camPresets.v1`), format JSON; tetap hand-editable seperti cost.txt.
- UI: dropdown di panel generator → isi default per-op; tiap op bisa override.

---

## 4. Pipeline generate (reuse yang sudah ada)

Urutan fungsi yang dipakai ulang:
1. `selectedEntitiesForExport()` / filter `masters`.
2. `cncCollectItems(scope)` (atau jalur langsung per entitas) → daftar item `{color, fill, group, pts, closed}`.
3. `cncPolyline(e)` + `cncArcSpan(tol, r)` → flatten tiap entitas ke polylines pada toleransi CNC (`cnc.tol`).
4. `cncChains(list)` → gabung polylines terbuka yang bersentuhan.
5. **Assign op/depth/start**:
   - `op`: dari field eksplisit entitas master (baru) atau dari warna (fallback, lihat §9).
   - `depth`: preset → override per-op.
   - `startPt`: titik yang ditandai pengguna (lihat §7).
6. Simpan hasil ke `items`; set `dirty = false`.

> Deteksi stale: simpan `sig` = hash (revisi geometri master / JSON ringkas `pts`) saat capture. Pada tiap render/panel, bandingkan `sig` baru vs lama → `dirty = true`.

---

## 5. Layer & visibilitas

- **Gunakan sistem layer yang ada** (`state.layers`, `getLayer`, `layerVisible`, `setEntityLayerDeep`, panel layer).
- Entitas `gcodegen` dirender pada **overlay read-only** (non-pickable) — seperti garis guide/construction.
- Eye-toggle di panel layer → hide/show semua ghost generator.
- Mode `dimOthers` tetap berlaku.

---

## 6. Semantik update

- **Tombol "Update / Regenerate"** di panel → jalankan ulang pipeline §4.
- **Badge "stale"** muncul bila `dirty` (master berubah sejak capture).
- **Auto-live** = toggle opsional, default **OFF** (permintaan pengguna: update manual).
- Menghapus/mengubah master **tidak menghapus** generator — hanya menandai `dirty`.

---

## 7. Start point & atribut per-titik

- Field `startPt` pada `items[].` → titik awal pemotongan.
- UX: setelah membuat generator, aktifkan mode "pilih start point" → user klik titik pada kontur → simpan `[x,y]`.
- Jika `startPt` null → gunakan titik pertama poligon (atau heuristik sort).
- (Opsional untuk masa depan) atribut per-titik lain: `dogbone`, `tab`, `pierce` dsb. disimpan di meta per kontur.

---

## 8. Perilaku per operasi (cut/mark/engrave)

| op | G-code behavior |
|---|---|
| `cut` | offset kerf (opsional), dogbone (opsional), plunge `Z-depth`, feed preset, closed-loop handling |
| `mark` | tanpa offset, kedalaman 0 (atau kecil), power `markPower`, feed cepat |
| `engrave` | raster/hashing → textarea terpisah (opsional tahap awal: hanya outline) |
| `vcarve`/`pocket`/`raster` | **delegasikan ke KaryaCNC** via JSON (§11) |

---

## 9. Pemetaan warna (fallback) — penting untuk kompatibilitas

Jika `op` tidak eksplisit (mis. import SVG), gunakan tabel (otoritatif dari kode KaryaCNC `appcore.js`):

| Hex | op |
|---|---|
| `#000000` | cut |
| `#0000ff` | engrave |
| `#00ffff` | vcarve |
| `#800080` | pocket |
| `#ff0000` | mark (PLT/secondary) |
| `#800000` | cut tab |
| `#008080` | start point / engrave half-DPI |
| `#ffff00` | clip boundary |

Catatan: **depth TIDAK dari green-channel** di model baru — selalu eksplisit.

---

## 10. Emiter G-code (format minimal)

Output konsisten, mm, absolut:

```gcode
; generated by MiniSketch G-code generator (v1)
G21
G90
M3 S<power>
G0 Z<safeZ>
; --- contour p1 (cut) ---
G0 X<startX> Y<startY>
G1 Z-<depth> F<plunge>
G1 X.. Y.. F<feed>
...
G0 Z<safeZ>
M5
```

- Per kontur: travel ke `startPt` → plunge → potong → retract.
- Per-op: `feed`/`power` berbeda (dari preset/override).
- `closed` loop: tutup otomatis ke titik awal.
- Opsional: dogbone pada sudut dalam (lihat §12 P5).

---

## 11. Interop dengan KaryaCNC (delegasi advanced)

Kirim **JSON terstruktur** (bukan teks protokol lama) ke WS `:8887`:

```json
{
  "type": "job",
  "version": 1,
  "units": "mm",
  "paths": [
    { "op":"cut", "depth":3, "closed":true, "pts":[[x,y],...] }
  ],
  "images": []
}
```

- `cncSend()` diubah agar mengirim JSON ini; tetap terima ACK.
- (Referensi sisi penerima: proposal `app.go` — parser JSON + event `SKETCH_JOB_RECEIVED`; implementasi di repo KaryaCNC terpisah.)

---

## 12. Tahapan implementasi

### P1 — Model & capture
- Tambah `type:'gcodegen'` + `masters` + `items`.
- Implementasi `genCapture()` (reuse flatten/chain) → isi `items`.
- `pushHistory()`/`commit()`/`updateUI()` standar.

### P2 — Render ghost di layer "G-code"
- Render outline per `item` warna sesua `op`; marker start; label depth (opsional).
- Non-pickable; kunci layer.

### P3 — Panel & preset
- Panel generator: tabel operasi, dropdown preset, tombol **Update**, badge stale.
- Perluas cost presets → CAM presets.
- Mode pilih start point.

### P4 — Emiter & export
- `emitGcode()` → teks G-code; tombol **Export .gcode** (Save as).
- Tambah panel/tombol output.

### P5 (opsional) — Dogbone & cut-tab; delegasi advanced
- Port dogbone/cut-tab dari KaryaCNC (atau mulai tanpa keduanya).
- Hubungkan tombol "Send to KaryaCNC" dengan payload JSON (§11).

---

## 13. Titik integrasi di kode (daftar simbol untuk implementer)

Lokasi: `minisketch/app.js` (dan `minisketch/core.js`, `styles.css`, `index.html`).

| Simbol / bagian | Keterangan |
|---|---|
| `COLORS`, `CNC_CODES` | swatch warna (≈baris 49–58) |
| `cncCollectItems`, `cncChains`, `cncPolyline`, `cncArcSpan`, `cncBuildPayload`, `cncSend` | mesin flatten & kirim |
| `cnc.tol`, `settings.cncFlatten` | toleransi flatten |
| `cost.presets`, `costLoadPresets`, `costDefaultText` | dasar preset (perluas) |
| `state.layers`, `getLayer`, `layerVisible`, `setEntityLayerDeep`, `ui.activeLayer` | sistem layer |
| `state.entities`, `pushHistory`, `commit`, `updateUI`, `render` | siklus hidup entitas |
| `selectedEntitiesForExport()` | ambil seleksi master |
| Panel layer (`index.html`/`styles.css`) | tambah entri layer "G-code" |

---

## 14. Kasus tepi & robustness

- Master dihapus/di-move → generator jadi stale (bukan error).
- Range `depth`/`feed`/`power` divalidasi (clamp).
- `closed` loop dengan <3 titik → skip/warning.
- Toleransi flatten kecil → banyak poin; pastikan tetap performan (batasi).
- Banyak generator → jangan render berlebihan (pakai renderer cheap path bila `BULK_ENTITIES` terlampaui).
- Start point di luar kontur → clo ke titik terdekat.

---

## 15. Checklist uji manual (setelah implementasi)

- [ ] Buat sketsa → pilih objek → biCreate from selection" → muncul ghost di layer "G-code".
- [ ] Hide/show layer "G-code" bekerja (eye-toggle).
- [ ] Ubah master → badge stale muncul → klik Update → ghost & output berubah.
- [ ] Pilih preset bahan → depth/feed/power default terisi; override per-op berfungsi.
- [ ] Tandai start point → output G-code mulai dari titik itu.
- [ ] Export .gcode → format valid (G21/G90, per-op feed/power, Z plunge/retract).
- [ ] Entitas generator tidak bisa diedit langsung (non-pickable).
- [ ] Undo/redo (`pushHistory`) aman untuk create/update/hapus generator.

---

## 16. Referensi

- `revisi/minisketch_fitur_warna_brief.md` — pemetaan warna→operasi KaryaCNC & gap (G1–G4).
- KaryaCNC CAM engine: `frontend/public/appcore.js` (`pathstoText1`, `RBcolor`, `myFunction` fast-path `parsedGeometryData`), `cnc.js`.
- Proposal sisi penerima (JSON job): di repo KaryaCNC (parser `app.go` + event `SKETCH_JOB_RECEIVED`).
