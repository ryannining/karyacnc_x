# ANALISA & PENJELASAN: PEMISAHAN 2-STAGE PIPELINE KARYACNC
## Menangani Multi-Tool (Main Cutting Hitam, Secondary Merah, Engrave Biru, V-Carve Cyan, Pocket Ungu, Raster)

> **Tujuan Dokumen:**  
> Memberikan analisa mendalam tentang kelayakan, tingkat kerumitan, arsitektur pemetaan jenis operasi (*multi-tool/multi-color*), dan batasan teknis pemisahan pipeline menjadi 2 tahap (*Two-Stage Pipeline*).

---

## 1. APAKAH PEMISAHAN INI RUMIT?

**Jawaban Singkat:**  
Tidak rumit secara arsitektur jika kita memahami batas yang jelas antara **Geometri (Koordinat Jalur)** dan **G-code Generation (Parameter Kecepatan/Kedalaman/Formatting Teks)**.

Saat ini yang membuat proses terasa bercampur adalah:
Semua logika jenis pengerjaan (*hitam, merah, biru, cyan, ungu*) sebenarnya **SUDAH TERPISAH** di dalam kode saat ini melalui atribut objek `sty` (style):
- **Hitam (`#000000`)**: `sty.isblack = 1` $\to$ Masuk ke Clipper Offset untuk kompensasi diameter tool.
- **Merah (`#ff0000` / domarking)**: `sty.domarking = 1` $\to$ Offset = 0 (tanpa kompensasi pisau), feed memakai `pltfeed`.
- **Biru (`#0000ff` / doEngrave)**: `sty.doEngrave = 1` $\to$ Diproses sebagai garis raster hatching / power modulation.
- **Cyan (`#00ffff` / dovcarve)**: `sty.dovcarve = 1` $\to$ Offset = 0, kedalaman $Z$ dihitung khusus oleh `vcarve()`.
- **Ungu (`#800080` / dopocket)**: `sty.dopocket = 1` $\to$ Diproses oleh `pocketcarve()` (spiral inward area clearing).
- **Gambar Raster (Bitmap)**: Diproses terpisah oleh `imagedither()` / `cncengrave()`.

### Di Mana Letak Beban Kerjanya?

| Operasi | Yang Memakan Waktu (Stage 1 - Berat) | Yang Cepat / Teks Saja (Stage 2 - Ringan) |
|---|---|---|
| **Hitam (Main Cutting)** | `ClipperOffset` (kompensasi pisau), DogBone bezier corners, titik holding tabs, nearest neighbor sorting | Mengganti `F` (feedrate), `pdn` (plunge), `Z` step/repeat, safe Z (`pup`), M3/M5 spindle |
| **Merah (Secondary/Marking)** | Sorting urutan garis | Mengganti `pltfeed`, `pltpw` (laser power / depth) |
| **Biru (Engrave/Hatching)** | Perhitungan raster garis silang | Mengganti feed ukir, laser power |
| **Cyan (V-Carve)** | Spatial grid collision check & kedalaman 3D | Mengganti feed rate, max Z limit |
| **Ungu (Pocketing)** | Multi-pass inward polygon offset Clipper | Mengganti cutting step & feed rate |
| **Image/Raster** | Floyd-Steinberg dithering piksel | Mengganti max power & travel speed |

---

## 2. ARSITEKTUR TWO-STAGE PIPELINE

Pemisahan pipeline dibagi menjadi dua lapisan yang saling melengkapi:

