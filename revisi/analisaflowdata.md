# ANALISA MENDALAM ALUR DATA: INKSCAPE HINGGA SIAP PROSES PARAMETER FRONTEND

> **Status Dokumen:** Analisa Arsitektur, Profiling Kinerja, Inventarisasi Bug, dan Proposal Optimasi  
> **Fokus:** Pipeline ekstraksi vektor Inkscape $\to$ Transport WebSocket $\to$ Parsing Geometri $\to$ Eksekusi Parameter CAM di Frontend KaryaCNC.

---

## 1. PETA ALUR DATA E2E SAAT INI (AS-IS PIPELINE)

Secara umum, data mengalir melalui 5 tahapan berbeda sebelum menjadi G-code:

```text
[1. INKSCAPE PYTHON]
   User klik Ekstensi KaryaCNC
   └── karyacnc1.py: get_info() -> cspsubdiv() -> export_path()
       └── Membentuk Custom Text Protocol (X:, P:, coords, >REVECTOR2)
           └── Mengirim chunk 15KB via WebSocket TCP socket
                   │
                   ▼ (ws://localhost:8887)
[2. BACKEND GO (app.go)]
   handleConnection(): Membaca pesan teks per-chunk
   └── Akumulasi ke strings.Builder
   └── Deteksi marker sentinel ">REVECTOR2"
   └── runtime.EventsEmit("WS_MESSAGE_RECEIVED", buff.String())
                   │
                   ▼ (Wails Event IPC Serialization)
[3. FRONTEND INGESTION (karyacnc.js)]
   window.listen("WS_MESSAGE_RECEIVED")
   └── buff = event.payload
   └── text1 = pathstoText1(buff) (appcore.js)
   └── savehistory(buff) (Simpan ke localStorage)
   └── refreshgcode()
                   │
                   ▼
[4. GEOMETRY STRUCTURING (appcore.js -> pathstoText1)]
   gs = buff.split("\n")
   ├── Parse Header P (style/warna), X (skala), I (gambar)
   ├── Filter duplikasi titik (< 0.001mm)
   ├── (Opsional) Dedupe & Chaining garis jika enablejoin aktif
   ├── Deteksi penanda khusus (#800000 cuttab, #008080 center, #ffff00 bounds)
   ├── Normalisasi bounding box (offset ke 0,0)
   ├── Deteksi Hierarchy Parent-Child: O(N^2) loop dengan isInside()
   └── BOTTLE-NECK: Konversi balik array titik ke string SVG path (d="M... L...")
       └── Menghasilkan string XML SVG lengkap: text1
                   │
                   ▼
[5. PARAMETER CAM EXECUTION (appcore.js -> myFunction)]
   myFunction(0) dipanggil oleh refreshgcode()
   ├── BOTTLE-NECK: svgPathToCommands(text1) -> Regex tokenize string SVG kembali ke Array!
   ├── Scaling koordinat ulang (25.4 / 96)
   ├── gcodepush() -> prepare_line2():
   │   ├── ClipperLib.ClipperOffset (Tool radius compensation)
   │   ├── sharp() / DogBone bezier generation
   │   └── Tab calculation (jembatan pemotong)
   ├── sortedgcode(): Nearest Neighbor (Y-slow, Center-out, Green hub)
   └── lines2gcode(): Output string G-code akhir ke textarea
```

---

## 2. ANALISA MENDALAM & BOTTLENECK PER BAGIAN

### Bagian 1: Ekstraksi & Serialisasi di Inkscape (`frontend/inkscape_ex/karyacnc1.py`)

1. **Format Serialisasi Teks Kustom:**
   - Script mengekstrak titik-titik kurva setelah di-flatten menggunakan `cspsubdiv(csp, options.flatten)`.
   - Titik dikonversi menjadi string teks baris per baris:
     ```python
     ss += f"{p[0]-xmin},{p[1]-ymin}\n"
     ```
   - *Kelemahan:* Serialisasi float ke string di Python, pemecahan per chunk 15KB (`chunks = [g[i:i+n] for i in range(0, len(g), n)]`), lalu dikirim عبر websocket. Ini memboroskan memory string Python dan bandwidth socket lokal.
