# KaryaCNC — Ringkasan Pekerjaan & Audit Pipeline (3-Tier Cache)

Dokumen ini merangkum (1) pekerjaan yang **sudah** diimplementasikan, (2) hasil audit teknis yang
sempat tertunda, dan (3) sisa pekerjaan + rekomendasinya.

Cakupan mesin aktif: **CNC Router (`CMD_CNC` = 3) dan Laser (`CMD_LASER` = 1)**.
Plasma / Foam / 3D printer dianggap di luar cakupan (tidak dipakai lagi).

> Dokumen ini melengkapi `2stagepipeline.md` (analisa awal 2-stage, sekarang menjadi 3-tier) dan
> `pipeline_audit.md` (audit teknis mentah — appendiks dari dokumen ini).

## Anchor (agar sitasi tetap valid)

| file | md5 | lines |
|---|---|---|
| `frontend/public/appcore.js` | `c78bfb21491f63c63e03b68294f5db0d` | 4776 |
| `frontend/public/karyacnc.js` | `a7173dd841686d100619b9a333ad26c0` | 3385 |

**Cara membaca sitasi.** Semua angka di dokumen ini diverifikasi terhadap snapshot di tabel atas.
`pipeline_audit.md` dipin pada `appcore.js` md5 `4790e59…` (4736 baris) dan **sudah bergeser** dari
snapshot ini — jangan pakai angkanya langsung. Kalau file berubah lagi, re-anchor lewat **nama
fungsi**, bukan nomor baris.

---

## 0. TL;DR

**Selesai**

- Auto-refresh saat edit input **dihapus total** → G-code hanya di-regenerate oleh tombol Process.
- `smartProcess()` memilih tier termurah dari snapshot parameter: **A** (geometri/Clipper),
  **B** (sorting saja), **C** (emit saja).
- `sortedgcode()` dipecah menjadi `sortGcodes()` + `emitGcodeOnly()`, dan `sortGcodes()` dibuat
  **idempotent** (bisa dijalankan berulang) — ini prasyarat Tier B.
- Tier B & C memanggil `gcode_verify(1)` + finalisasi `engcode` dengan urutan identik full rebuild,
  sehingga `finishgcode`, panel info, dan estimasi waktu tidak lagi basi.
- Alat uji `window.STRICT_PIPELINE_VERIFY = true` untuk membandingkan fast path vs full rebuild.
- **BUG-2** (regresi shadowing global dari pemecahan `sortedgcode()`, gejala `M3 Sundefined`)
  sudah diperbaiki — lihat §5.
- `cutclimb` (Climb mill) dan `flipx` (Flip X) dipindahkan dari Tier A ke **Tier B**, dan
  `sxmax/symax/sxmin/symin` dikunci di Stage A sehingga tidak lagi bergantung riwayat tier
  (perbaikan **MISCLASS-1** dan **RISK-5** di §5).

**Belum**

- Cache offset **per objek** (Tier A masih menghitung ulang semua objek).

**Kesimpulan audit yang mengubah rencana**

1. `gcode_verify(1)` **tidak boleh dilewati** — draw loop-nya load-bearing (menghasilkan bbox,
   `jmltravel`, peta `engrave`). Keputusan Tier C memanggilnya sudah benar.
2. Cache offset per objek **feasible secara teknis**, tapi **ROI ≈ 0 di kode saat ini** karena
   tidak ada satu pun input per-objek yang bisa berubah tanpa mengganti dokumen. Lihat §6.
3. Ditemukan **bug latent** di `gcodepush()` (`clk` salah unpack) yang mempengaruhi ambang finish
   pass. Lihat §5 BUG-1.

---

## 1. Pekerjaan yang sudah diimplementasikan