```text
┌────────────────────────────────────────────────────────────────────────┐
│  STAGE 1: TOOLPATH GEOMETRY GENERATION (Heavy Calculation)             │
│  HANYA berjalan saat:                                                  │
│  - Desain vektor berubah (load file baru / push dari Inkscape)         │
│  - Diameter tool / pisau berubah (input 'offset')                      │
│  - Setting DogBone berubah ('overcutmode', 'sharp', 'ovcmore')         │
│  - Setting Holding Tab berubah ('tabevery', 'tabmax', 'tablen')        │
│  - Skala benda kerja berubah ('scale')                                 │
│  - Mode pengurutan berubah ('yslow', 'centersort', 'greensort')        │
│                                                                        │
│  OUTPUT STAGE 1:                                                       │
│  -> Array terurut `sgcodes` (berisi koordinat X,Y fisik pisau & metadata)│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Disimpan di: window.cachedSgcodes
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  STAGE 2: G-CODE TEXT EMISSION (Super Fast - Sub-millisecond)          │
│  BERJALAN saat parameter operasional/teks berubah:                    │
│  - Kecepatan potong ('feed', 'feed1x', 'pltfeed', 'rasteroutfeed')     │
│  - Kecepatan tusuk / Plunge ('pdn')                                    │
│  - Kecepatan travel ('trav')                                           │
│  - Kedalaman potong total & per-layer ('deep', 'repeat', 'firstd')     │
│  - Tinggi angkat aman Z ('pup', 'finalz')                              │
│  - Kekuatan spindle / laser ('pltpw', 'rasteroutpw')                   │
│  - Dwell time ('dwelltime')                                            │
│                                                                        │
│  OUTPUT STAGE 2:                                                       │
│  -> String G-code teks di textarea `#gcode` & update harga/estimasi    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. BAGAIMANA MULTI-TOOL DITANGANI PADA SETIAP TAHAP?

### A. Main Cutting (Hitam) vs Secondary Cutting (Merah / PLT)
- **Saat ini di `appcore.js`:**
  Baik garis hitam maupun merah sama-sama masuk ke array `gcodes`.
  Perbedaannya:
  - Garis hitam: `ofs = getoffset()` (misal: pisau 3mm $\to$ offset 1.5mm).
  - Garis merah (`sty.domarking`): di `prepare_line2`, `ofs = 0` (tanpa offset).
- **Pada Two-Stage Pipeline:**
  Koordinat hasil offset keduanya sudah berada di dalam `sgcodes[j][0][4]`.
  Saat user hanya mengubah **`pltfeed` (kecepatan potong merah)** atau **`feed` (kecepatan potong hitam)**:
  - **Stage 1 TIDAK PERLU DIULANG.**
  - **Stage 2** hanya membaca loop `lines2gcode` dan menyuntikkan string `F...` yang baru sesuai warna garis masing-masing:
    ```javascript
    if (sty.domarking) {
        f2 = getvalue('pltfeed') * 60; // Pakai feed merah
    } else {
        f2 = speedfeed * 60;          // Pakai feed hitam biasa
    }
    ```

### B. V-Carve (Cyan) & Pocketing (Ungu)
- Koordinat lintasan V-Carve dan Pocketing dihasilkan oleh Clipper dan disimpan ke struktur data job.
- Jika user hanya mengubah **feedrate** atau **safe Z**, koordinat poket spiral dan kedalaman celah V-carve tetap sama, teks G-code diperbarui seketika.
- Jika user mengubah **stepover** (jarak geser mata pisau pocket), maka Stage 1 dijalankan ulang karena bentuk fisik lintasan berubah.

### C. Engrave & Raster (Biru / Bitmap)
- G-code engrave disimpan terpisah di textarea `#engcode`.
- Komputasi dither gambar raster sudah berdiri sendiri di fungsi `imagedither()`.
- Pemisahan 2-stage justru memperjelas batas: engrave G-code tidak perlu digenerate ulang jika yang diubah hanya parameter pisau cutting router.

---

## 4. SKENARIO PENGGUNAAN NYATA (USER EXPERIENCE)

### Kasus 1: Operator Menyesuaikan Feedrate Bahan
- *Kondisi:* Desain ACP/MDF dengan 300 lubang baut sudah dimuat. Operator merasa mesin terlalu cepat dan mengubah Feed dari `2500` ke `1800 mm/min`.
- **Sistem Lama:** Menghitung ulang Clipper Offset 300 lubang, mencari sudut tajam 300 lubang, menghitung tab, menjalankan sorting ulang $\to$ **Delay 1–3 detik, layar macet sesaat**.
- **Sistem 2-Stage:** Clipper dan sorting diabaikan karena koordinat tidak berubah. Fungsi langsung lompat ke `lines2gcode` $\to$ **G-code terupdate dalam < 5 milidetik (Instan!)**.

