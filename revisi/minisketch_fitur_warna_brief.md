# Brief untuk AI MiniSketch — Fitur Warna/Operasi & "Send to KaryaCNC"

> **Kepada:** AI yang menangani project **MiniSketch asli** (repo sumber berada di luar folder KaryaCNC ini; salinan ada di `minisketch/`).
> **Dari:** analisa kode & dokumentasi KaryaCNC (folder `/mnt/smbshare/wails/karyacnc`).
> **Tujuan:** membantu memutuskan fitur mana yang perlu diimplementasikan / dihapus / dipetakan ulang pada sisi MiniSketch, serta **warna garis mana yang belum ada di MiniSketch**.
> **Status:** analisa + proposal (belum ada perubahan kode). Fitur **"Send to KaryaCNC" dilaporkan tidak dipakai** oleh pemilik project — jadi evaluasi apakah tetap dipertahankan.

---

## 0. Ringkasan eksekutif

1. KaryaCNC membaca **operasi dari warna stroke** (`the colour IS the operation`). Ada **9+ kode warna** yang punya makna, tapi **MiniSketch hanya mengekspos 9 swatch** dan **beberapa memetakan salah** terhadap perilaku kode KaryaCNC yang sebenarnya.
2. **Mismatch penting:**
   - MiniSketch **Merah `#ff0000` = "Drill"** → di KaryaCNC merah sebenarnya **PLT / Secondary Cutting (`domarking`)** — *bukan drill*. (Sebagian dokumentasi md menulis "Drill", tapi kode otoritatif `pathstoText1` memetakan `#ff0000` → `domarking`.)
   - MiniSketch **Teal `#008080` = "Start point"** → di KaryaCNC teal **ganda**: (a) garis 2 titik = titik mulai paksa; (b) poligon teal = **engrave half-DPI (`centerpos` + `doEngrave` + `halfDPI`)**. Jadi "start point" teal boleh, tapi memakan slot yang sebenarnya milik engrave half-DPI.
   - MiniSketch **Hijau `#00ff00` = "Mark"** → di KaryaCNC hijau = **greenskip / travel / boundary penarik urutan** (bukan operasi marking).
3. **Warna/operasi yang belum ada di MiniSketch:**
   - **Engrave half-DPI** (teal/poligon `#008080`).
   - **Green travel / hub** (`#008000`, `greentravel`).
   - (Opsional) fill abu-abu untuk flip offset — **ada bug hex**: MiniSketch kirim `#808080`, KaryaCNC cek `#808000`.
4. **Depth tidak terkirim.** Komentar kode bilang "green channel membawa depth×10mm", tapi builder payload MiniSketch (`cncBuildPayload`) **tidak menulis byte depth** — il hanya mengirim hex warna apa adanya. Jadi depth pakai default KaryaCNC.
5. Karena pemilik **tidak memakai fitur ini**, saran: kalau fitur dipertahankan, perbaiki pemetaan; kalau tidak, hapus tombol "Send to KaryaCNC" + mode cost berbasis operasi agar tidak menyesatkan.

---

## 1. Pemetaan warna→operasi KaryaCNC (OTORITATIF dari kode)

Sumber otoritatif: `frontend/public/appcore.js` → `pathstoText1()` (baris ±4688–4706) + blok `engravebound/centerpos/starttab/cuttab` (±4442–4490). Helper `RBcolor(stro)` mengembalikan `RR+BB` dari hex.