| # | Lokasi | Perubahan |
|---|---|---|
| 1 | `karyacnc.js:2097-2105` | Handler `.saveit` hanya `saveProcessToHistory()`. Tidak ada rebuild otomatis. |
| 2 | `karyacnc.js:1187` / `1199` | `TIER_B_PARAM_IDS`, `TIER_C_PARAM_IDS`. Tier A = seluruh `.saveit` sisanya (dibangun otomatis oleh `buildTierLists()` `karyacnc.js:1220`). |
| 3 | `karyacnc.js:1256` | `smartProcess()` — pemilihan tier + logging + `saveProcessToHistory()`. |
| 4 | `karyacnc.js:1250` | `markPipelineSnapshots()` — dipanggil di akhir `myFunction()` (`appcore.js:3692`) sehingga snapshot selalu sinkron dengan cache setelah full rebuild. |
| 5 | `appcore.js:2405` | `sortedgcode()` = `sortGcodes(); emitGcodeOnly("full rebuild Stage A+B");` |
| 6 | `appcore.js:2416` | `sortGcodes()` — Stage B murni (`gcodes` → `sgcodes`), tidak menyentuh ClipperLib. |
| 7 | `appcore.js:2438-2444` | Prelude idempotensi sorting (lihat §5 RISK-1). |
| 8 | `appcore.js:755` | `gcodepush()` menyimpan `sty.osubchilds` sebagai nilai pristine `sty.subchilds`. |
| 9 | `karyacnc.js:2521` | `refreshgcodeFast()` = Tier C: `emitGcodeOnly()` → `gcode_verify(1)` → finalisasi `engcode`. |
| 10 | `karyacnc.js:2549` | `refreshgcodeSort()` = Tier B: `sortGcodes()` → `emitGcodeOnly()` → `gcode_verify(1)` → finalisasi + update `lastTierBSnapshot`. |
| 11 | `karyacnc.js:2489` | `refreshgcode(scale1)` menerima mode skala; jalur drop SVG luar memakai `refreshgcode(1)`. |
| 12 | `karyacnc.js:2582` | `strictPipelineVerify(label)` (opt-in). |
| 13 | `appcore.js:3204` | Cabang `CMD_3D` di `emitGcodeOnly()` memakai `sxmax`/`symax` (bukan `xmax`/`ymax` yang sudah di-reset). Tidak relevan untuk CNC/Laser. |

### 1a. Peta tier

| Tier | Fungsi | Clipper | Sorting | `gcode_verify` |
|---|---|---|---|---|
| **A** — geometri | `refreshgcode()` → `myFunction()` | ✅ jalan | ✅ jalan | ✅ |
| **B** — sorting | `refreshgcodeSort()` | ❌ dilewati | ✅ **jalan** | ✅ |
| **C** — emit | `refreshgcodeFast()` | ❌ dilewati | ❌ dilewati | ✅ |

- **Tier B** = `xsort ysort szsort centersort yslow greensort safesort separatecut finishpart usestart startat cutclimb flipx`
- **Tier C** = Hitam (`feed feed1x zdown repeat firstd addz tabc slowsmall slowsmallval useslowsmall
  burn1 burnfeed rampdown zdown0 finalz`), Merah (`pltfeed pltpw carved carvedp redrep`),
  bersama (`pup pdn trav dwelltime spindleoff spindleoffval canresume pausecut cutpw acpmode acpstep
  tabinside`), raster outline (`rasteroutline rasteroutfeed rasteroutpw`), lead-in (`leadin useleadin`)
- Semua input lain → **Tier A** (aman: full rebuild). Termasuk `tabofs` yang ternyata **tidak dibaca
  sama sekali** di `appcore.js` (parameter mati).
- `cutclimb` (Climb mill) dan `flipx` (Flip X) **sudah dipindahkan** dari Tier A ke **Tier B**
  (perbaikan **MISCLASS-1** di §5): keduanya tidak dibaca di Stage A, jadi tidak perlu Clipper.

### 1b. Log console (acuan saat testing)

```
[Smart Process] Pemetaan tier: A=94 input (geometri/Clipper), B=13 (sorting), C=37 (emit).
[Smart Process] TIER A (geometri) -> refreshgcode() penuh: Clipper offset + tab + dogbone + sorting dihitung ulang.
[Smart Process] TIER B (sorting) -> refreshgcodeSort(): urutan potong disusun ulang, Clipper DILEWATI.
[Smart Process] TIER C (emit) -> refreshgcodeFast(): hanya teks G-code ditulis ulang, Clipper & sorting DILEWATI.
[Geometry Pipeline] Memakai direct cached geometry (<n> kontur) - BYPASS regex SVG parsing
[Geometry Pipeline] Memakai fallback SVG parser (svgPathToCommands) untuk raw SVG text
[refreshgcodeSort] TIER B: gcodes -> sgcodes (Clipper dilewati)
[refreshgcodeFast] TIER C: sgcodes -> teks G-code (Clipper & sorting dilewati)
[Stage C: Emit] <label> — menulis teks G-code dari <n> cached paths (Clipper tidak dijalankan)
[StrictVerify] OK — <label> identik dengan full rebuild (<n> karakter).
```

Label `[Stage C: Emit]` diisi pemanggil: `full rebuild Stage A+B`, `Tier B (sort-only; sgcodes baru
saja disusun ulang)`, atau `Tier C (emit-only)`.

---

## 2. Audit — `prepare_line2()` (`appcore.js:907`)

Signature: `prepare_line2(lenmm, lines, ofs1)`.

### 2a. Sisi-efek yang WAJIB di-replay oleh cache

