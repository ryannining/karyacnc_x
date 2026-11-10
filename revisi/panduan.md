# PANDUAN ARSITEKTUR & PETA MENDALAM PROJECT KARYACNC

> **Tujuan Dokumen:**  
> Dokumen ini adalah peta tunggal (*single source of truth*) arsitektur KaryaCNC untuk referensi cepat developer dan AI. Chat AI baru cukup membaca dokumen ini untuk memahami seluruh alur, struktur direktori, data flow, format data, dan lokasi kode tanpa perlu membaca ulang puluhan file yang memboroskan token.

---

## 1. RINGKASAN EKSEKUTIF & TEKNOLOGI

KaryaCNC adalah aplikasi kontrol mesin CNC desktop terintegrasi (CNC Router, Laser Cutter/Engraver, Plasma Cutter, Foam Cutter, dan 3D Printer). Aplikasi ini menangani:
1. Penerimaan data vektor desain langsung dari Inkscape via WebSocket.
2. Toolpath generation (offset Clipper, dogbone cornering, holding tabs, V-carve, pocketing, raster engrave).
3. Optimasi lintasan (path sorting: anisotropic Y-slow, center-out compound, green hub).
4. Simulasi pergerakan CNC & preview waktu pengerjaan nyata (planner acceleration & junction deviation).
5. Komunikasi mesin real-time (TCP binary protocol untuk posisi/status, HTTP multipart upload G-code, serial/WebSocket sender).
6. Fitur bisnis bawaan: SVG Nesting tool (NFP) dan Invoice Generator terintegrasi ongkir RajaOngkir.
7. Model Multi-Admin Master–Slave untuk standarisasi profil kerja & harga potong.

### Tech Stack
| Lapisan | Komponen | Catatan Kritis |
|---|---|---|
| **Backend** | Go 1.23+ / Wails v2.11.0 | Single-file architecture di `app.go`, entry point `main.go` |
| **Frontend** | Vanilla HTML5 / JavaScript (ES6+) | Single-Page Application (SPA) tanpa framework |
| **Bundler/Dev** | Vite 3.0.7 | Hanya untuk dev server Wails; produksi di-embed dari `frontend/dist` |
| **Runtime Target** | Windows (`karyacnc.exe`) / Linux | Asset statis di-embed ke dalam binary executable |
| **Inkscape Plugin** | Python 3 + `inkex` | `frontend/inkscape_ex/karyacnc1.py` |
| **Nesting Engine** | JavaScript Web Worker + Clipper | `nestjs2/frontend/` |

> ⚠️ **ATURAN MUTLAK FRONTEND:**  
> Kode frontend aktif berada di **`frontend/public/`** (seperti `karyacnc.js`, `appcore.js`, `cnc.js`).  
> File di `frontend/src/` adalah sisa template Wails awal dan **TIDAK DIGUNAKAN DI RUNTIME**. Jangan pernah mengedit `frontend/src/`!

---

## 2. PETA DIREKTORI & FILE UTAMA

```text
karyacnc/
├── app.go                      # Core Backend Go: Wails API, HTTP Server :3000, WS Server :8887, TCP Client :8888
├── main.go                     # Wails bootstrap, ukuran jendela, embedding frontend/dist
├── go.mod / go.sum             # Modul Go (gorilla/websocket, wails/v2, screenshot)
├── wails.json                  # Konfigurasi build & project Wails
│
├── frontend/                   # UI Frontend
│   ├── index.html              # Template UI tunggal (layout, panels, canvas, controls, dialogs)
│   ├── vite.config.js          # Pengaturan Vite
│   │
│   ├── public/                 # <<< SEMUA LOGIKA RUNTIME FRONTEND ADA DI SINI >>>
│   │   ├── wails-runtime.js    # Jembatan kompatibilitas (Adapter Tauri -> Wails invoke & listen)
│   │   ├── karyacnc.js         # State mesin, profil, koneksi, event listener, Master-Slave
│   │   ├── appcore.js          # Core engine: parse vektor, Clipper offset, tab, dogbone, sorting
│   │   ├── cnc.js              # Algoritma khusus: V-Carve, Pocketing, Engrave Dither, Potrace
│   │   ├── cncplanner.js       # Motion planner: kalkulasi akselerasi, waktu potong, simulator
│   │   ├── gcodex.js           # Binary GX format compression/decompression
│   │   ├── clipper.js          # Library kompensasi toolpath & boolean polygon (ClipperLib)
│   │   ├── Potrace.js          # Bitmap tracer ke path vektor
│   │   ├── infinite-canvas.*   # Kontrol pan & zoom canvas interaktif
│   │   └── styles.css          # Styling utama UI
│   │
│   └── inkscape_ex/            # Ekstensi Inkscape
│       ├── karyacnc1.inx       # GUI menu ekstensi Inkscape
│       ├── karyacnc1.py        # Ekstraksi kurva Bezier -> format string protokol custom
│       └── websocket/          # Embedded websocket client library (Python)
│
├── nestjs2/                    # Nesting Tool V2 (SVG auto-nesting dengan No-Fit Polygon)
│   └── frontend/
│       ├── index.html          # UI Nesting (dimuat via iframe di dialog KaryaCNC)
│       └── js/                 # Algoritma nesting worker, nfp, utilitas geometri
│
├── tools_invoice/              # Invoice & Ongkir Generator
│   └── invoice.html            # UI Invoice terintegrasi RajaOngkir (disajikan via port 3000)
│
└── revisi/                     # Dokumentasi revisi dan fitur spesifik
    ├── panduan.md              # File ini (Peta arsitektur lengkap)
    └── path_sorting.md         # Catatan revisi algoritma Y-slow, Center-out, Green hub
```

