# Kontrak Wire Format — MiniSketch → KaryaCNC (v1)

> **Kepada:** AI implementer di project **MiniSketch asli**.
> **Tujuan:** mendefinisikan format data terstruktur (JSON) yang dikirim MiniSketch ke KaryaCNC sebagai **jalur tol**, menggantikan protokol teks warisan (Inkscape). Format ini **melingkupi semua fitur** yang sudah ada di parser teks Inkscape.
> **Status:** kontrak final untuk diskusi/implementasi. KaryaCNC akan menerapkan sisi penerima sesuai dokumen ini.

---

## 0. Prinsip

- **Path + warna** = mekanisme utama (konsisten dengan Inkscape; warna menentukan operasi).
- **Field opsional eksplisit** (`depth`, `closed`, `fill`, `sub`, `skipJoin`) disediakan untuk hal-hal yang tidak natural/tidak andal diwakili warna.
- **Field yang tak dikenal diabaikan** (forward-compatible). Field wajib minimal: `version`, `paths[].color`, `paths[].pts`.

---

## 1. Transport

- WebSocket ke **`ws://<host>:8887/`** (sama dengan jalur lama).
- Kirim **satu frame JSON** per job, diawali `{` dan mengandung `"type":"job"` → KaryaCNC mengenali jalur tol.
- KaryaCNC membalas **`ACK`** setelah job diterima & ter-emit.

---

## 2. Skema JSON

```jsonc
{
  "type": "job",
  "version": 1,
  "source": "minisketch",          // opsional, untuk debug
  "units": "mm",                   // wajib, hanya "mm"
  "paths": [
    {
      "id": "p1",                 // opsional
      "color": "#000000",          // WAJIB — menentukan operasi (lihat §3)
      "fill": "#ffff00",           // opsional — flip offset (kuning) / gray
      "pts": [[0,0],[10,0],[10,10]], // WAJIB, mm
      "closed": true,              // opsional — jika ada, tidak perlu tebak ujung
      "depth": 3.0,                // opsional, mm — MENGALAHKAN byte-hijau
      "sub": null,                 // opsional — hanya untuk engrave: null | "half_dpi"
      "toolWidth": 0,              // opsional — diameter tool
      "weight": 0,                 // opsional — BOBOT sorting (bertanda +/-, mm penalti jarak)
      "skipJoin": true             // opsional — true = data sudah bersih, skip join/dedupe
    }
  ],
  "images": [
    { "src": "data:image/png;base64,...", "x":0, "y":0, "w":20, "h":20, "transform": null }
  ]
}
```

---

## 3. Warna → operasi (tabel kanonik)

Warna adalah pembawa operasi utama (seperti Inkscape).

| Warna | Operasi | Keterangan |
|---|---|---|
| `#000000` hitam | `cut` | potong penuh (offset tool) |
| `#0000ff` biru | `engrave` (full) | raster ukir resolusi penuh |
| `#000080` biru tua | `engrave` + `sub:"half_dpi"` | residukir setengah (jika dipakai) |
| `#00ffff` cyan | `vcarve` | ukir V-bit |
| `#800080` ungu | `pocket` | saku/area clearing |
| `#ff0000` merah | `mark` | PLT / secondary cutting (offset 0, feed khusus) |
| `#800000` maroon (2 titik) | `cut_tab` | segmen penahan (tab) |
| `#008080` teal **garis** (2 titik) | `start_point` | pointer; memaksa titik mulai di path yang diintersect |
| `#008080` teal **closed** | `origin_point` | penanda titik spindle sekarang (titik 0) |
| `#ffff00` kuning (poligon) | `clip` | batas area engrave/raster |
| `#00ff00` hijau | `travel` | skip/travel boundary |
| `#008000` hijau tua | `travel` (greentravel) | rute travel khusus |

**Catatan teal (penting):**
- Teal **garis (open, 2 titik)** = `start_point` — pointer force-start.
- Teal **closed (poligon)** = `origin_point` — titik spindle sekarang (titik 0).
- Karena kedua peran ini dibedakan lewat `closed`/panjang segmen, KaryaCNC memisahkannya dengan benar.

---

## 4. Field opsional & default

| Field | Default jika tidak ada | Efek |
|---|---|---|
| `fill` | `none` | `#ffff00` → flip offset; `#808000` → gray (offset dalam) |
| `closed` | ditebak dari ujung (toleransi) | jika ada, lebih andal |
| `depth` | default material profile KaryaCNC | jika ada, menggantikan byte-hijau |
| `sub` | `null` | `"half_dpi"` hanya valid utk `engrave` |
| `toolWidth` | default tool | diameter pisau |
| `weight` | `0` | bobot sorting (bertanda); positif = ditunda (dijalankan akhir), negatif = didahulukan |
| `skipJoin` | `false` | `true` = bypass join/dedupe (data sudah bersih) |