| Variabel | Ditulis di | Klasifikasi |
|---|---|---|
| `cuttab_manual` | 908 (`=[]`), 1085 `.push` | **(a) output** → `gcodepush:724/736` → `gcodes[i][9]` → `getcutpos:834` |
| `starttab_manual` | 909 (`=[]`), 1086 `.push` | **(a) output** → jalur sama |
| `centerpath` | 910 (`=[]`), 947/1083 `.push` | **(a) output** → `gcodes[i][11]` → dipakai `sortGcodes` (bobot `centersort`, `yslow`) |
| `maxofs` | 922 (`Math.max(ofs, maxofs)`) | **(a) output** — **running max lintas SEMUA shape**, bukan per-shape → `draw_line:1582-1583` |
| `srl` | 928 (`=[]`), 1141/1149 `.push` | **(a) output** → `gcodes[i][5]` → `lines2gcode`, `draw_line:1889+` |
| `oldlines` | 1091 `.push([lines, sty.num])` | **(a) output** → `gcode_verify:3334-3335` |
| `combinedpath` | 994 `.push([path, clk])` | **(a) output** → `gcodepushcombined:775` |
| `shapectr` | 926 (`++`) | **(a) state posisional** — menggerbangi `disable_ovc` (1098); harus maju 1× per shape walau cache hit |
| `sty.S0` / `sty.S1` | 971 / 1090 | **(a) output** — overlay peringatan di `draw_line:1621` |
| `collapsepoint`, `noprocess`, `dodrill`, `lx/ly`, `vec1/vec2`, `cross`, `overcut`, `sharpv`, `ov`, `sr`, `x/y`, `cxt/cyt/cnt`, `tl2`, `cenx/ceny` | — | (b) scratch / dihitung ulang tiap panggilan |
| `oshapenum` (916), `sty.isPoint` (931/946) | — | (b) **dead write** — tidak pernah dibaca |

Catatan: `sharp()` (`appcore.js:342`) menulis banyak implicit global (`vec1/vec2/cross/overcut` dll).
`prepare_line2` bergantung pada efek samping itu di 1133/1136/1143-1144, tetapi `getcutpos:857` juga
memanggil `sharp()` dan menimpa global yang sama → perlakukan sebagai scratch di dalam satu panggilan.

`prepare_line2` **tidak** menulis `xmin2/xmax2/ymin2/ymax2` (itu milik `linepush:651`), tidak menulis
`warningpath`, `cuttabz`, dan tidak menyentuh `sty.subchilds/osubchilds/exchilds` (itu milik
`gcodepush:715/729/741/755`).

### 2b. Kontrak nilai kembali

Selalu `[pathsArray, clk]`. Empat titik return yang bisa dicapai:

| Kondisi | Return | Isi `pathsArray` |
|---|---|---|
| `cmd==CMD_CNC && lenmm<collapsepoint` (933), `dodrill` aktif | `[newlines, false]` (949) | 1 path titik bor; `sty.isPoint=1`; `centerpath=[centroid]` |
| sama, `dodrill` nonaktif | `[newlines, false]` (949) | `[]` |
| `sty.dovcarve` (993) | `[newlines, clk]` (1096) | **`[]`** — semua path masuk `combinedpath` |
| `disable_ovc` memuat `shapectr`, atau `lenmm<noprocess` (1098) | `[glines, clk]` (1098) | path offset, **tanpa dogbone** |
| normal | `[newlines, clk]` (1161) | path offset + sisipan dogbone |

`else` di 1092-1093 tidak terjangkau karena literal `if (1)` di 953.

**Aliasing:** aman mengembalikan array yang di-cache **by reference** — `newlines`/`glines`
dialokasikan baru tiap panggilan dan tidak ada vertex yang melintas antar panggilan. `gcodepush`
memang menyimpan `lines[i]` by reference ke `gcodes`, tetapi tidak ditemukan penulisan in-place
setelah Stage A (`lines2gcode` hanya membaca `[1]/[2]/[4]`; `emitGcodeOnly:3111` menulis
`sgcodes[j][0][0]`, yaitu slot panjang milik entri `gcodes`, bukan baris vertex).

**Kontrak dua-panggilan (wajib ditiru cache):** untuk shape tertutup dengan `usefinish` aktif,
`gcodepush` memanggil `prepare_line2` **dua kali** — `ofs1=0` (698) lalu `ofs1=finishline` (704).
Kedua panggilan meng-assign ulang `srl`/`cuttab_manual`/`starttab_manual`/`centerpath`; hanya
`centerpath` panggilan pertama yang diselamatkan lewat `var centerpath2 = centerpath` (699). Jadi
pass `"F"` (730-737) memakai `srl`/`cuttab_manual`/`starttab_manual` dari panggilan **kedua** tapi
`centerpath` dari panggilan **pertama**. Cache harus mengembalikan **bundel sisi-efek per panggilan**
dan membiarkan `gcodepush` menyisipkannya persis seperti sekarang.