2. **Ketiadaan Backpressure Control:**
   - Loop `ws.send(c)` menembak chunk 15KB tanpa menunggu konfirmasi (ACK) per-chunk. Python baru menunggu ACK setelah mengirim marker `>REVECTOR2`. Jika payload sangat besar (>10MB), buffer socket sistem operasi berpotensi jenuh (*socket buffer overflow*).

---

### Bagian 2: Transport & Bridging Go Backend (`app.go`)

1. **Manajemen Buffer Tanpa Timeout:**
   - Di `handleConnection()`:
     ```go
     var buff strings.Builder
     for {
         msgType, message, err := conn.ReadMessage()
         ...
         if text == ">REVECTOR2" {
             runtime.EventsEmit(a.ctx, "WS_MESSAGE_RECEIVED", buff.String())
             buff.Reset()
         } else {
             buff.WriteString(text)
         }
     }
     ```
   - *Resiko:* Jika klien terputus sebelum mengirim `>REVECTOR2`, data yang tersisa tetap tinggal di memori `buff` hingga loop berhenti. Jika klien baru terhubung, data baru tidak sengaja tercampur jika instance handler terbagi (untungnya saat ini goroutine baru per-koneksi, tetapi buffer parsial bocor sebelum `err != nil`).
2. **Overhead Serialisasi IPC Wails:**
   - `runtime.EventsEmit` di Wails v2 men-serialize payload Go string ke dalam JSON event untuk diteruskan ke WebView browser. String 10MB teks mentah akan di-escape ke JSON string (memakan ~2x memori saat serialisasi IPC).

---

### Bagian 3: Parsing Geometri di Frontend (`pathstoText1` di `appcore.js`)

1. **`gs = gx.split("\n")`:**
   - Memecah payload besar ke dalam array puluhan ribu string kecil di heap JavaScript. Hal ini langsung memicu *Garbage Collector (GC) pressure*.
2. **Brute Force Parent-Child Loop $O(N^2)$ dengan `isInside()`:**
   - Di baris 4545–4555 `appcore.js`:
     ```javascript
     for (var j = 0; j < path.length; j += 10) {
         var p = path[j];
         if ((paths[ii][4] > l1) && isInside(p[0], p[1], paths[ii][0])) {
             if (paths[i][9].closed && (psty["fill"] != "#ffff00")) flip = !flip;
             parent.push(ii);
             paths[ii][9].childs++;
             break;
         }
     }
     ```
   - Setiap kontur diuji terhadap kontur lain menggunakan algoritma ray-casting `isInside()`.
   - Pada pola rumit (misalnya ornamen laser atau kisi-kisi ACP dengan 500 lubang), ini melakukan $500 \times 500 = 250.000$ perulangan ray-casting yang membekukan UI (*main-thread freeze*).
3. **Array Prototype Polling:**
   - Kode menggunakan `for (i in paths)` alih-alih `for (let i = 0; i < paths.length; i++)`. Perulangan `for..in` pada array di JavaScript jauh lebih lambat karena mengiterasi properti enumerable dan mengubah indeks numerik menjadi string.

---

### Bagian 4: Bottleneck Terbesar — Anti-Pattern "Roundtrip SVG String"

Ini adalah **temuan paling kritis** dalam arsitektur saat ini:

```text
[Array Koordinat Float [x, y]] (Sudah ada di memory di pathstoText1)
               │
               ▼  (Konversi ke string teks, rounding mround(x), konversi unit mm -> px)
        [String SVG Besar] (text1 = "<svg><path d='M... L...'></svg>")
               │
               ▼  (Diparsing ulang dengan Regex di myFunction)
  [Regex: exec markerRegEx, digitRegEx, reduceRight(), reverse(), parseFloat()]
               │
               ▼  (Konversi unit px -> mm)
[Array Koordinat Float Baru] (line = [[f, x, y], ...])
```