---

## 3. PEMBAGIAN TUGAS MODUL FRONTEND

### A. `wails-runtime.js` (Bridge Compatibility Layer)
Menyediakan interface `window.invoke(command, args)` dan `window.listen(event, callback)`.
- Mengarahkan command frontend ke metode struct `App` di `app.go`:
  - `upload_file` -> `App.UploadFile()` (HTTP multipart kirim G-code ke controller)
  - `proxy_request` -> `App.ProxyRequest()`
  - `set_profiles` -> `App.SetProfiles()` (Simpan profil master ke backend Go)
  - `start_ws_server` -> `App.StartWSServer()` (Buka port WebSocket 8887)
  - `connect_to_machine` -> `App.ConnectToMachine()` (Buka koneksi TCP port 8888)
  - `disconnect_from_machine` -> `App.DisconnectFromMachine()`
  - `start_receiving` -> `App.StartReceiving()` (Mulai parsing binary protocol mesin)
  - `install_inkscape_extension` -> `App.InstallInkscapeExtension()`
  - `capture_screenshot` -> `App.CaptureScreenshot()`
  - `open_invoice` -> `App.OpenInvoice()` (Buka browser ke `localhost:3000/invoice.html`)

### B. `karyacnc.js` (UI & Machine Controller)
- **State Mesin:** Mode aktif (`CMD_LASER=1`, `CMD_FOAM=2`, `CMD_CNC=3`, `CMD_3D=4`, `CMD_PLASMA=5`).
- **Profile Management:**
  - Fungsi `saveprofile()`, `loadprofile()`, `setprofile()`.
  - DOM serialization: semua input dengan class `.saveit` otomatis tersimpan ke JSON profil.
  - **Master–Slave Profile System:**
    - Master: Input setting lokal -> `pushProfilesToMaster()` -> Go `SetProfiles()` -> diekspos di `:3000/api/profiles`.
    - Slave: Isi Master IP -> fetch `:3000/api/profiles` -> gabungan dropdown `[L]` (Lokal) dan `[M]` (Master).
    - Save di Slave selalu menulis ke lokal, master tetap steril.
- **Koneksi Mesin:**
  - WebSocket & TCP connection listener (`machine-position`, `machine-job`).
  - Send G-code buffer flow control (`oktosend`, buffer 128 byte, tracking `waitok`).
- **Pipeline Trigger:**
  - `refreshgcode()`: fungsi sentral yang dipanggil setiap kali profil berubah, input diedit, atau history dipilih. Memanggil `myFunction(0)` di `appcore.js`.

### C. `appcore.js` (Vector Engine, CAM & Toolpath Generator)
File terbesar (~3900+ baris) yang menangani matematika CAD/CAM:
- `pathstoText1(gx)`: Parser raw protocol dari Inkscape (`X:..`, `P:..`, koordinat, `>REVECTOR2`) menjadi object internal `text1`.
- `myFunction(scale1)`: Pipeline utama eksekusi:
  1. Ekstraksi koordinat path.
  2. Identifikasi hierarchy kontur (parent vs hole/child) via `ClipperLib.PolyTree`.
  3. Perhitungan tool offset via `prepare_line2()` menggunakan `ClipperLib.ClipperOffset`.
  4. Penambahan DogBone / Overcut pada sudut tajam di `sharp()`.
  5. Perhitungan holding tabs (jembatan pemotong) di `getcutpos()`.
  6. Penyusunan urutan potong di `sortedgcode()`.
  7. Generasi baris G-code di `lines2gcode()`.