---

## 3. Audit — `gcode_verify()` (`appcore.js:3217`)

**Kesimpulan: tail-nya TIDAK bisa dijalankan tanpa draw loop.** Loop (3295-3330) bersifat
load-bearing, bukan kosmetik. Peta produsen:

| Input tail | Produsen | Butuh loop? |
|---|---|---|
| `xmax/xmin/ymax/ymin` | di-reset `sortGcodes:2422-2429`; diisi **hanya** oleh `draw_line:1786-1789` | **YA** |
| `w`, `h` | turunan bbox di atas | **YA** |
| `jmltravel`, `travtime`, `sfinal` | `draw_line:1852` (reset 3254) | **YA** |
| peta `engrave` | di-reset 3278; diisi hanya via `draw_line:1784` → `engraveline`/`addengrave` | **YA** |
| `engravetime` | di-reset 3275; `doengrave:1483/1500` — butuh `engrave` terisi | **YA** (transitif) |
| `menit`, panel `gcodeinfo`, `area_dimension` | turunan di atas | **YA** |
| `finishgcode` (3351) | `pup1`, `fz`, `f1` — semua pra-loop | tidak |
| `startgcode` | `emitGcodeOnly` | tidak |
| `e1`, `mat`, `harga`/`hargacut` | emit / DOM / `getvalue` | tidak |
| `gcodecarve` | `dobtvcarve`/`dopocketengrave`/`drawvcarve` (3362-3364, pasca-loop) | tidak |

Konsekuensi kalau loop dilewati:

1. `xmax/xmin` tertinggal di sentinel (`-10000` / `100000`) → `w`,`h`, `pgcode`, dan panel biaya jadi
   sampah; dan `sortGcodes` berikutnya akan menyalin sampah itu ke `sxmax/symax` (`appcore.js:2422`)
   sehingga skala canvas + matematika `flipx`/`rotate` di `lines2gcode` rusak.
2. Peta `engrave` kosong → `doengrave` early-return (`appcore.js:1201`) → seluruh stream raster
   **hilang** dari `engcode`, bukan sekadar basi.

→ Keputusan memanggil `gcode_verify(1)` di Tier B/C (`karyacnc.js:2532`, `2559`) adalah **benar**.
"Minimal finalize" tanpa loop harus mengimplementasikan ulang minimal pass bbox + akumulasi travel +
pembangunan peta `engrave` — artinya mengembalikan loop itu sendiri.

### Bug terpisah yang ketemu saat audit ulang: akumulator waktu bocor di Tier C → harga jasa naik terus (SUDAH DIPERBAIKI)

**Gejala.** Klik **Process** berulang tanpa mengubah parameter apa pun → `CNC Cost` / `TOTAL` di panel
`area_dimension` (`appcore.js:3416`) naik terus. Yang naik hanya komponen jasa (`menit × cutprice`);
Material (`w*h*matprice`) tetap. Label `Est: … minute` (`appcore.js:3406`) ikut naik.

**Root cause.** `menit` (`gcode_verify`:3379) menjumlahkan 6 akumulator, tapi dua di antaranya hanya
di-reset di dalam `sortGcodes()`:

| Akumulator | Di-reset | Ditambah oleh | Reset jalan di Tier C? |
|---|---|---|---|
| `totaltime` | `sortGcodes`:2422 | `lines2gcode`:2313 (lewat `emitGcodeOnly`:3126/3185) | **tidak** → nambah 1× waktu potong per klik |
| `carvetime` | `sortGcodes`:2423 | `cnc.js:584` `vcarve()` (via `dobtvcarve()` ← `gcode_verify`:3375) | **tidak** → bocor kalau job punya jalur V-carve |

Tier C (`refreshgcodeFast`, `karyacnc.js:2521`) hanya `emitGcodeOnly()` → `gcode_verify()`, **tidak**
memanggil `sortGcodes()`. `smartProcess()` (`karyacnc.js:1256`) mengarahkan klik tanpa perubahan ke
Tier C, jadi tiap klik menambah satu kontribusi penuh, dan `menit *= 2` (mode CNC, `:3381`) menggandakan
efeknya. Akumulator lain (`engravetime`/`bitmaptime` di-reset di `gcode_verify`, `jmltravel`:3263 →
`travtime`, `pockettime` di-reset di dalam `pocketgcode()` `cnc.js:1421`) sudah idempotent — pola itulah
yang belum diterapkan pada dua yang bocor. Audit sebelumnya hanya mencatat *di mana* reset berada,
belum bahwa jalur Tier C tidak pernah mencapainya.