#### Detail Masalah:
1. Di akhir `pathstoText1`:
   - Data koordinat sudah berwujud array `path = [[x1, y1], [x2, y2], ...]`.
   - Tetapi alih-alih menyimpannya langsung, fungsi ini merangkainya kembali menjadi string SVG raksasa:
     `t1 += "M" + xy; ... t1 += " " + xy;`
2. Di awal `myFunction(0)`:
   - String `text1` diparsing kembali menggunakan `svgPathToCommands(text1)`:
     ```javascript
     function svgPathToCommands(svg) {
         var markerRegEx = /[MmLlSsQqLlHhVvCcSsQqTtAaZz]/g;
         var digitRegEx = /-?[0-9]*\.?\d+/g;
         ...
         return results.map(...).reduceRight(...).reverse().map(...);
     }
     ```
   - `reduceRight` melakukan alokasi array baru berulang kali (`all.concat(...)`), menghasilkan kompleksitas alokasi memori kuadratik terhadap jumlah segmen path.
   - Angka yang sudah float diubah jadi teks di `pathstoText1`, lalu di-regex dan di-`parseFloat()` ulang di `myFunction`.
3. **Dampak Nyata:**
   - Setiap kali user mengubah parameter apapun di UI (misal: Feedrate, Plunge, Tab, Dogbone, Safe Z), fungsi `refreshgcode()` dipanggil $\to$ memanggil `myFunction()` $\to$ **menjalankan ulang seluruh siklus regex parse SVG raksasa ini dari nol!**

---

### Bagian 5: CAM Processing & Lifecycle Parameter (`myFunction` & `prepare_line2`)

1. **Rekalkulasi Toolpath Tidak Terpisah:**
   - Parameter cutting terdiri dari 2 kategori:
     - **Kategori A (Geometri):** Tool diameter/offset, dogbone, tab placement, scaling. Jika parameter ini berubah, Clipper offset memang harus dihitung ulang.
     - **Kategori B (Kinematika & Header):** Feedrate (`F`), Plunge speed, Spindle speed (`S`), Safe Z, Dwell time, Start code, End code.
   - *Masalah:* Jika user hanya mengganti nilai **Feedrate** dari 1000 ke 1200, sistem menghitung ulang seluruh Clipper Offset, deteksi sudut tajam DogBone, tab recalculation, dan sorting lintasan dari nol. Padahal koordinat offset-nya tidak berubah sama sekali!
2. **Ketiadaan Debouncing pada UI Input:**
   - Form input kelas `.saveit` memicu pemrosesan ulang saat event `change` atau `input`. Saat mengetik angka, kalkulasi berat dapat terpicu beruntun.

---

## 3. DAFTAR BUG YANG TERDETEKSI

| No | Lokasi | Kode / Masalah | Dampak Kritis |
|---|---|---|---|
| **BUG-1** | `frontend/public/karyacnc.js:2555` | Variabel undeclared di `isInside()`:<br>`inside = 0; j = path.length - 1; for (i in path) { ... }` | Variabel `inside`, `j`, `i`, `xi`, `yi`, `xj`, `yj`, `intersect` menjadi **variabel global**. Perulangan di fungsi lain yang memakai variabel `i` akan rusak ter-overwrite di tengah iterasi. |
| **BUG-2** | `frontend/inkscape_ex/karyacnc1.py:405` | Default argumen parser:<br>`--port default="8888"`<br>Padahal default WS di `app.go` adalah **`8887`** (8888 adalah port TCP mesin CNC). | Jika user Inkscape tidak manual memilih 8887, koneksi extension gagal atau menabrak port TCP mesin. |
| **BUG-3** | `frontend/public/karyacnc.js:922` | `saveProcessToHistory()`:<br>`try { storage.setItem("history", JSON.stringify(text1_history)); } catch (e) { }` | `localStorage` browser memiliki batas 5MB/10MB. Saat user memproses 5-10 job desain kompleks, kuota habis dan error di-`catch` kosong. Akibatnya fitur history mati diam-diam tanpa notifikasi. |
| **BUG-4** | `frontend/public/appcore.js:4618` | `gcstyle.push(sty)` dipanggil 6 kali beruntun di akhir `pathstoText1`. | Merupakan *hack fix* lawas untuk menutupi bug *out-of-bounds index* pada `gcstyle[shapenum]`. Memperlihatkan bahwa pemetaan indeks bentuk (*shape index*) rapuh dan rawan offset jika ada shape yang di-skip. |
| **BUG-5** | `frontend/public/appcore.js:4444` | Perhitungan winding / arah putaran path:<br>`if (sum < 0) paths[i][1] = !paths[i][1];`<br>lalu di baris 4586:<br>`if (paths[i][1]) path = path.reverse();` | Pembalikan urutan titik koordinat manual sebelum masuk ke SVG string kadang bertolak belakang dengan aturan winding `ClipperLib.Orientation()`, memicu arah offset terbalik (seharusnya outside menjadi inside cut). |