| Hex stroke | `RBcolor` | Flag internal | Operasi / perilaku |
|---|---|---|---|
| `#000000` hitam | `0000` | `isblack` | **Cut** (masuk Clipper offset, dogbone, tabs, nearest-neighbor sort) |
| `#0000ff` biru | `00ff` | `doEngrave` | **Engrave raster** (hatching / power modulation) |
| `#00ffff` cyan | `00ff`* | `dovcarve` | **V-Carve** (Z dinamis by lebar) — cek literal `stro=="#00ffff"` |
| `#800080` ungu | `8080` | `dopocket` | **Pocket** (spiral inward area clearing) |
| `#ff0000` merah | `ff00` | `domarking` | **PLT / Secondary Cutting** (offset=0, feed `pltfeed`, power `pltpw`; untuk laser juga bisa overcut) |
| `#800000` maroon (2 titik) | `8000` | `cuttab` | **Cut tab** (penahan) |
| `#008080` teal, 2 titik | `0080` | `starttab` | **Forced Start Point** (titik mula tusuk) |
| `#008080` teal, poligon | `0080` | `centerpos`+`doEngrave`+`halfDPI` | **Engrave half-DPI** (region ukir resolusi rendah) |
| `#ffff00` kuning | `ff00`* | `engravebound`→`greenskip`+`bound` | **Clip boundary** (batas area ukir; diubah jadi hijau + greenskip) |
| `#00ff00` hijau | `0000`* | `greenskip` | **Travel / skip / boundary** (penarik urutan; tidak diproses) |
| `#008000` hijau tua | `0080`* | `greentravel` | **Green travel / hub** (rute travel khusus) |

*Catatan: `RBcolor` saja tidak cukup (cyan & kuning berbagi `00ff`; hijau & hitam berbagi `0000`; hijau tua & teal berbagi `0080`) — kode memakai cek literal tambahan.

**Depth encoding (hack):** `sty.strokedeep = parseInt("0x" + stro.substr(3,2)) * 0.1` — byte **hijau** dari hex stroke dipakai sebagai kedalaman (mm): `#00[GG]00` → depth = `GG`×0.1. Hanya untuk `CMD_CNC`.

**Fill (flip offset):**
- Fill kuning `#ffff00` → `yellow` → offset dibalik (inside↔outside).
- Fill abu-abu **`#808000`** → `dyellow` → dikonversi (dibaca dari kecerahan fill) menjadi kedalaman/offset tertentu.
- **PENTING:** KaryaCNC **hanya mengenali `#808000`**, bukan `#808080`.

---

## 2. Swatch MiniSketch sekarang vs perilaku KaryaCNC

Sumber: `minisketch/app.js` `COLORS` (±baris 49–58) & `CNC_FILL` (`{none, gray:"#808080", yellow:"#ffff00"}`).

| Swatch MiniSketch | Hex | Perilaku KaryaCNC sesungguhnya | Status |
|---|---|---|---|
| Cut (black) | `#000000` | cut | ✅ cocok |
| Engrave (blue) | `#0000ff` | engrave raster | ✅ cocok |
| V-carve (cyan) | `#00ffff` | v-carve | ✅ cocok |
| Pocket (purple) | `#800080` | pocket | ✅ cocok |
| Drill (red) | `#ff0000` | **PLT/secondary (domarking)** | ⚠️ mismatch nama (bukan drill) |
| Mark (green) | `#00ff00` | greenskip/travel | ⚠️ mismatch semantik |
| Cut tab (maroon) | `#800000` | cuttab (hanya jika 2 titik) | ✅ (bersyarat) |
| Start point (teal) | `#008080` | titik mulai (2 titik) / engrave half-DPI (poligon) | ⚠️ bentrok makna |
| Clip (yellow) | `#ffff00` | clip boundary | ✅ cocok |

---

## 3. Operasi KaryaCNC yang BELUM ada di MiniSketch

1. **Engrave half-DPI** (`#008080` poligon). Slot teal sedang dipakai "Start point" → perlu pemisahan atau warna baru.
2. **Green travel / hub** (`#008000`). Tidak ada swatch.
3. Opsional — **fill abu-abu untuk flip offset** sudah ada di MiniSketch tapi **dikirim dengan hex salah** (`#808080` vs `#808000`).

---

## 4. GAP yang harus diputuskan AI MiniSketch