**Impact.** Harga jasa yang dilihat/dikutip bisa berkali lipat dari seharusnya (job Rp30.000 jadi
Rp60.000 setelah satu klik ekstra); angka makin memburuk tiap klik, lalu melompat turun lagi begitu ada
klik Tier A (full rebuild) — jadi tidak bisa dipegang sebagai acuan harga.

**Fix** (2 baris, aritmatika tidak disentuh): reset di fungsi yang memproduksi akumulatornya —
`totaltime = 0;` di awal `emitGcodeOnly()` (`appcore.js:2933`) dan `carvetime = 0;` di sebelah
`engravetime = 0; bitmaptime = 0;` di `gcode_verify()` (`appcore.js:3288`). Reset di `sortGcodes`
dibiarkan (redundan tapi aman, masih perlu untuk refresh sort-only).

**Test.** `node tools/price_probe.js` (copy hidup) → semua assertion lolos & harga Rp810 sama untuk
klik 1..4; `node tools/price_probe.js --dir <copy pre-patch>` → harus GAGAL dengan harga naik
Rp810 → 1590 → 2400 → 3210 pada input yang sama. Probe memotong baris `lines2gcode`/`menit` yang asli
dan meng-assert titik reset, jadi ia mendeteksi kalau bug ini kembali.

---

## 4. Arsitektur akhir

```
text1 (SVG string) ──pathstoText1()──► parsedGeometryData[]  (mm, presisi penuh)
                                              │
   myFunction()  ── FAST PATH ────────────────┤   [TIER A]
     ├─ per shape: linepush() → gcodepush() ──┤   Clipper offset (prepare_line2)
     │      · dogbone/overcut                │   + holding tab + finish pass
     │      · holding tab                    │
     ├─ gcodepushcombined()  (Clipper union)  │
     ├─ sortGcodes()  ◄──────────────────────┘   [TIER B]  gcodes → sgcodes
     ├─ emitGcodeOnly()                          [TIER C]  sgcodes → teks G-code
     ├─ gcode_verify(1)                          canvas + bbox + panel
     └─ markPipelineSnapshots()                  snapshot A & B
```

`smartProcess()` membandingkan snapshot: A berubah → Tier A; hanya B → Tier B; lainnya → Tier C.

---

## 5. Temuan bug & risiko

### BUG-1 — `gcodepush()` salah unpack `clk` (latent) — `appcore.js:698-702`

```js
var linesx = prepare_line2(lenmm, line, 0)[0];   // 698  → pathsArray
var centerpath2 = centerpath;
var clk = linesx[1];                             // 700  → elemen path ke-2, BUKAN boolean clk
...
if (!(...) && (lenmm > (clk ? 200 : 50) && getchecked("usefinish"))) ofs1 = getnumber('finishline');
```

Karena `linesx` adalah `pathsArray`, `linesx[1]` adalah **path kedua** (atau `undefined`), bukan
`clk` hasil `isClockwise()`. Panggilan kedua (704-706) benar (`clk = lines2[1]`). Jadi ambang
`usefinish` (50 mm vs 200 mm) ditentukan oleh **jumlah loop** shape, bukan arah potong.

- Dampak: hanya saat `usefinish` dicentang. Shape dengan 1 loop selalu memakai ambang 50 mm.
- Perbaikan yang benar: `var r = prepare_line2(lenmm, line, 0); var linesx = r[0]; var clk = r[1];`

### BUG-2 — regresi shadowing global saat `sortedgcode()` dipecah — **SUDAH DIPERBAIKI**

Gejala: teks **`M3 Sundefined`** muncul di awal **kedua** editor G-code (cutting dan engrave).

Penyebab: saat memecah `sortedgcode()` menjadi `sortGcodes()` + `emitGcodeOnly()`, saya menambahkan
`var` pada 4 nama yang di kode asli adalah variabel **GLOBAL**: `pup1`, `cutpw`, `s`, `se`. Yang
paling fatal `cutpw`: `getspindleon()` (`appcore.js:551`, `556`) membaca global `cutpw`
(dideklarasikan `appcore.js:238`), sehingga setelah `cutpw` menjadi lokal, global-nya tetap
`undefined` dan hasilnya `M3 Sundefined`.

Kelas bug yang sama ditemukan dengan membandingkan pola `var`/tanpa-`var` terhadap `git HEAD`
(kode sebelum pemecahan):

