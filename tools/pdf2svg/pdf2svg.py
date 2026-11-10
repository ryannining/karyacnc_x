import argparse
import math
import os
import sys
import time
from collections import Counter, defaultdict

import fitz  # PyMuPDF
import svgwrite
from shapely.geometry import LineString
from shapely.ops import linemerge

PT_TO_MM = 25.4 / 72.0


# ---------------------------------------------------------------------------
#  Linearisasi cubic Bezier → LineString (de Casteljau subdivision)
# ---------------------------------------------------------------------------
def cubic_to_lines(p0, p1, p2, p3, flatness):
    """
    Konversi cubic Bezier (P0, P1, P2, P3) jadi list titik sample.
    Adaptive subdivision: bagi dua kurva sampai 'flatness' (simpangan
    maksimum dari garis lurus) ≤ threshold.

    flatness: toleransi deviasi dalam unit yang sama dengan koordinat
              (mis. mm). Semakin kecil → semakin halus → lebih banyak vertex.
    """
    def _is_flat(p0, p1, p2, p3, tol_sq):
        # Jarak titik kontrol P1 dan P2 dari garis P0-P3
        ux, uy = p3[0] - p0[0], p3[1] - p0[1]
        vx1, vy1 = p1[0] - p0[0], p1[1] - p0[1]
        vx2, vy2 = p2[0] - p0[0], p2[1] - p0[1]
        len_sq = ux * ux + uy * uy
        if len_sq == 0:
            return True
        # Cross product / panjang garis
        d1 = abs(ux * vy1 - uy * vx1) / math.sqrt(len_sq)
        d2 = abs(ux * vy2 - uy * vx2) / math.sqrt(len_sq)
        return max(d1, d2) ** 2 <= tol_sq

    def _subdivide(p0, p1, p2, p3, tol_sq, out):
        if _is_flat(p0, p1, p2, p3, tol_sq):
            out.append(p3)
            return
        # de Casteljau
        p01  = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
        p12  = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
        p23  = ((p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2)
        p012 = ((p01[0] + p12[0]) / 2, (p01[1] + p12[1]) / 2)
        p123 = ((p12[0] + p23[0]) / 2, (p12[1] + p23[1]) / 2)
        p0123 = ((p012[0] + p123[0]) / 2, (p012[1] + p123[1]) / 2)
        _subdivide(p0, p01, p012, p0123, tol_sq, out)
        _subdivide(p0123, p123, p23, p3, tol_sq, out)

    points = [p0]
    if flatness > 0:
        _subdivide(p0, p1, p2, p3, flatness * flatness, points)
    else:
        # fallback: sample 16 titik
        for i in range(1, 17):
            t = i / 16
            u = 1 - t
            x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
            y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
            points.append((x, y))
    return points


def get_nearest_color(rgb_tuple):
    if not rgb_tuple:
        return (0, 0, 0)
    r, g, b = [x * 255 for x in rgb_tuple]
    palette = [(0, 0, 0), (255, 0, 0), (0, 0, 255)]
    return min(
        palette, key=lambda c: (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2
    )


def remove_duplicate_lines(lines):
    unique = []
    seen = set()
    for line in lines:
        c_fwd = tuple(line.coords)
        c_rev = tuple(reversed(line.coords))
        if c_fwd not in seen and c_rev not in seen:
            seen.add(c_fwd)
            unique.append(line)
    return unique


# ---------------------------------------------------------------------------
#  Merge berbasis Pairwise Midpoint Snap (tanpa union-find, tanpa centroid)
# ---------------------------------------------------------------------------
def merge_lines_with_tolerance(lines, tolerance):
    """
    Merge path yang ujungnya berdekatan dalam jarak ≤ tolerance.

    Algoritma:
      Fase 1: PAIRWISE MIDPOINT SNAP
        - Bangun spatial hash dari semua endpoint
        - Cari pasangan endpoint berdekatan (jarak ≤ tolerance)
        - Untuk setiap pasangan: kedua endpoint di-snap ke TITIK TENGAH
          (midpoint, bukan centroid global — tidak ada endpoint yang
           "tersedot" ke lokasi jauh)
        - Setiap endpoint hanya boleh di-snap sekali (paired sekali)
      Fase 2: DEDUP
        - Hapus segmen duplikat setelah snapping
      Fase 3: LINEMERGE
        - Gabungkan segmen berantai

    Properti penting:
      - Midpoint = rata-rata 2 titik, sehingga pergeseran maksimum
        setiap endpoint = tolerance/2 (bukan seluruh rentang kluster)
      - Tidak ada union-find → tidak ada transitive clustering
      - Endpoint asli (yang tidak punya pasangan dekat) tidak bergeser
    """
    if not lines or tolerance <= 0:
        return list(lines)

    # ── Kumpulkan semua endpoint ──────────────────────────────────────
    endpoints = []       # [(x, y), ...]
    endpoint_info = []   # [(segment_index, is_start), ...]

    for i, line in enumerate(lines):
        coords = list(line.coords)
        if len(coords) < 2:
            continue
        endpoints.append(coords[0])
        endpoint_info.append((i, True))    # start
        endpoints.append(coords[-1])
        endpoint_info.append((i, False))   # end

    n_ep = len(endpoints)
    if n_ep == 0:
        return []

    # ── Fase 1a: Spatial hash untuk kandidat pasangan ────────────────
    cell_size = tolerance
    grid = defaultdict(list)

    for idx in range(n_ep):
        x, y = endpoints[idx]
        cx = int(math.floor(x / cell_size))
        cy = int(math.floor(y / cell_size))
        grid[(cx, cy)].append(idx)

    # ── Fase 1b: Cari pasangan, hitung midpoint ──────────────────────
    tol_sq = tolerance * tolerance
    pairs = []  # (dist_sq, idx_a, idx_b, midpoint)

    for idx in range(n_ep):
        x, y = endpoints[idx]
        cx = int(math.floor(x / cell_size))
        cy = int(math.floor(y / cell_size))

        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                cell_key = (cx + dx, cy + dy)
                if cell_key not in grid:
                    continue
                for jdx in grid[cell_key]:
                    if jdx <= idx:
                        continue
                    x2, y2 = endpoints[jdx]
                    dist_sq = (x - x2) ** 2 + (y - y2) ** 2
                    if dist_sq <= tol_sq:
                        # Hindari snap endpoint dalam satu segmen yang sama
                        seg_a = endpoint_info[idx][0]
                        seg_b = endpoint_info[jdx][0]
                        if seg_a == seg_b:
                            continue
                        mid = (
                            round((x + x2) / 2, 6),
                            round((y + y2) / 2, 6),
                        )
                        pairs.append((dist_sq, idx, jdx, mid))

    # ── Fase 1c: Terapkan midpoint (setiap endpoint hanya dipakai 1×) ─
    # Sort by distance → pasangan terdekat diproses dulu
    pairs.sort(key=lambda p: p[0])

    snap_target = {}     # endpoint_index → (x, y)
    used_endpoints = set()

    for _, idx_a, idx_b, mid in pairs:
        if idx_a in used_endpoints or idx_b in used_endpoints:
            continue
        snap_target[idx_a] = mid
        snap_target[idx_b] = mid
        used_endpoints.add(idx_a)
        used_endpoints.add(idx_b)

    # ── Bangun mapping: segment_index → endpoint indices ─────────────
    start_ep = {}
    end_ep = {}
    for ep_idx, (seg_idx, is_start) in enumerate(endpoint_info):
        if is_start:
            start_ep[seg_idx] = ep_idx
        else:
            end_ep[seg_idx] = ep_idx

    # ── Terapkan snap ke setiap segmen ───────────────────────────────
    snapped = []
    for i, line in enumerate(lines):
        coords = list(line.coords)
        if len(coords) < 2:
            continue

        new_coords = list(coords)
        if i in start_ep and start_ep[i] in snap_target:
            new_coords[0] = snap_target[start_ep[i]]
        if i in end_ep and end_ep[i] in snap_target:
            new_coords[-1] = snap_target[end_ep[i]]

        # Hapus titik berurutan yang sama (akibat snapping)
        deduped = [new_coords[0]]
        for c in new_coords[1:]:
            if c != deduped[-1]:
                deduped.append(c)

        if len(deduped) >= 2:
            snapped.append(LineString(deduped))

    if not snapped:
        return []

    # ── Fase 2: Dedup setelah snapping ───────────────────────────────
    snapped = remove_duplicate_lines(snapped)

    # ── Fase 3: linemerge (GEOS C-optimized, sangat cepat) ──────────
    try:
        merged = linemerge(snapped)
    except Exception:
        return snapped

    if merged.geom_type == "LineString":
        return [merged]
    elif merged.geom_type == "MultiLineString":
        return list(merged.geoms)
    return snapped


# ---------------------------------------------------------------------------
#  Proses satu halaman
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
#  Penandaan arsiran (CAD hatch) → satu WARNA per keluarga sudut
#
#  Algoritma sederhana (permintaan user):
#    1. Catat sudut tiap segmen garis lurus terhadap sumbu datar (mod 180°).
#    2. Kelompokkan per 1°; bin yang berdekatan (±1°) digabung jadi satu
#       keluarga. Keluarga dengan anggota > min_parallel = arsiran.
#    3. TIDAK dihapus — tiap keluarga diberi WARNA BERBEDA (rotasi hue),
#       nanti di Inkscape hapus satu-per-satu via select-by-color.
# ---------------------------------------------------------------------------
def _family_color(i):
    """Warna berbeda per keluarga: rotasi hue golden-angle. i=0 → merah."""
    import colorsys
    hue = (i * 137.508) % 360
    r, g, b = colorsys.hsv_to_rgb(hue / 360, 1, 1)
    return (round(r * 255), round(g * 255), round(b * 255))


def mark_parallel_hatch(color_lines, min_parallel=10, bin_deg=1, curve_idx=None):
    """
    Ubah warna tiap keluarga garis paralel (sudut sama, anggota >
    min_parallel) menjadi warna khusus per keluarga.

    Hanya segmen GARIS LURUS asli PDF (item 'l'/'re'/'qu') yang dihitung
    dan ditandai. Kurva bezier hasil linearisasi (chord 2 titik) tidak
    ikut — sudutnya menyebar dan bukan arsiran.

    curve_idx: {color: set(idx)} indeks garis yang berasal dari kurva.
    Return: (color_lines_baru, stats_dict)
    """
    curve_idx = curve_idx or {}
    n_bins = 180 // bin_deg
    angle_cnt = Counter()
    seg_bin = {}                      # (color, idx) → bin sudut
    for color, lines in color_lines.items():
        curves = curve_idx.get(color, ())
        for idx, line in enumerate(lines):
            if idx in curves:
                continue
            coords = list(line.coords)
            if len(coords) != 2:
                continue
            (x1, y1), (x2, y2) = coords
            if math.hypot(x2 - x1, y2 - y1) <= 0:
                continue
            b = int(round(math.degrees(math.atan2(y2 - y1, x2 - x1))
                          % 180 / bin_deg)) % n_bins
            angle_cnt[b] += 1
            seg_bin[(color, idx)] = b

    tol_pt = 1.0                 # toleransi bin sudut (°) — dash menyebar
                                 # ±1° dianggap satu keluarga arsiran
    min_pts = 20                 # ambang minimum agar penyebaran dihitung
                                 # sebagai satu keluarga (bukan kebetulan)

    def _near(b, center):
        d = abs(b - center)
        return min(d, n_bins - d) <= tol_pt

    # -- bentuk keluarga dari pusat dominan (terbesar duluan) ------------
    families = []                # [(center, [bin...], total_anggota)]
    claimed = set()
    for center, n in angle_cnt.most_common():
        if n <= min_pts:
            continue
        if center in claimed:
            continue
        family = [b for b in angle_cnt if _near(b, center) and b not in claimed]
        if not family:
            continue
        total_family = sum(angle_cnt[b] for b in family)
        if total_family > min_parallel:
            families.append((center, family, total_family))
            claimed.update(family)

    if not families:
        print("   ℹ️  Tidak ada keluarga garis paralel melebihi "
              f"{min_parallel} anggota.")
        return color_lines, {"marked": 0, "families": []}

    # -- keluarga terbesar → warna pertama (merah), dst ------------------
    families.sort(key=lambda f: -f[2])
    bin2color = {}
    for i, (center, family, _tot) in enumerate(families):
        col = _family_color(i)
        for b in family:
            bin2color[b] = col

    new_lines = defaultdict(list)
    count_by_color = Counter()
    for color, lines in color_lines.items():
        for idx, line in enumerate(lines):
            b = seg_bin.get((color, idx))
            if b is not None and b in bin2color:
                new_lines[bin2color[b]].append(line)
                count_by_color[bin2color[b]] += 1
            else:
                new_lines[color].append(line)

    total = sum(count_by_color.values())
    print(f"   🎨 {total} garis arsiran ditandai, {len(families)} keluarga "
          f"sudut (ambang >{min_parallel} garis):")
    for i, (center, family, tot) in enumerate(families):
        col = bin2color[family[0]]
        hexc = "#{:02x}{:02x}{:02x}".format(*col)
        ang_lo = min(family) * bin_deg
        ang_hi = max(family) * bin_deg
        rng = f"{ang_lo}°" if ang_lo == ang_hi else f"{ang_lo}-{ang_hi}°"
        print(f"      {hexc}  {rng:10s} {tot:6d} garis")
    stats = {"marked": total,
             "families": [{"color": bin2color[f[1][0]],
                           "angle": f[0] * bin_deg,
                           "count": f[2]} for f in families]}
    return new_lines, stats


def process_page(page, svg_path, scale, tolerance_mm, merge=True, simplify=True,
                 flatness_mm=0.05, remove_hatch=False, min_parallel=10):
    W_pt, H_pt = page.rect.width, page.rect.height

    stats = {
        "initial_lines": 0,
        "after_dedup": 0,
        "after_merge": 0,
        "final_lines": 0,
        "initial_vertices": 0,
        "final_vertices": 0,
        "curves": 0,
        "texts": 0,
    }
    timings = {}

    t_total_start = time.perf_counter()

    def transform(pt):
        x, y = pt.y, W_pt - pt.x
        return (round(x * PT_TO_MM * scale, 3), round(y * PT_TO_MM * scale, 3))

    color_lines = defaultdict(list)
    curve_idx = defaultdict(set)   # color → {idx garis dari kurva bezier}
    flatness_scaled = flatness_mm * scale

    # ── Ekstraksi ─────────────────────────────────────────────────────
    t0 = time.perf_counter()
    for draw in page.get_drawings():
        color = get_nearest_color(draw.get("color") or draw.get("fill"))
        for item in draw["items"]:
            if item[0] == "l":
                color_lines[color].append(
                    LineString([transform(item[1]), transform(item[2])])
                )
            elif item[0] == "c":
                p0, p1, p2, p3 = (
                    transform(item[1]),
                    transform(item[2]),
                    transform(item[3]),
                    transform(item[4]),
                )
                # Linearisasi cubic bezier → LineString (ikut merge)
                pts = cubic_to_lines(p0, p1, p2, p3, flatness_scaled)
                if len(pts) >= 2:
                    curve_idx[color].add(len(color_lines[color]))
                    color_lines[color].append(LineString(pts))
                    stats["curves"] += 1
            elif item[0] == "re":
                r = item[1]
                pts = [
                    transform(p)
                    for p in [
                        fitz.Point(r.x0, r.y0),
                        fitz.Point(r.x1, r.y0),
                        fitz.Point(r.x1, r.y1),
                        fitz.Point(r.x0, r.y1),
                    ]
                ]
                for i in range(4):
                    color_lines[color].append(LineString([pts[i], pts[(i + 1) % 4]]))
            elif item[0] == "qu":
                q = item[1]
                pts = [transform(p) for p in [q.ul, q.ur, q.lr, q.ll]]
                for i in range(4):
                    color_lines[color].append(LineString([pts[i], pts[(i + 1) % 4]]))
    t1 = time.perf_counter()
    timings["extract"] = t1 - t0

    # ── Tandai arsiran → merah (opsional) ──────────────────────────────
    hatch_stats = None
    if remove_hatch:
        t_h0 = time.perf_counter()
        color_lines, hatch_stats = mark_parallel_hatch(
            color_lines, min_parallel=min_parallel, curve_idx=curve_idx
        )
        timings["hatch"] = time.perf_counter() - t_h0
        stats["hatch_removed"] = hatch_stats["marked"]
    else:
        stats["hatch_removed"] = 0

    # ── Setup SVG ─────────────────────────────────────────────────────
    dwg = svgwrite.Drawing(
        svg_path,
        size=(f"{H_pt * PT_TO_MM * scale:.2f}mm", f"{W_pt * PT_TO_MM * scale:.2f}mm"),
        viewBox=f"0 0 {H_pt * PT_TO_MM * scale:.2f} {W_pt * PT_TO_MM * scale:.2f}",
    )

    tolerance_scaled = tolerance_mm * scale

    # ── Optimasi per warna ────────────────────────────────────────────
    t_merge_total = 0.0
    t_svg_total = 0.0

    for color in list(color_lines.keys()):
        lines = color_lines[color]
        if not lines:
            continue

        color_hex = "{:02x}{:02x}{:02x}".format(*color)
        group_id = f"color_{color_hex}"
        g = dwg.g(id=group_id, stroke=f"#{color_hex}", fill="none", stroke_width=0.5)

        stats["initial_lines"] += len(lines)
        stats["initial_vertices"] += sum(len(l.coords) for l in lines)

        # Step 1: Dedup
        lines = remove_duplicate_lines(lines)
        stats["after_dedup"] += len(lines)

        # Step 2: Merge (pairwise midpoint snap + linemerge)
        if merge:
            t_m0 = time.perf_counter()
            lines = merge_lines_with_tolerance(lines, tolerance_scaled)
            t_m1 = time.perf_counter()
            t_merge_total += t_m1 - t_m0
            stats["after_merge"] += len(lines)
        else:
            stats["after_merge"] = len(lines)
            print(f"   ⏭️  Merge dilewati (--no-merge)")

        # Step 3: Simplify & tulis path SVG
        t_s0 = time.perf_counter()
        for geom in lines:
            if simplify and tolerance_scaled > 0:
                geom = geom.simplify(
                    tolerance_scaled * 0.5, preserve_topology=True
                )
            coords = list(geom.coords)
            if len(coords) < 2:
                continue

            stats["final_lines"] += 1
            stats["final_vertices"] += len(coords)

            path_d = "M " + " L ".join(f"{p[0]:.3f},{p[1]:.3f}" for p in coords)
            g.add(dwg.path(d=path_d))
        t_s1 = time.perf_counter()
        t_svg_total += t_s1 - t_s0

        dwg.add(g)

    timings["merge"] = t_merge_total
    timings["svg_write"] = t_svg_total

    # ── Teks ──────────────────────────────────────────────────────────
    t2 = time.perf_counter()
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") == 0:
            for line in block.get("lines"):
                angle = math.degrees(math.atan2(line["dir"][1], line["dir"][0])) - 90
                for span in line["spans"]:
                    t = transform(fitz.Point(*span["origin"]))
                    text_args = {
                        "insert": t,
                        "fill": "#{:02x}{:02x}{:02x}".format(
                            *get_nearest_color(fitz.sRGB_to_pdf(span["color"]))
                        ),
                        "font_size": span["size"] * PT_TO_MM * scale,
                    }
                    if abs(angle % 360) > 0.1:
                        text_args["transform"] = f"rotate({angle}, {t[0]}, {t[1]})"
                    dwg.add(dwg.text(span["text"], **text_args))
                    stats["texts"] += 1
    t3 = time.perf_counter()
    timings["text"] = t3 - t2

    dwg.save()
    t4 = time.perf_counter()
    timings["save"] = t4 - t3
    timings["total"] = t4 - t_total_start

    return stats, timings


# ---------------------------------------------------------------------------
#  Parser argumen halaman
# ---------------------------------------------------------------------------
def parse_pages_arg(spec, n_pages):
    """
    Parse string halaman, contoh:
      "0"        → [0]
      "0,2,4"    → [0, 2, 4]
      "1-3"      → [1, 2, 3]
      "0,2-4,7"  → [0, 2, 3, 4, 7]
    Halaman 0-indexed (input user 0 = halaman 1).
    Validasi: tolak nomor ≥ n_pages.
    """
    result = []
    seen = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            a, b = int(a), int(b)
            if a > b:
                a, b = b, a
            for p in range(a, b + 1):
                if p not in seen:
                    seen.add(p)
                    result.append(p)
        else:
            p = int(part)
            if p not in seen:
                seen.add(p)
                result.append(p)

    invalid = [p for p in result if p < 0 or p >= n_pages]
    if invalid:
        raise ValueError(
            f"Halaman {invalid} di luar range (PDF punya {n_pages} halaman, "
            f"index 0..{n_pages - 1})"
        )
    return result


# ---------------------------------------------------------------------------
#  Proses PDF (satu atau banyak halaman)
# ---------------------------------------------------------------------------
def process_pdf_to_svg(pdf_path, svg_path, scale, tolerance_mm,
                       merge=True, simplify=True, pages=None, flatness_mm=0.05,
                       remove_hatch=False, min_parallel=10):
    """
    pages:
      - None  : proses semua halaman
      - int   : satu halaman (0-indexed)
      - list  : daftar halaman 0-indexed, mis. [0, 2, 4]
    """
    doc = fitz.open(pdf_path)
    n_pages = len(doc)
    base, ext = os.path.splitext(svg_path)

    print(f"\n📄 PDF: {pdf_path}  ({n_pages} halaman)")

    # Normalisasi & validasi halaman
    if pages is None:
        page_indices = list(range(n_pages))
    elif isinstance(pages, int):
        page_indices = [pages]
    else:
        page_indices = list(pages)

    invalid = [p for p in page_indices if p < 0 or p >= n_pages]
    if invalid:
        doc.close()
        print(f"❌ Halaman {invalid} di luar range 0..{n_pages - 1}")
        print(f"   PDF hanya punya {n_pages} halaman, tidak ada yang diproses.")
        return
    if not page_indices:
        doc.close()
        print(f"❌ Tidak ada halaman untuk diproses.")
        return

    agg_stats = {
        "initial_lines": 0,
        "after_dedup": 0,
        "after_merge": 0,
        "final_lines": 0,
        "initial_vertices": 0,
        "final_vertices": 0,
        "curves": 0,
        "texts": 0,
    }
    agg_timings = {}

    for page_num in page_indices:
        if page_num < 0 or page_num >= n_pages:
            print(f"⚠️  Halaman {page_num} dilewati (di luar range 0..{n_pages - 1})")
            continue

        # Output: namafile.svg → namafile_1.svg, namafile_2.svg, dst.
        if len(page_indices) == 1 and pages is None:
            out_path = svg_path
        else:
            out_path = f"{base}_{page_num + 1}{ext}"

        print(f"\n{'─' * 55}")
        print(f" 📑 Halaman {page_num + 1}/{n_pages}")
        print(f"{'─' * 55}")

        stats, timings = process_page(
            doc[page_num], out_path, scale, tolerance_mm, merge, simplify,
            flatness_mm, remove_hatch=remove_hatch,
            min_parallel=min_parallel,
        )

        for k in agg_stats:
            agg_stats[k] += stats[k]
        for k, v in timings.items():
            agg_timings[k] = agg_timings.get(k, 0.0) + v

        print(f"   Segmen: {stats['initial_lines']} → {stats['final_lines']}")
        print(f"   Vertex: {stats['initial_vertices']} → {stats['final_vertices']}")
        print(f"   ⏱  {timings['total']:.3f}s  ✅ {out_path}")

    doc.close()

    # ── Laporan agregat ───────────────────────────────────────────────
    print(f"\n{'=' * 55}")
    print(f" 📊 LAPORAN TOTAL ({len(page_indices)} halaman diproses)")
    print(f"{'=' * 55}")
    print(f"Segmen awal       : {agg_stats['initial_lines']}")
    print(f"Setelah dedup     : {agg_stats['after_dedup']}")
    print(f"Setelah merge     : {agg_stats['after_merge']}")
    print(f"Segmen final      : {agg_stats['final_lines']}")
    print(
        f"Vertex: {agg_stats['initial_vertices']} → {agg_stats['final_vertices']} "
        f"(Reduksi: {agg_stats['initial_vertices'] - agg_stats['final_vertices']})"
    )
    print(f"Kurva  : {agg_stats['curves']}  |  Teks: {agg_stats['texts']}")
    total_time = agg_timings.get("total", 0.0)
    if total_time > 0:
        print(f"\n⏱️  Waktu proses:")
        for name, t in agg_timings.items():
            pct = t / total_time * 100
            bar = "█" * int(pct / 3)
            print(f"   {name:12s}: {t:6.3f}s  ({pct:5.1f}%) {bar}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input_file")
    parser.add_argument("-s", "--scale", type=float, default=1.0)
    parser.add_argument("-t", "--tolerance", type=float, default=0.15)
    parser.add_argument(
        "-p", "--pages", type=str, default="0",
        help="Halaman yang diproses. Contoh: '0' (halaman 1), '0,2,4', "
             "'1-3' (rentang 1..3), atau 'all' (semua)."
    )
    parser.add_argument("--no-merge", dest="merge", action="store_false",
                        help="Disable line merging (snap + linemerge)")
    parser.add_argument("--remove-hatch", action="store_true",
                        help="Tandai garis arsiran (keluarga garis paralel "
                             ">10 anggota dengan sudut sama) menjadi MERAH. "
                             "Tidak menghapus apa pun — seleksi by color di "
                             "Inkscape lalu hapus manual.")
    parser.add_argument("--min-parallel", type=int, default=10,
                        help="Ambang jumlah garis paralel (sudut sama, "
                             "dibulatkan 1°) agar dianggap arsiran dan "
                             "ditandai merah. Default: 10")
    parser.add_argument("--no-simplify", dest="simplify", action="store_false",
                        help="Disable geometry simplification")
    parser.add_argument(
        "-f", "--flatness", type=float, default=0.05,
        help="Toleransi linearisasi kurva (mm). "
             "Lebih kecil = lebih halus tapi lebih banyak vertex. "
             "Default: 0.05"
    )
    args = parser.parse_args()

    # Hitung jumlah halaman dulu untuk validasi
    try:
        _doc = fitz.open(args.input_file)
        n_pages = len(_doc)
        _doc.close()
    except Exception as e:
        print(f"❌ Gagal membuka PDF: {e}")
        sys.exit(1)

    print(f"📄 {args.input_file} → {n_pages} halaman terdeteksi")

    pages = None
    if args.pages and args.pages.lower() != "all":
        try:
            pages = parse_pages_arg(args.pages, n_pages)
        except ValueError as e:
            print(f"❌ {e}")
            sys.exit(1)

    process_pdf_to_svg(
        args.input_file,
        f"{os.path.splitext(args.input_file)[0]}.svg",
        args.scale,
        args.tolerance,
        merge=args.merge,
        simplify=args.simplify,
        pages=pages,
        flatness_mm=args.flatness,
        remove_hatch=args.remove_hatch,
        min_parallel=args.min_parallel,
    )