---

## 5. Gambar

- `images[]` untuk raster/engrave (sama dengan `I,...` di teks lama).
- `src` = data URL base64; `x,y,w,h` dalam mm; `transform` opsional (string matriks).
- Koordinat sudah relatif terhadap origin yang sama dengan `paths`.

---

## 6. Coverage Matrix (melingkupi fitur teks Inkscape)

| Fitur teks lama | Field di wire |
|---|---|
| `P:<fill>:<stroke>:<stroke-width>` | `fill`, `color`, `toolWidth` |
| `X:<scale>` | `units:"mm"` |
| Warna → operasi | `color` (tabel §3) |
| Byte hijau → depth | `depth` (override opsional) |
| Fill `#ffff00` | `fill:"#ffff00"` |
| Fill `#808000` | `fill:"#808000"` (gray) |
| Ujung sama → closed | `closed` (opsional) |
| Maroon 2 titik → cut tab | `color:"#800000"` + `pts` 2 titik |
| Teal garis → start point | `color:"#008080"` + open 2 titik |
| Teal poligon → spindle titik 0 | `color:"#008080"` + `closed:true` |
| Kuning poligon → clip bounds | `color:"#ffff00"` |
| Hijau `#00ff00` → travel | `color:"#00ff00"` |
| Hijau tua `#008000` → greentravel | `color:"#008000"` |
| `I,...` + b64 → gambar | `images[]` |
| `K,x,y` → offset global | (embedded dalam koordinat `images`) |

**Yang TIDAK dikirim (dihitung KaryaCNC):** origin/bbox, flip & parent/child (containment), `virtualStartPoints`, urutan sort, feed/power/material (dari profile UI).

---

## 7. Contoh payload

### 7.1 Cut sederhana + mark
```json
{
  "type": "job", "version": 1, "units": "mm", "source": "minisketch",
  "paths": [
    { "color": "#000000", "depth": 3, "closed": true, "skipJoin": true,
      "pts": [[0,0],[10,0],[10,10],[0,10]] },
    { "color": "#ff0000", "closed": false, "skipJoin": true,
      "pts": [[20,20],[30,20]] }
  ],
  "images": []
}
```

### 7.2 Dengan start point (teal garis) & spindle (teal closed)
```json
{
  "type": "job", "version": 1, "units": "mm",
  "paths": [
    { "color": "#000000", "closed": true,
      "pts": [[0,0],[100,0],[100,100],[0,100]] },
    { "color": "#008080", "closed": false,
      "pts": [[50,-10],[50,10]] },          // pointer start_point
    { "color": "#008080", "closed": true,
      "pts": [[-5,-5],[5,-5],[5,5],[-5,5]] } // origin_point (spindle titik 0)
  ],
  "images": []
}
```

### 7.3 Dengan gambar (engrave raster)
```json
{
  "type": "job", "version": 1, "units": "mm",
  "paths": [
    { "color": "#0000ff", "closed": true,
      "pts": [[0,0],[50,0],[50,50],[0,50]] }
  ],
  "images": [
    { "src": "data:image/png;base64,iVBORw0KGgo...",
      "x": 5, "y": 5, "w": 40, "h": 40, "transform": null }
  ]
}
```

---

## 8. Aturan & catatan implementasi (untuk AI MiniSketch)

1. **Koordinat dalam mm**, Y-up (sama dengan konvensi KaryaCNC); origin bebas (KaryaCNC menormalkan ke bbox).
2. **`skipJoin:true`** DIANJURKAN untuk job MiniSketch (data sudah dibersihkan/di-join di MiniSketch) — ini yang membuat transfer & pemrosesan jauh lebih cepat.
3. **Jangan kirim hasil containment/sort** — itu urusan KaryaCNC.
4. **`closed`** dikirim eksplisit bila tahu; jika tidak yakin, biarkan dan KaryaCNC menebak dari ujung.
5. **Half-DPI engrave**: jika belum mendukung `sub:"half_dpi"`, cukup kirim biru `#0000ff` (full). Biru tua `#000080` hanya jika fitur half-DPI diimplementasikan.
6. **`version`** selalu 1 untuk kontrak ini; field baru di versi berikutnya ditambahkan tanpa memutus kompatibilitas (field tak dikenal diabaikan).

---

## 9. Referensi
- Sisi penerima (KaryaCNC): `pathstoText1` hydrate dari snapshot terstruktur (post-containment), pemetaan warna→op, specials (cuttab/starttab/clip), `skipJoin`.
- Dokumen terkait: `karyacnc_job_api_plan.md`, `minisketch_fitur_warna_brief.md`.