- `sortedgcode()`: Algoritma Nearest Neighbor canggih dengan bobot:
  - `yslow`: Rasio bobot lambat sumbu Y vs X (`dy_eff = dy * yslow`).
  - `centersort`: Pemotongan lubang/child dari arah tengah parent keluar (*Center-out*).
  - `greensort`: Titik hijau tertutup sebagai *Blackhole Hub* penarik prioritas.
  - `xsort`, `ysort`, `szsort`: Bias orientasi dan ukuran.
- `draw_line()`: Rendering canvas 2D visualisasi toolpath (garis potong, arah panah, travel dashed).

### D. `cnc.js` (Operasi Khusus: V-Carve, Pocketing, Engraving)
- `vcarve()` & `vcarve_fast()`: Algoritma ukir V-bit. Menghitung kedalaman $Z$ otomatis berdasarkan lebar celah vektor menggunakan segmentasi titik dan spatial grid collision check.
- `pocketcarve()`: Spiral inward area clearing berulang dengan step-over hingga saku tertutup habis.
- `imagedither()` & `cncengrave()`: Raster image processing (Floyd-Steinberg dithering) untuk laser power modulation (`S` parameter) atau CNC peck depth.
- `Potrace.js` integration: Konversi gambar raster (JPEG/PNG) menjadi kurva vektor monokrom.

### E. `cncplanner.js` (Motion Simulator)
- Library simulasi fisika pergerakan CNC independen.
- Meniru Grbl/Smoothieware planner: mengkalkulasi akselerasi, *junction deviation*, dan kecepatan per segmen.
- Menghasilkan durasi potong nyata (estimasi jam:menit:detik) dan mengontrol slider playback simulator di UI.

### F. `gcodex.js` (Binary G-code Compression)
- Kompresi format G-code teks ke byte stream terkompresi (resolusi integer skala $0.005\text{ mm}$ untuk X/Y dan $0.1\text{ mm}$ untuk Z).
- Menghemat ukuran hingga ~50% saat transfer via koneksi berkecepatan terbatas.

---

## 4. END-TO-END DATA FLOW

```text
┌────────────────────────────────────────────────────────┐
│                   1. INKSCAPE (User)                   │
│  User menggambar vektor -> Buka extension KaryaCNC     │
│  File: frontend/inkscape_ex/karyacnc1.py               │
│  Ekstraksi CubicSuperPath -> Subdivision garis lurus   │
│  Penyusunan format string: X:scale / P:style / coords  │
│  Kirim via WebSocket chunks (15KB) + marker >REVECTOR2 │
└───────────────────────────┬────────────────────────────┘
                            │ ws://localhost:8887
                            ▼
┌────────────────────────────────────────────────────────┐
│                   2. BACKEND GO (app.go)               │
│  handleConnection() akumulasi string di strings.Builder│
│  Saat >REVECTOR2 diterima -> EventsEmit:               │
│  runtime.EventsEmit("WS_MESSAGE_RECEIVED", payload)    │
└───────────────────────────┬────────────────────────────┘
                            │ Wails Event
                            ▼
┌────────────────────────────────────────────────────────┐
│              3. FRONTEND LISTENER (karyacnc.js)        │
│  window.listen('WS_MESSAGE_RECEIVED')                  │
│  buff = event.payload                                  │
│  text1 = pathstoText1(buff) (appcore.js)               │
│  refreshgcode()                                        │
└───────────────────────────┬────────────────────────────┘
                            │ Panggil engine
                            ▼
┌────────────────────────────────────────────────────────┐
│               4. CAM PIPELINE (appcore.js)             │
│  myFunction()                                          │
│  ├── Decode Semantik Warna (Cut, Engrave, VCarve, dll) │
│  ├── ClipperLib PolyTree (Identifikasi Parent & Hole)  │
│  ├── ClipperOffset (Tool Radius Compensation)          │
│  ├── sharp() (Corner DogBone / Overcut)                │
│  ├── getcutpos() (Holding Tabs)                        │
│  ├── sortedgcode() (Optimasi urutan travel: Y-slow,    │
│  │                  Center-out, Green Hub)             │
│  └── lines2gcode() (Generate string instruksi G0/G1)   │
└───────────────────────────┬────────────────────────────┘
                            │ Update UI & Data
                            ▼
┌────────────────────────────────────────────────────────┐
│                  5. OUTPUT & EKSEKUSI                  │
│  ├── Ace Editor & Textarea G-code                      │
│  ├── Canvas 2D (Original Path view)                    │
│  ├── CncPlanner (Simulasi & estimasi waktu potong)     │
│  └── Pengiriman ke Mesin:                              │
│      ├── Direct Stream: karyacnc.js sendgcode()        │
│      ├── File Upload: window.invoke('upload_file')     │
│      │   -> app.go UploadFile() POST multipart         │
│      └── Binary Protocol TCP: app.go StartReceiving()  │
└────────────────────────────────────────────────────────┘
```

