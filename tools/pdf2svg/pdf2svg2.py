import argparse
import math
import os
import time
from collections import defaultdict

import fitz  # PyMuPDF
import svgwrite
from shapely.geometry import LineString
from shapely.ops import linemerge

PT_TO_MM = 25.4 / 72.0


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
#  Union-Find (Disjoint Set Union) — O(α(n)) ≈ O(1) per operasi
# ---------------------------------------------------------------------------
class UnionFind:
    __slots__ = ("parent", "rank")

    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]  # path compression
            x = self.parent[x]
        return x

    def union(self, x, y):
        px, py = self.find(x), self.find(y)
        if px == py:
            return
        if self.rank[px] < self.rank[py]:
            px, py = py, px
        self.parent[py] = px
        if self.rank[px] == self.rank[py]:
            self.rank[px] += 1


# ---------------------------------------------------------------------------
#  Merge berbasis Spatial Hash + Union-Find + linemerge
# ---------------------------------------------------------------------------
def merge_lines_with_tolerance(lines, tolerance):
    """
    Merge path yang ujungnya bertemu dalam jarak ≤ tolerance.

    Algoritma (3 fase, semuanya cepat):
    ┌─────────────────────────────────────────────────────────────────┐
    │ Fase 1: CLUSTERING ENDPOINT                                    │
    │   - Spatial hash grid (cell_size = tolerance)                   │
    │   - Cek 3×3 neighbourhood → temukan pasangan dekat             │
    │   - Union-Find kluster endpoint yang saling dekat              │
    │   - Hitung centroid per kluster → snap ke titik tengah         │
    │   Kompleksitas: O(n·k)  k = rata² tetangga (biasanya kecil)   │
    ├─────────────────────────────────────────────────────────────────┤
    │ Fase 2: DEDUP                                                  │
    │   - Hapus segmen duplikat setelah snapping                     │
    │   Kompleksitas: O(n)                                           │
    ├─────────────────────────────────────────────────────────────────┤
    │ Fase 3: LINEMERGE (GEOS C-optimized)                           │
    │   - Gabungkan semua segmen berantai dalam 1 pass               │
    │   Kompleksitas: O(n log n)                                     │
    └─────────────────────────────────────────────────────────────────┘

    Total: O(n·k + n log n)  vs  O(n³) algoritma iteratif sebelumnya
    """
    if not lines or tolerance <= 0:
        return list(lines)

    # ── Kumpulkan semua endpoint ──────────────────────────────────────
    endpoints = []  # [(x, y), ...]
    endpoint_info = []  # [(segment_index, is_start), ...]

    for i, line in enumerate(lines):
        coords = list(line.coords)
        if len(coords) < 2:
            continue
        endpoints.append(coords[0])
        endpoint_info.append((i, True))  # start
        endpoints.append(coords[-1])
        endpoint_info.append((i, False))  # end

    n_ep = len(endpoints)
    if n_ep == 0:
        return []

    # ── Fase 1a: Spatial hash — kelompokkan endpoint ke grid cell ─────
    cell_size = tolerance
    grid = defaultdict(list)

    for idx in range(n_ep):
        x, y = endpoints[idx]
        cx = int(math.floor(x / cell_size))
        cy = int(math.floor(y / cell_size))
        grid[(cx, cy)].append(idx)

    # ── Fase 1b: Cari pasangan dekat, union kluster ──────────────────
    uf = UnionFind(n_ep)
    tol_sq = tolerance * tolerance

    for idx in range(n_ep):
        x, y = endpoints[idx]
        cx = int(math.floor(x / cell_size))
        cy = int(math.floor(y / cell_size))

        # Cek 3×3 neighbourhood (termasuk cell sendiri)
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
                        uf.union(idx, jdx)

    # ── Fase 1c: Hitung centroid per kluster ─────────────────────────
    clusters = defaultdict(list)
    for i in range(n_ep):
        clusters[uf.find(i)].append(i)

    # centroid per kluster (rata-rata posisi semua anggota)
    cluster_centroid = {}  # endpoint_index → (cx, cy)
    for members in clusters.values():
        cx = sum(endpoints[m][0] for m in members) / len(members)
        cy = sum(endpoints[m][1] for m in members) / len(members)
        centroid = (round(cx, 6), round(cy, 6))
        for m in members:
            cluster_centroid[m] = centroid

    # ── Bangun mapping: segment_index → endpoint indices ─────────────
    start_ep = {}  # segment_index → endpoint index (start)
    end_ep = {}  # segment_index → endpoint index (end)
    for ep_idx, (seg_idx, is_start) in enumerate(endpoint_info):
        if is_start:
            start_ep[seg_idx] = ep_idx
        else:
            end_ep[seg_idx] = ep_idx

    # ── Terapkan centroid ke setiap segmen ───────────────────────────
    snapped = []
    for i, line in enumerate(lines):
        coords = list(line.coords)
        if len(coords) < 2:
            continue

        new_coords = list(coords)
        if i in start_ep:
            new_coords[0] = cluster_centroid.get(start_ep[i], coords[0])
        if i in end_ep:
            new_coords[-1] = cluster_centroid.get(end_ep[i], coords[-1])

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
#  Proses utama
# ---------------------------------------------------------------------------
def process_pdf_to_svg(pdf_path, svg_path, scale, tolerance_mm):
    doc = fitz.open(pdf_path)
    page = doc[0]
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
    color_curves = defaultdict(list)

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
                p1, p2, p3, p4 = (
                    transform(item[1]),
                    transform(item[2]),
                    transform(item[3]),
                    transform(item[4]),
                )
                color_curves[color].append(
                    f"M {p1[0]},{p1[1]} C {p2[0]},{p2[1]} {p3[0]},{p3[1]} {p4[0]},{p4[1]}"
                )
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

    for color in [(0, 0, 0), (255, 0, 0), (0, 0, 255)]:
        lines = color_lines[color]
        if not lines and not color_curves[color]:
            continue

        color_hex = "{:02x}{:02x}{:02x}".format(*color)
        group_id = f"color_{color_hex}"
        g = dwg.g(id=group_id, stroke=f"#{color_hex}", fill="none", stroke_width=0.5)

        if lines:
            stats["initial_lines"] += len(lines)
            stats["initial_vertices"] += sum(len(l.coords) for l in lines)

            # Step 1: Dedup
            lines = remove_duplicate_lines(lines)
            stats["after_dedup"] += len(lines)

            # Step 2: Merge (spatial hash + union-find + linemerge)
            t_m0 = time.perf_counter()
            lines = merge_lines_with_tolerance(lines, tolerance_scaled)
            t_m1 = time.perf_counter()
            t_merge_total += t_m1 - t_m0
            stats["after_merge"] += len(lines)

            # Step 3: Simplify & tulis path SVG
            t_s0 = time.perf_counter()
            for geom in lines:
                if tolerance_scaled > 0:
                    geom = geom.simplify(tolerance_scaled * 0.5, preserve_topology=True)
                coords = list(geom.coords)
                if len(coords) < 2:
                    continue

                stats["final_lines"] += 1
                stats["final_vertices"] += len(coords)

                path_d = "M " + " L ".join(f"{p[0]:.3f},{p[1]:.3f}" for p in coords)
                g.add(dwg.path(d=path_d))
            t_s1 = time.perf_counter()
            t_svg_total += t_s1 - t_s0

        for c in color_curves[color]:
            g.add(dwg.path(d=c))

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

    # ── Laporan ───────────────────────────────────────────────────────
    print(f"\n{'=' * 55}")
    print(f" 📊 LAPORAN ANALISA OPTIMASI VEKTOR SVG")
    print(f"{'=' * 55}")
    print(f"Segmen awal       : {stats['initial_lines']}")
    print(f"Setelah dedup     : {stats['after_dedup']}")
    print(f"Setelah merge     : {stats['after_merge']}")
    print(f"Segmen final      : {stats['final_lines']}")
    print(
        f"Vertex: {stats['initial_vertices']} → {stats['final_vertices']} "
        f"(Reduksi: {stats['initial_vertices'] - stats['final_vertices']})"
    )
    print(f"Kurva  : {stats['curves']}  |  Teks: {stats['texts']}")
    print(f"\n⏱️  Waktu proses:")
    for name, t in timings.items():
        pct = t / timings["total"] * 100 if timings["total"] > 0 else 0
        bar = "█" * int(pct / 3)
        print(f"   {name:12s}: {t:6.3f}s  ({pct:5.1f}%) {bar}")
    print(f"\n✅ Tersimpan: {svg_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input_file")
    parser.add_argument("-s", "--scale", type=float, default=10.0)
    parser.add_argument("-t", "--tolerance", type=float, default=0.2)
    args = parser.parse_args()
    process_pdf_to_svg(
        args.input_file,
        f"{os.path.splitext(args.input_file)[0]}.svg",
        args.scale,
        args.tolerance,
    )