### Kasus 2: Operator Mengubah Urutan Potong (Object Sort: Y-slow / Center-out)
- *Kondisi:* Operator mengubah bobot `yslow` dari 1 ke 2.
- **Sistem 2-Stage:** Karena koordinat offset pisau tiap bentuk tidak berubah, sistem **tidak perlu menjalankan Clipper ulang**. Sistem cukup menjalankan `sortedgcode()` $\to$ `lines2gcode()`. Waktu proses turun drastis.

### Kasus 3: Operator Mengganti Ukuran Mata Pisau
- *Kondisi:* Ganti mata pisau dari endmill 3mm ke 4mm (mengubah input `Tool Diameter / Offset`).
- **Sistem 2-Stage:** Sistem mendeteksi parameter geometri berubah $\to$ menjalankan Stage 1 penuh (Clipper offset ulang) lalu Stage 2.

---

## 5. PETA PARAMETER: KAPAN STAGE 1 vs STAGE 2 DIPANGGIL?

Untuk mencegah kerumitan, kita cukup membuat **klasifikasi ID input HTML**:

### Grup A: Memicu STAGE 1 (Geometri Berubah $\to$ Full Rebuild)
```javascript
const GEOMETRY_INPUT_IDS = [
    "offset", "pltmode", "strokeoffset",      // Ukuran tool & kompensasi
    "overcutmode", "overcutmin", "ovcmore", "sharp", // Dogbone corners
    "tabevery", "tabmax", "tablen", "tabofs", "tabinside", // Holding tabs
    "scale", "curveseg", "smooth",            // Transformasi & resolusi kurva
    "drill", "dodrill",                       // Min length convert drill
    "acpstep", "acpmode",                     // Side step ACP
    "xsort", "ysort", "szsort", "centersort", "yslow", "greensort", // Sorting
    "usefinish", "finishline"                 // Finishing pass offset
];
```

### Grup B: Memicu STAGE 2 SAJA (Parameter Teks/Kinematika $\to$ Fast Rebuild)
```javascript
const FAST_GCODE_INPUT_IDS = [
    "feed", "feed1x", "trav", "pdn", "pup",   // Kecepatan F & Safe Z
    "deep", "repeat", "firstd", "finalz",     // Kedalaman Z per layer
    "pltfeed", "pltpw",                       // Feed & power merah (PLT)
    "rasteroutfeed", "rasteroutpw",           // Feed & power raster/engrave
    "dwelltime", "spindleoff", "spindleoffval", // Dwell & Spindle
    "addz", "slowsmall", "slowsmallval", "useslowsmall", // Penyesuaian speed kecil
    "canresume", "pausecut"                   // Pause flags
];
```

---

## 6. KESIMPULAN & REKOMENDASI

1. **Tingkat Kerumitan: Rendah ke Sedang.**
   Tidak perlu merombak fungsi algoritma CAM (`prepare_line2`, `vcarve`, `lines2gcode`). Yang diatur hanyalah **jalur masuk pemanggilan fungsi** (*decision routing*).
2. **Dukungan Multi-Tool / Multi-Warna: Aman.**
   Struktur data `sgcodes` saat ini sudah membawa informasi warna dan style (`sty`) per kontur, sehingga saat pembuatan teks G-code (`lines2gcode`), sistem sudah tahu kontur mana yang memakai `pltfeed` (merah), `feed` (hitam), maupun `docarve` (cyan).
3. **Keuntungan Terbesar:**
   Mengubah parameter umum (kecepatan, kedalaman Z, power laser, dwell) menjadi **secepat kilat** tanpa beban komputasi geometri berulang.