---

## 5. PROTOKOL DAN KAMUS SEMANTIK

### 5.1 Format Protokol Inkscape -> Backend
String berbasis baris dengan delimiter newline `\n`:
```text
X:1.0                                # Faktor skala koordinat
P:#ffffff:#000000:0                  # P:<fill>:<stroke>:<stroke-width>
10.50,20.30                          # X, Y (mm)
15.20,25.80
20.00,30.10

P:#ff0000:#000000:2
5.00,5.00
10.00,10.00

I,0,0,100,80,image/png               # Blok gambar raster (opsional)
<base64_image_data>

>REVECTOR2                           # Sentinel penanda akhir pengiriman
```

### 5.2 Semantik Warna Vektor (Stroke / Fill)
Mesin menginterpretasikan tipe pengerjaan berdasarkan warna garis/arsiran:

| Warna | Hex Code | Operasi | Keterangan CAM |
|---|---|---|---|
| **Hitam** | `#000000` | Full Cut | Pemotongan tembus (outside/inside offset via Clipper) |
| **Merah** | `#FF0000` | PLT / Marking | Tanpa offset tool radius (offset = 0), speed khusus (`pltfeed`) |
| **Biru** | `#0000FF` | Engrave | Raster ukir bolak-balik dengan modulasi laser/peck |
| **Aqua / Cyan** | `#00FFFF` | V-Carve | Ukir mata V (kedalaman Z dinamis sesuai lebar geometri) |
| **Ungu / Magenta**| `#800080` / `#FF00FF` | Pocket | Pengikisan rongga/area dalam dengan spiral inward |
| **Hijau** | `#008000` / `#00FF00` | Green Travel / Hub | Closed = Blackhole penarik urutan; Open = Rute travel khusus |
| **Teal** | `#008080` | Forced Start Point | Garis bantu untuk menentukan titik mula tusuk potong |

---

## 6. SISTEM LAYANAN JARINGAN & PORT

| Port | Layanan | Di-handle Oleh | Fungsi |
|---|---|---|---|
| **3000** | HTTP Web Server | `app.go` (`startServer()`) | • API Profiles Master-Slave (`/api/profiles`)<br>• SVG Nesting tool (`/v2/`)<br>• Invoice Generator (`/invoice.html`)<br>• RajaOngkir Proxy & L1/L2 Cache (`/api/cost`, `/api/destination`)<br>• Penyimpanan SVG sementara (`/upload-svg`, `/stored-svg`) |
| **8887** | WebSocket & Telegram | `app.go` (`StartWSServer()`) | • WebSocket receiver data dari Inkscape<br>• Endpoint bot Telegram (`/t?bot=..&id=..&t=..`) |
| **8888** | TCP Client Mesin | `app.go` (`ConnectToMachine()`) | Koneksi binary streaming langsung ke controller hardware CNC |

### Binary Protocol Mesin (Port 8888)
Data masuk dari mesin dibaca dalam format biner:
- **Header (2 byte, Little-Endian):**
  - Bit 0–2: Message Type (3 bit)
  - Bit 3–15: Payload Length (13 bit)
- **Type 1 (Machine Position - 17 bytes payload):**
  - `X`, `Y`, `Z`: float32 (masing-masing 4 byte)
  - `Velocity`: float32 (4 byte)
  - `MoveID`: uint8 (1 byte)
  - *Di-emit ke frontend via event:* `machine-position`
- **Type 2 (Machine Job - 66 bytes payload):**
  - `Name`: 64 bytes (string null-terminated)
  - `Status`: uint8 (1 byte)
  - `Progress`: uint8 (1 byte)
  - *Di-emit ke frontend via event:* `machine-job`

---

## 7. STATE MANAGEMENT & ATURAN STORAGE