| # | Gap | Detail | Rekomendasi |
|---|---|---|---|
| G1 | Red "Drill" vs PLT | Cost-model MiniSketch menagih merah 2× sebagai "drill"; KaryaCNC menganggap merah = PLT/secondary | Putuskan: relabel ke "Secondary/PLT cut", atau implementasikan drill sungguhan di KaryaCNC |
| G2 | Teal bentrok | Start point vs engrave half-DPI pakai hex sama | Pisahkan konsep; pilih satu untuk teal, tambah warna/atribut lain |
| G3 | Fill abu-abu hex salah | `#808080` ≠ `#808000` | Perbaiki MiniSketch kirim `#808000`, atau longgarkan pengecekan KaryaCNC |
| G4 | Depth tidak terkirim | Komentar "green channel" tidak dieksekusi | Jika mau depth per-path, kirim field eksplisit (lihat proposal JSON job) |
| G5 | Operasi tidak dipakai | Pemilik tidak memakai "Send to KaryaCNC" | Evaluasi: pertahankan (perbaiki map) atau hapus fitur + cost mode |

---

## 5. Harapan perilaku per operasi (untuk memutuskan perlu tidaknya)

Informasi dari `revisi/2stagepipeline.md` & `revisi/panduan.md`:

- **Hitam (cut):** offset Clipper (kompensasi pisau), dogbone, holding tabs, nearest-neighbor sort. Parameter: `feed`, `pdn`, `Z` step/repeat, `pup`, M3/M5.
- **Merah (PLT/secondary):** offset = 0, `pltfeed`, `pltpw` (power/depth), sorting urutan.
- **Biru (engrave):** raster hatching & power modulation, feed ukir, laser power.
- **Cyan (V-carve):** spatial grid collision + kedalaman 3D; feed khusus & max Z.
- **Ungu (pocket):** multi-pass inward polygon offset (Clipper); step & feed.
- **Teal poligon (engrave half-DPI):** seperti biru tapi resolusi lebih kasar (hemat waktu).
- **Kuning (clip boundary):** batas area raster; tidak diproses/dipotong.
- **Hijau (greenskip/travel):** boundary/penarik urutan; tidak diproses.

---

## 6. Rekomendasi keputusan untuk AI MiniSketch

1. **Jika fitur "Send to KaryaCNC" dipertahankan:**
   - Perbaiki table warna agar **satu-satu** dengan KaryaCNC (G1, G2).
   - Perbaiki fill abu-abu → `#808000` (G3) **atau** usul KaryaCNC menerima `#808080`.
   - Tambahkan swatch **Engrave half-DPI** & **Green travel** bila ingin paritas penuh.
   - Ambil keputusan soal depth (G4): kirim eksplisit lewat payload JSON (selaras dengan proposal job terstruktur), berhenti mengandalkan green-channel.
2. **Jika fitur TIDAK dipakai (kondisi saat ini):**
   - Hapus/hilangkan menu "Send to KaryaCNC" dan mode cost berbasis operasi untuk mengurangi permukaan bug.
   - Jadikan warna murni tampilan, bukan pembawa semantik (dan hindari bentrok G2/G3).

---

## 7. Referensi sumber

- Kode otoritatif: `frontend/public/appcore.js` → `pathstoText1()` (±4442–4490 & ±4688–4706), `RBcolor()` (492), `defaultsty/carvesty*` (±140–170).
- Sender MiniSketch: `minisketch/app.js` → `COLORS` (49–58), `CNC_FILL`, `cncBuildPayload`, `cncSend` (±24115–25360).
- Dokumen pipeline (mengandung tabel warna — **saling bertentangan**, kode yang menang):
  - `flow.md` §4.1 (merah=Drilling, hijau=Marking, teal=Starting position — proyeksi/harapan).
  - `revisi/panduan.md` §5.2 (merah=PLT/Marking, hijau=Green Travel/Hub, teal=Forced Start Point).
  - `revisi/2stagepipeline.md` (hitam/merah/biru/cyan/ungu + pemisahan 2-stage; konfirmasi merah=domarking/PLT).
- Pipeline audit: `revisi/pipeline_audit.md` (catatan `dodrill`, engrave/raster, dll).