---

## 4. PROPOSAL DESAIN SOLUSI & RENCANA OPTIMASI

Berikut adalah rencana optimasi bertahap dari yang paling aman (tanpa mengubah arsitektur inti) hingga restrukturisasi modular modern.

---

### Proposal A: Eliminasi SVG String Roundtrip (Direct Geometry Pipeline)
*Target: Menghemat 60–80% waktu eksekusi saat loading vektor dan 90% memori parse.*

#### Konsep:
Alih-alih `pathstoText1` merangkai SVG string dan `myFunction` mem-parse string tersebut menggunakan Regex, simpan langsung objek geometri bersih di memory.

```javascript
// Struktur Data Bersih (Internal Geometry Model)
window.currentVectorJob = {
    shapes: [
        {
            points: [[x1, y1], [x2, y2], ...], // dalam satuan mm asli
            closed: true,
            style: { stroke: "#000000", fill: "#ffffff", ... },
            isHole: false,
            parentId: -1,
            bounds: { xmin, xmax, ymin, ymax }
        }
    ],
    width: 500,  // mm
    height: 300, // mm
    images: []
};
```

#### Alur Baru:
1. `pathstoText1` memvalidasi dan mengisi `currentVectorJob`.
2. Jika perlu ekspor SVG untuk tombol "Download SVG", fungsi ekspor string SVG hanya dipanggil saat tombol download ditekan (Lazy Generation), bukan di setiap siklus proses data!
3. `myFunction` langsung membaca `currentVectorJob.shapes` tanpa regex, tanpa `reduceRight`, dan tanpa konversi px-to-mm bolak-balik.

---

### Proposal B: Pemisahan Cache Geometri vs Pemrosesan Parameter (Two-Stage Pipeline)
*Target: Slider / input tuning di frontend terasa instan (< 16ms, 60 FPS).*

Pisahkan proses ke dalam dua lapisan state:

```text
┌────────────────────────────────────────────────────────┐
│  STAGE 1: Heavy CAD Computation (Hanya jalan saat ada  │
│           vektor baru masuk dari Inkscape/File)        │
│  - Parsing titik & normalisasi koordinat               │
│  - Chaining & dedupe toleransi join                    │
│  - Hierarchy Parent-Child (Outer vs Hole)              │
│  Hasil dicache di: window.cachedBaseGeometry           │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│  STAGE 2: Light CAM Computation (Jalan saat parameter   │
│           frontend / profil berubah)                  │
│                                                        │
│  Sub-A (Perubahan Tool/Geometri: Offset, Dogbone, Tab):│
│     -> Hitung ClipperOffset dari cachedBaseGeometry    │
│     -> Hitung DogBone & Tabs                           │
│     -> Cache hasil offset di: window.cachedToolpaths   │
│                                                        │
│  Sub-B (Perubahan Sort / Kinematika: Feed, Y-slow):    │
│     -> Cukup ambil cachedToolpaths                     │
│     -> Jalankan sortedgcode() & lines2gcode()          │
│     -> Update teks G-code (Hitungan milidetik!)        │
└────────────────────────────────────────────────────────┘
```