| Jenis | Detail | Perbaikan |
|---|---|---|
| shadowing global | `pup1`, `cutpw`, `s`, `se` diberi `var` padahal global | `var` dilepas |
| hoisting lintas-split | `sty` di-`var` di bagian **emit** kode asli, jadi juga lokal bagi bagian **sort** | tambah `var sty` di `emitGcodeOnly()` (sebelumnya tanpa `var` → jadi global) |
| hoisting lintas-split | `zdown` di-`var` di bagian emit kode asli | tambah `var zdown` di `sortGcodes()`; tanpa itu assignment-nya mencemari global |
| global tidak di-refresh | `speedtravel` saya deklarasikan `var` di emit, sedangkan `lines2gcode():2122` dan `gcode_verify():3244/3332` membaca globalnya → basi saat `trav` berubah di Tier B/C | hapus `var`-nya |

Selain itu `emitGcodeOnly()` sekarang me-refresh 5 skalar global dengan nilai **sama seperti**
`myFunction()` — `speedtravel`, `speedfeed`, `speedplunge`, `speedretract`, `zretract` — karena
Tier B/C tidak menjalankan `myFunction()`. Untuk jalur full rebuild nilainya identik, jadi tidak ada
perubahan perilaku.

Catatan tersisa: `e1` tidak di-reset di Tier B/C sehingga menumpuk; hanya berdampak pada tampilan
gram mode 3D, di luar cakupan CNC/Laser.

### RISK-1 — sorting lama tidak repeatable (SUDAH diperbaiki)

Loop sorting memutasi inputnya sendiri: `gcodes[cs][6] = -gcodes[cs][6]` (area dipakai sebagai
penanda "sudah dipakai", dan syarat eligibilitas `gcodes[i][6] > 0`), plus `sty.subchilds--`.
Tanpa perbaikan, pemanggilan kedua akan menemukan hampir tidak ada shape dan bisa memotong hole
sebelum outline. Prelude `sortGcodes()` (`appcore.js:2438-2444`) me-restore `Math.abs(area)` dan
`sty.subchilds` dari `sty.osubchilds`. `sty.childs` tidak perlu di-restore karena di-reset tiap
iterasi `kk` (`appcore.js:2728`).

### RISK-2 — `maxofs` adalah running max lintas shape (`appcore.js:922`, reset di `3473`)

Cache per-shape **tidak boleh** menyimpan `maxofs` per shape. Kalau nanti cache dipasang, hitung
`maxofs` sebagai max dari seluruh shape **setelah** loop geometri.

### RISK-3 — idempotensi `sortGcodes` belum diuji runtime

Argumen di atas berasal dari pembacaan kode. Bukti runtime yang paling murah: klik Process
berulang sambil berganti-ganti sorting weight, dan pastikan angka `<n> cached paths` di log
`[Stage C: Emit]` **tidak berubah**. Kalau angka itu turun/berubah sendiri → guard gagal.

### RISK-4 — array vertex dipakai by reference (belum terbukti ekshaustif)

Argumen "tidak ada penulisan in-place setelah Stage A" berasal dari grep bertarget. Kalau nanti ada
emitter baru yang menulis ke `sgcodes[i][0][4][k]`, cache-by-reference jadi tidak aman.

### MISCLASS-1 — `cutclimb` dan `flipx` salah masuk Tier A — **SUDAH DIPERBAIKI**

Ditemukan saat pengujian GUI: mencentang **Climb mill** (`cutclimb`, `index.html:920`) memicu
**Tier A**. Padahal keduanya **tidak dibaca sama sekali di Stage A** (`prepare_line2` 907-1170 dan
`gcodepush` 684-758 bersih dari keduanya). Semua pembacaannya:

| Param | Lokasi pembacaan | Sifat |
|---|---|---|
| `cutclimb` | `getcutpos:838` (dipakai `emitGcodeOnly:3114`) | posisi mulai potong / tab |
| `cutclimb` | `draw_line:1656` | gambar |
| `cutclimb` | `lines2gcode:2011` | arah travel |
| `flipx` | `getcutpos:839` | posisi mulai potong / tab |
| `flipx` | `draw_line:1657` | gambar |
| `flipx` | `lines2gcode:2077-2079` | mirror koordinat |
| `flipx` | `emitGcodeOnly:3153`, `3199` | arah & `sc` |
| `flipx` | `gcode_verify:3349` | `sc` |

Penyebabnya adalah **desain default saya**: `TIER_B_PARAM_IDS`/`TIER_C_PARAM_IDS` eksplisit dan
semua `.saveit` lain otomatis jadi Tier A agar aman. Catatan perencanaan saya sebelumnya sempat
mengklaim keduanya dibaca di `prepare_line2` — itu keliru, berasal dari scan rentang baris
684-1200 yang juga mencakup `getcutpos` (832) dan `draw_line`. Jadi ini **bukan** perilaku yang
disengaja.

