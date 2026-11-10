# Revisi Path Sorting — CNC Router

Tanggal: 2026-09-17
Lokasi kode: `frontend/index.html`, `frontend/public/appcore.js`, `frontend/public/karyacnc.js`, `frontend/public/cncplanner.js`

## 1. Latar belakang / masalah awal

1. Sumbu Y router lebih lambat dari X (gantry Y berat). Jarak travel Euclidean murni
   `sqrt(dx² + dy²)` tidak mencerminkan waktu tempuh riil → mesin boros bolak-balik di Y.
2. Titik mulai potong penting untuk stabilitas bahan: sisi yang sudah lepas duluan bikin
   bahan geser/bergetar. Garis teal (`#008080`) dipakai untuk memaksa titik mulai.
3. Kadang cutting perlu mulai dari tengah bentuk compound (lubang tengah dulu, lalu
   radial keluar, outline paling akhir) agar bahan luar tetap kaku selama mungkin.
4. Perlu titik "pusat kunjungan" (green travel) yang menarik urutan cutting di sekitarnya.

## 2. Yang diimplementasikan

### 2.1. Bobot baru di UI Object Sort (`frontend/index.html`)

| Input | ID | Default | Fungsi |
|---|---|---|---|
| X weight | `xsort` | 0 | Bias arah X (lama, tidak diubah) |
| Y weight | `ysort` | 0 | Bias arah Y (lama, tidak diubah) |
| Size | `szsort` | 0 | Bobot ukuran shape (lama, tidak diubah) |
| Center | `centersort` | 0 | Center-out: lubang/child dekat tengah parent dipotong dulu |
| Y slow x | `yslow` | 1 | Rasio lambat Y vs X (Vx/Vy). 1 = sama, 2 = Y separuh X |
| Green | `greensort` | 0 | Blackhole hijau: cutting dekat titik hijau se-compound naik prioritas |

Semua input pakai class `saveit` sehingga ikut tersimpan di profil.
Defaults profil (`frontend/public/karyacnc.js` → `defaultProfile.part_acp`):
`"centersort": "0"`, `"yslow": "1"`, `"greensort": "0"` (0/1 = perilaku lama, backward compatible).

### 2.2. Y-anisotropic travel (`appcore.js` → `sortedgcode()` / `findnearest()`)

- Baca `yslowR = getnumber('yslow')`, clamp `>= 1`.
- Semua jarak `dy` di `findnearest()` (jalur biasa + jalur garis teal/virtual start points)
  dikali `yslowF`: `dy_eff = (y − ly) × yslow`.
- Komponen skor `(center − head)` juga dibobot: `_cdy = (cy − ly) × yslowR`.
- Efek: travel di Y jadi "lebih mahal" → algoritma otomatis memilih objek yang sejajar
  di X dulu sebelum pindah jauh di Y.

### 2.3. Center-out compound (`appcore.js` → `sortedgcode()`)

- Baca `csort = getnumber('centersort')`, clamp `> 0`.
- Cache `parentCx[shape]` = center shape parent dari `gcodes[][11]`.
- Tiap kandidat child dapat penalti:
  `dis += dist(center kandidat → center parent) × csort` (dy sudah × `yslowR`).
- Kontur luar parent tetap paling akhir via aturan lama `sty.childs > 0` (childs harus
  habis dulu). Hasil: tengah → radial keluar → outline.

### 2.4. Green blackhole (`appcore.js` → `sortedgcode()`)

- Baca `gsort = getnumber('greensort')`, clamp `>= 0`.
- Daftar `greenHoles[]` dibangun dari green **CLOSED** saja:
  `{ x, y, top, idp }` = center (`gcodes[][11]`) + `topparent` + `idp` shape hijaunya.
- Open green TIDAK jadi blackhole — tetap jalur travel G0 biasa.
- Skor tiap kandidat non-hijau:
  `dis += min_dist(ke blackhole SE-GRUP) × gsort`,
  di mana se-grup = `top/idp` blackhole cocok dengan `topparent/idp` kandidat.
  Beda compound = diabaikan. Diambil **terdekat saja (min)**, bukan akumulasi,
  supaya banyak blackhole tidak menjadi center-mass.
- Bonus buta warisan `dis -= 10000` untuk `greentravel` di `findnearest()` **dihapus total**
  (dulu bikin hijau selalu jalan duluan tanpa peduli bobot).
- Green closed tetap ikut sortir + di-output normal sebagai travel loop (tidak disembunyikan),
  jadi shape normal yang overlap dengan green tidak hilang dari gcode.

Rumus skor akhir per kandidat:
`dis = travel + size×szs + centerRel×(xs,ys) + abs×(xs,ys) + centerOut×csort + green×gsort`

### 2.5. Simulator kepotong di job panjang (`frontend/public/cncplanner.js`)

- Bug: play + slider mentok sebelum 100% padahal preview penuh.
- Penyebab: `calculateJobTime()` punya guard `if (totalTimeUs > 3600e6) break;`
  (= 3600 detik = 1 jam) → `pathSegments` kepotong untuk job > 1 jam,
  sedangkan preview statis (`parseGCodeText`) tanpa batas sehingga tampil penuh.
- Perbaikan: guard dinaikkan ke `43200e6` (= 12 jam).

### 2.6. Dokumentasi `greentravel` (hasil investigasi, tanpa ubah perilaku)

- Definisi: `sty.greentravel = (stro == "#008000") || (fill == "#008000")` (`appcore.js`).
- Jalur digambar di desain tapi tidak dipotong — di-output sebagai G0 travel di Z aman
  (`f2 = speedtravel`, `zdown = zretract`, `_re = 1`, `iscut = 1`).
- Preview: garis biru dashed (`nocut`), tidak masuk hitungan panjang potong.
- Beda dengan `greenskip` (`#00ff00`): skip = diabaikan total, travel = tetap di-output
  sebagai gerakan rapid. Gunanya: jalur transit paksa (hindari klem, atur urutan pindah).

## 3. Cara pakai

- Normal (perilaku lama): `Center=0`, `Y slow=1`, `Green=0`.
- Center-out compound: naikkan `Center` (coba 0.5–2), pastikan `finishpart` centang.
- Y lambat: isi `Y slow` = Vx/Vy (misal 1.5–2).
- Green hub: gambar shape hijau closed di area yang mau didatangi dulu, isi `Green`
  0.5–2. Naikkan kalau tarikan kurang kuat, turunkan kalau terlalu dominan vs X/Y/Center.

## 4. Riwayat bug yang ditemukan saat testing

1. Bonus `-10000` warisan bikin hijau selalu jalan duluan walau `Green=0` → diperbaiki
   dengan menghapus bonus buta; prioritas hijau kini murni dari `gsort`.
2. Percobaan "hub transit" (green closed di-skip dari sortir/output) bikin shape normal
   yang overlap dengan green hilang dari gcode → dibatalkan; green closed kembali
   di-output normal, hanya jadi titik acuan skor.
3. Blackhole akumulasi Σ ke semua titik bikin center-mass semu → diganti min-distance,
   dibatasi se-parent (topparent/idp sama).

## 5. Verifikasi

- `node --check` lolos: `appcore.js`, `karyacnc.js`, `cncplanner.js`.
- `index.html` lolos parse HTML (python `html.parser`).
- Testing perilaku (urutan potong, overlap, simulator) dilakukan manual oleh user di browser.
- `frontend/dist/` diabaikan git (hasil build) — tidak diubah manual.