### Persistensi Konfigurasi
Semua input pengaturan di `frontend/index.html` yang memiliki class **`.saveit`** otomatis dikelola oleh:
1. `savesetting()`: Membaca semua element bernilai ID dengan class `.saveit` dan menyimpannya ke `localStorage['jobsettings']`.
2. `loadsetting()`: Membaca kembali dari `localStorage['jobsettings']` dan mengisi nilai form input/checkbox/select.
3. `saveprofile()` & `loadprofile()`: Memasukkan konfigurasi ke dalam slot profil terpisah (`localStorage['profiles']`).

### Gotcha Penting Auto-Process & Master-Slave
- Perubahan profil di dropdown (`setprofile()`) atau klik riwayat (`loadHistoryIndex()`) **selalu otomatis memicu `refreshgcode()`**. Jangan menghapus trigger otomatis ini karena mencegah salah hitung estimasi harga potong.
- Pada mode Master–Slave:
  - Tombol **Save Profil** pada PC Slave akan selalu menyimpan ke penyimpanan lokal komputer tersebut, tidak pernah menimpa konfigurasi PC Master.

---

## 8. PANDUAN PENGEMBANGAN & CARA REVISI FITUR

### Skenario 1: Menambah Parameter Baru di Pengaturan UI
1. Buka `frontend/index.html`.
2. Tambahkan elemen `<input id="namaparam" class="saveit">` pada tabel opsi yang sesuai.
3. Buka `frontend/public/karyacnc.js`:
   - Tambahkan nilai default di `defaultProfile` (misal `"namaparam": "0"`).
4. Buka `frontend/public/appcore.js` (atau file target yang memerlukan parameter):
   - Ambil nilainya dengan `getnumber("namaparam")` atau `getchecked("namaparam")`.
   - Masukkan ke dalam perhitungan matematika CAM.

### Skenario 2: Menambah API Backend Go Baru untuk Dipanggil Frontend
1. Buka `app.go`:
   - Tambahkan method publik pada struct `App`:
     ```go
     func (a *App) NamaFungsiBaru(param1 string) (string, error) {
         // Logika di sini
         return "hasil", nil
     }
     ```
2. Buka `frontend/public/wails-runtime.js`:
   - Tambahkan case di dalam `invoke`:
     ```javascript
     case 'nama_fungsi_baru':
         return await window.go.main.App.NamaFungsiBaru(args.param1);
     ```
3. Panggil dari JS frontend mana saja:
   ```javascript
   const res = await window.invoke('nama_fungsi_baru', { param1: "nilai" });
   ```

### Skenario 3: Memodifikasi Algoritma Path Sorting / CAM
1. Buka `frontend/public/appcore.js`.
2. Cari fungsi `sortedgcode()`.
3. Komponen kalkulasi jarak per kandidat objek:
   ```javascript
   dis = travel + size*szs + centerRel*(xs,ys) + abs*(xs,ys) + centerOut*csort + green*gsort;
   ```
4. Pastikan komponen anisotropic `yslow` tetap dipertahankan pada setiap kalkulasi selisih `dy`:
   ```javascript
   var dy_eff = (y - ly) * yslowF;
   ```
5. Uji coba dengan membuka tab **Simulator** di UI untuk memverifikasi urutan potong secara visual.

---

## 9. RINGKASAN CEPAT UNTUK CHAT AI BARU (TL;DR 10 DETIK)

1. **Struktur:** Go Backend (`app.go`) + Vanilla JS Frontend (`frontend/public/`). Jangan sentuh `frontend/src/`.
2. **Konektor:** Komunikasi Go <-> JS dihandle oleh `wails-runtime.js` via `window.invoke` dan `window.listen`.
3. **Data Utama:** Vektor masuk dari Inkscape via WS `:8887` -> diterima `app.go` -> event `WS_MESSAGE_RECEIVED` -> diparsing di `appcore.js` -> menghasilkan G-code.
4. **Logika CAM:**
   - Offset, tabs, dogbone, sorting lintasan ada di `appcore.js`.
   - V-Carve & pocketing spiral ada di `cnc.js`.
   - Simulasi fisika motor ada di `cncplanner.js`.
5. **State:** Form dengan class `.saveit` otomatis tersimpan ke `localStorage['jobsettings']` dan ikut ke sistem profil Master-Slave.
6. **Layanan Eksternal:** Port 3000 menyajikan Nesting V2 (`/v2/`) dan Invoice Generator (`/invoice.html`).