**Tier yang benar: B, bukan C.** `getcutpos` menyimpan hasilnya di cache `cachedcutpos[index]`
(`appcore.js:833/895`) dan cache itu **hanya** dibersihkan di `sortGcodes()` (`appcore.js:2417`).
Kalau `cutclimb`/`flipx` dipindah ke Tier C, `refreshgcodeFast()` tidak menjalankan `sortGcodes()`
sehingga posisi mulai potong/tab akan **basi** (sementara `lines2gcode`/`draw_line` tetap berbalik →
output jadi tidak konsisten). Jadi pindahkan keduanya ke `TIER_B_PARAM_IDS`, atau ke Tier C dengan
tambahan `cachedcutpos = []` di `refreshgcodeFast()`.

**Perbaikan (sudah diterapkan):** `cutclimb` dan `flipx` dipindahkan ke `TIER_B_PARAM_IDS`
(`karyacnc.js:1187`), jadi mencentangnya memakai Tier B — `sortGcodes()` tetap jalan (sehingga
`cachedcutpos` dibersihkan) tetapi Clipper offset tidak dijalankan lagi.

### RISK-5 — `sxmax` bergantung riwayat tier → bisa mengubah output saat `flipx` aktif — **SUDAH DIPERBAIKI**

Dulu `sortGcodes()` menyalin bbox ke `sxmax/symax/sxmin/symin` lalu me-reset
`xmax/xmin/…`. Masalahnya, nilai `xmax` saat itu **berbeda asalnya** tergantung tier:

- **Tier A**: `xmax` berasal dari `linepush` = batas **geometri asli**.
- **Tier B**: `xmax` berasal dari `draw_line` (`appcore.js:1786-1789`) = batas **jalur offset**, yang
  bisa lebih lebar dari aslinya sebesar radius tool.

`sxmax` dipakai untuk: mirror `flipx` di `lines2gcode:2077-2079` dan `draw_line`, serta skala canvas
`dpm` (`draw_line:1644-1645`). Jadi ketika **`flipx` aktif**, referensi mirror bisa bergeser
(sebesar offset tool) hanya karena tier yang dipakai berbeda → koordinat X yang di-emit ikut berbeda
dibanding full rebuild. Saat `flipx` mati, efeknya hanya skala zoom canvas (kosmetik).

**Perbaikan (sudah diterapkan):** 4 baris `sxmax/symax/sxmin/symin = xmax/ymax/xmin/ymin`
dipindahkan dari `sortGcodes()` ke Stage A — `myFunction()`, tepat sebelum `gcodepushcombined()`
(`appcore.js:3678-3681`). Untuk full rebuild nilainya identik (`gcodepushcombined()` tidak menyentuh
`xmax`), tetapi sekarang Tier B/C mewarisi nilai itu apa adanya sehingga konsisten.

`window.STRICT_PIPELINE_VERIFY = true` seharusnya menangkap RISK-5 ini — uji dengan `flipx` aktif.

---

## 6. Rencana cache offset per objek (BELUM dikerjakan) — dan mengapa ROI-nya ≈ 0

### 6a. Desain yang diperlukan (kalau tetap dikerjakan)

1. **Key per shape:** `(index, ofs1, hash(points), geoKey, styleKey)`.
   `geoKey` = seluruh parameter geometri global (`offset`, `pltmode`, `overcutmode`, `overcut2`,
   `overcutmin`, `ovcmore`, `sharp`, `tabevery`, `tabmax`, `tablen`, `scale`, `curveseg`, `smooth`,
   `segment`, `minR`, `enablejoin`, `drill`, `dodrill`, `flipx`, `cutclimb`, `cmd`).
   `styleKey` = field `sty` yang mempengaruhi hasil (`stroke-width`, `domarking`, `dovcarve`,
   `dopocket`, `doEngrave`, `greenskip`, `greentravel`, `sortadd`, `cuttab`).
2. **Bundel sisi-efek + replay.** Setiap entri cache menyimpan
   `{ paths, clk, srl, cuttab_manual, starttab_manual, centerpath, S0, S1, oldlinesEntry, combinedpathEntry, ofs }`
   dan **memutar ulang** semuanya saat hit (lihat §2a). Tanpa replay, output berubah.
3. **`maxofs`** dihitung ulang setelah loop (RISK-2).
4. **`shapectr`** tetap `++` sekali per shape, hit maupun miss (state posisional).
5. **Interleaving dua-panggilan** `ofs1=0` → `ofs1=finishline` harus ditiru persis (§2b).
6. **Invalidasi:** cache dibuang saat `parsedGeometryData` dibangun ulang (dokumen baru).

### 6b. Mengapa ROI-nya ≈ 0 di kode saat ini