---

### Proposal C: Perbaikan Bug & Modernisasi Kode Geometri

1. **Scope Sanitization pada `isInside()`:**
   - Ganti deklarasi lokal dengan `let` / `const` dan gunakan loop indeks numerik untuk mencegah kebocoran variabel ke `window`:
   ```javascript
   function isInside(x, y, path, idx = 0) {
       let inside = false;
       const len = path.length;
       for (let i = 0, j = len - 1; i < len; j = i++) {
           const xi = path[i][idx], yi = path[i][1 + idx];
           const xj = path[j][idx], yj = path[j][1 + idx];
           const intersect = ((yi > y) !== (yj > y)) && 
                             (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
           if (intersect) inside = !inside;
       }
       return inside;
   }
   ```
2. **Sinkronisasi Port Default Inkscape:**
   - Ubah default argumen di `frontend/inkscape_ex/karyacnc1.py` baris 405 menjadi:
     `self.arg_parser.add_argument("--port", type=str, default="8887", help="Karyacnc port")`
   - Pastikan default di `karyacnc1.inx` juga mengarahkan ke `8887`.
3. **Pemanfaatan `ClipperLib.PolyTree` untuk Parent-Child Hierarchy:**
   - Daripada melakukan uji `isInside()` ray-casting $O(N^2)$ manual di JavaScript, manfaatkan `ClipperLib.Clipper.Execute()` dengan tipe `PolyTree`. Clipper secara otomatis menghasilkan struktur tree parent/child dan orientasi lubang/kontur luar secara matematis dengan efisiensi $O(N \log N)$ menggunakan *sweep-line algorithm*.

---

### Proposal D: Debounce & Storage Quota Protection

1. **Debounce pada Perubahan Input UI:**
   - Pasang fungsi `debounce(fn, 200)` pada event handler input form `.saveit`. User yang mengetik kecepatan `1500` tidak akan memicu kalkulasi 4 kali berturut-turut.
2. **Sanitasi Penyimpanan History (`localStorage`):**
   - Batasi `text1_history` maksimal 5 item.
   - Jangan simpan string mentah yang berisi base64 gambar raster di `localStorage`. Hapus atau pisahkan blok data gambar besar dari payload history.

---

## 5. TABEL PRIORITAS REKOMENDASI IMPLEMENTASI

| No | Tindakan Rekomendasi | Kategori | Tingkat Kesulitan | Dampak Performa / Stabilitas |
|---|---|---|---|---|
| 1 | **Perbaiki bug variabel global `isInside`** | Bug Fix | Sangat Mudah | Menghilangkan bug sporadis race condition & memory leak |
| 2 | **Koreksi default port WebSocket Python ke 8887** | Bug Fix | Sangat Mudah | Menjamin koneksi langsung tanpa setting manual |
| 3 | **Ganti string matching `reduceRight` di `svgPathToCommands`** | Optimasi Cepat | Sedang | Menghilangkan alokasi memori berlebih saat parsing SVG |
| 4 | **Bypass SVG string roundtrip (Direct Geometry Memory)** | Refactoring | Sedang | Kecepatan proses naik **3x – 5x lipat** pada file kompleks |
| 5 | **Two-Stage Pipeline (Cache Geometri vs Refresh G-code)** | Arsitektur | Menengah | Slider feedrate/parameter terasa **instan tanpa delay** |
| 6 | **Ganti loop ray-casting $O(N^2)$ dengan Clipper PolyTree** | Algoritma | Menengah | Mencegah UI freeze pada file dengan ratusan lubang/kontur |
| 7 | **Proteksi kuota `localStorage` & debouncing form** | Stabilitas | Mudah | Mencegah history rusak dan mengurangi beban CPU |

---

*Dokumen ini dibuat sebagai rujukan teknis mendalam untuk langkah revisi dan refactoring performa KaryaCNC.*
