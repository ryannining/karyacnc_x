# Handoff — AI MiniSketch: Implementasi Pengirim Jalur Tol v1

> **Dari:** pengembang KaryaCNC.
> **Kepada:** AI yang mengerjakan project **MiniSketch asli**.
> **Tujuan:** mengganti cara MiniSketch mengirim data ke KaryaCNC — dari protokol teks warisan ke **JSON terstruktur (jalur tol)** yang lebih cepat dan tanpa konversi berlebihan.
> **Status sisi penerima:** sudah diimplementasikan & diuji di KaryaCNC (backend + adapter + history). Tinggal sisi pengirim di MiniSketch.

---

## 1. Ringkasan tugas

1. Ubah `cncBuildPayload`/`cncSend` di `minisketch/app.js` agar mengirim **JSON** (bukan teks protokol).
2. Tambahkan fitur warna/atribut yang belum ada di MiniSketch (lihat §5).
3. Kirim `skipJoin:true` (data MiniSketch sudah bersih → KaryaCNC skip join, jauh lebih cepat).

---

## 2. Format wire (v1)

Kirim satu frame JSON via WebSocket `ws://<host>:8887/`:

```json
{
  "type": "job",
  "version": 1,
  "units": "mm",
  "paths": [
    {
      "color": "#000000",
      "pts": [[0,0],[50,0],[50,50],[0,50]],
      "closed": true,
      "depth": 3.0,
      "skipJoin": true
    }
  ],
  "images": []
}
```

KaryaCNC menjawab **`ACK`** setelah job diterima. Log `[JOB] memakai CACHE (parsedInput)` = sukses.

---

## 3. Warna → operasi (tabel kanonik)

| Warna | Operasi | Catatan |
|---|---|---|
| `#000000` | cut | potong penuh |
| `#0000ff` | engrave (full) | resolusi penuh |
| `#000080` | engrave half-DPI | **BELUM ada di MiniSketch → tambah swatch** |
| `#00ffff` | v-carve | |
| `#800080` | pocket | |
| `#ff0000` | mark (PLT/secondary) | |
| `#800000` | cut_tab | segmen 2 titik |
| `#008080` **garis** (open, 2 titik) | start_point | pointer; memaksa titik mulai di path yang diintersect |
| `#008080` **closed** (poligon) | origin_point | penanda titik spindle sekarang (titik 0) |
| `#ffff00` | clip | batas area engrave/raster |
| `#00ff00` | travel | |
| `#008000` | travel (greentravel) | |

**Perhatian teal:** dua peran dibedakan lewat `closed` / panjang segmen. Pastikan MiniSketch mengirim teal-garis sebagai open 2 titik, dan teal-poligon sebagai closed.

---

## 4. Field opsional

| Field | Makna |
|---|---|
| `depth` | number (mm), eksplisit — menggantikan hack green-channel |
| `closed` | boolean, eksplisit — hilangkan tebak ujung |
| `fill` | `#ffff00` (flip offset) / `#808000` (gray) / default `#000000` |
| `sub` | `"half_dpi"` untuk engrave setengah resolusi |
| `toolWidth` | diameter tool |
| `skipJoin` | `true` = data sudah bersih, skip join/dedupe |

`depth`/`closed` **opsional**: jika tidak dikirim, KaryaCNC memakai default material / menebak dari ujung.

---

## 5. Yang perlu DITAMBAHKAN di MiniSketch

1. **Swatch `#000080`** (engrave half-DPI).
2. **Atribut eksplisit per objek/entitas:** `depth`, `closed`, `fill`, `skipJoin` (sekarang masih via warna → encoding lama).
3. **Semantik teal:** pastikan mode "start point" menghasilkan teal-garis (open 2 titik), dan mode "spindle/titik 0" menghasilkan teal-poligon (closed).
4. **Ganti `cncSend`:** kirim JSON (contoh §2), bukan teks protokol.

---

## 6. Catatan penting

- **Polyline:** MiniSketch mengirim polyline (`pts` = daftar titik). Curve (circle/arc/spline) **tetap di-flatten di MiniSketch** (via `cncPolyline`/`cncArcSpan` di toleransi CNC). Tidak perlu mengirim bezier sejati di v1.
- **Jangan kirim** hasil containment/sort — itu urusan KaryaCNC.
- **Koordinat mm, Y-up**; origin bebas (KaryaCNC menormalkan).
- Field tak dikenal diabaikan (forward-compatible).

---

## 7. Referensi

- Kontrak lengkap: `revisi/minisketch_wire_contract.md`.
- Pemetaan warna & gap lama: `revisi/minisketch_fitur_warna_brief.md`.
- Sisi penerima: `app.go` (`handleConnection` JSON + `SKETCH_JOB_RECEIVED`), `frontend/public/appcore.js` (`jobFromMiniSketchJSON`, `pathstoText1` hydrate).