Supaya sebuah entri cache bisa **hit** saat parameter geometri berubah, harus ada input **per-objek**
yang bisa berubah tanpa mengganti dokumen. Saya sudah menelusuri kandidatnya:

| Array kontrol per-objek | Ditulis oleh UI? |
|---|---|
| `disable_ovc` | ❌ tidak ada penulis (hanya `var` di `appcore.js:90`) |
| `marking_cut` | ❌ hanya deklarasi (`appcore.js:91`) |
| `disable_cut` | ❌ hanya deklarasi (`appcore.js:93`) |
| `disable_tab` | ❌ hanya deklarasi (`appcore.js:92`) |
| `cuttabs` / `starttabs` | ❌ hanya dimuat dari `localStorage` (`karyacnc.js:737`); tidak ada yang `.push` |

Artinya seluruh array kontrol per-objek itu **vestigial** — sisa dari `appcore.old.js` yang dulu
diisi UI (lihat `appcore.old.js:3404-3425`). Field `sty.*` (warna → `domarking`, `dovcarve`,
`dopocket`, `doEngrave`, `stroke-width`, …) semuanya **diturunkan dari SVG**, jadi hanya berubah
saat dokumen berganti. Parameter geometri global (`offset`, dogbone, tab, `scale`) mengenai
**semua** shape.

Kesimpulan: setiap perubahan geometri saat ini meng-invalidasi **seluruh** cache, sehingga cache
per-objek tidak akan pernah hit kecuali tidak ada perubahan sama sekali — dan kasus itu sudah
ditangani Tier B/C. **Rekomendasi: jangan kerjakan dulu.**

### 6c. Alternatif yang lebih berdampak

1. **Ukur dulu.** Bungkus `prepare_line2` / `sortGcodes` / `emitGcodeOnly` / `gcode_verify` dengan
   `console.time`/`performance.now()` dan catat waktunya di log tier. Tanpa data ini, optimasi
   berikutnya hanya tebak-tebakan.
2. **Hindari panggilan `prepare_line2` ganda.** Saat `usefinish` aktif, tiap shape tertutup
   diproses Clipper **dua kali** (`gcodepush:698` + `704`) — calon penghematan terbesar di Stage A.
   Perbaiki BUG-1 sekaligus, lalu ukur.
3. **Batasi Tier A ke satu mode mesin.** Untuk CNC/Laser, cabang `CMD_PLASMA`/`CMD_FOAM`/`CMD_3D`
   di seluruh pipeline bisa diabaikan saat profiling, sehingga noise berkurang.

---

## 7. Checklist verifikasi (manual, via GUI)

**A. Dasar**
1. Ubah input **tanpa** klik Process → isi editor G-code tidak berubah.
2. Klik Process → baru berubah.

**B. Pemilihan tier** — cocokkan dengan tabel §1a; log acuan di §1b.

**C. Idempotensi (paling penting)**
3. Klik Process berulang sambil bergantian mengubah sorting weight. Angka `cached paths` di log
   `[Stage C: Emit]` harus **tetap**. Kalau berubah → guard RISK-1 gagal.

**D. Paritas hasil**
4. `window.STRICT_PIPELINE_VERIFY = true` → lakukan aksi Tier B dan Tier C. Harus muncul
   `[StrictVerify] OK`. Kalau `BEDA`, catat "beda pertama di offset N" + dua snippet JSON-nya.
5. Pengecualian yang diharapkan: kontur **terbuka** bisa berbeda urutan bila `carved`,
   `carvedp`, `firstd`, `repeat`, atau `burn1` berubah (paritas jumlah pass mempengaruhi titik
   akhir travel). Closed cut harus selalu identik.

**E. Efek samping perbaikan finalisasi**
6. Ubah **hanya** `pup` → Process → periksa **ekor G-code** hasil upload (dulu `finishgcode` basi).
7. Panel info (Width×Height, DOC, Feed, Est, biaya) ikut update saat Tier B/C.
8. Tombol download & simulator tetap update.
9. Klik item history → full rebuild; klik Process lagi → harus **TIER C**.
10. Load profil → sama.
11. `separatecut` → TIER B, dan urutan "hitam dulu, baru merah" tetap benar.

---

## 8. Lampiran

- `pipeline_audit.md` — audit teknis mentah (`prepare_line2` inventory, return contract,
  `gcode_verify` producer map). Angkanya sudah bergeser dari snapshot sekarang — re-anchor lewat nama fungsi.
- `2stagepipeline.md` — analisa awal 2-stage (sekarang menjadi 3-tier).
- `analisaflowdata.md`, `panduan.md`, `path_sorting.md` — dokumen analisa sebelumnya.
