"""
dxf2svg.py
Konversi file DXF → SVG teroptimasi, fitur setara pdf2svg.py:
  - Page/entity filter via -p
  - Scale (-s) dalam unit DXF (umumnya 1 unit = 1 mm)
  - Tolerance merge/simplify (-t, default 0.15)
  - Pairwise midpoint snap + linemerge (--no-merge untuk disable)
  - Geometry simplification (--no-simplify untuk disable)
  - Statistik & timing per proses
  - Pemetaan warna ACI DXF → palette 3 warna (hitam/merah/biru)

Default: -p 0 -t 0.15 -s 1  (entitas pertama, toleransi 0.15, skala 1x)
"""

import argparse
import math
import os
import sys
import time
from collections import defaultdict

import ezdxf
import svgwrite
from shapely.geometry import LineString, Point
from shapely.ops import linemerge

# ---------------------------------------------------------------------------
#  Konstanta
# ---------------------------------------------------------------------------
# Palette 3 warna (hitam / merah / biru) — sama dengan pdf2svg.py
PALETTE = [(0, 0, 0), (255, 0, 0), (0, 0, 255)]

# Pemetaan ACI (AutoCAD Color Index) → palette terdekat
# 7  = white/black, 1 = red, 5 = blue
ACI_TO_RGB = {
    1: (255, 0, 0),
    2: (255, 255, 0),
    3: (0, 255, 0),
    4: (0, 255, 255),
    5: (0, 0, 255),
    6: (255, 0, 255),
    7: (0, 0, 0),       # default
    8: (128, 128, 128),
    9: (192, 192, 192),
}


def get_nearest_color(rgb_tuple):
    """Pilih warna palette terdekat (default hitam jika None)."""
    if not rgb_tuple:
        return (0, 0, 0)
    r, g, b = rgb_tuple
    return min(
        PALETTE, key=lambda c: (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2
    )


def entity_color_rgb(entity):
    """Ambil warna entity DXF, return RGB tuple atau None."""
    try:
        c = entity.dxf.color
    except AttributeError:
        return None
    if c is None or c == 256:   # ByLayer
        # Coba ambil warna layer
        try:
            layer = entity.dxf.layer
            if layer is not None:
                layer_obj = entity.doc.layers.get(layer)
                if layer_obj is not None:
                    c = layer_obj.dxf.color
        except Exception:
            pass
    if c is None or c == 256 or c == 0:
        return None
    if c in ACI_TO_RGB:
        return ACI_TO_RGB[c]
    # ACI di luar tabel → gunakan konversi langsung sebagai fallback
    return (min(c, 255), min(c, 255), min(c, 255))


# ---------------------------------------------------------------------------
#  Linearisasi cubic Bezier → LineString (de Casteljau subdivision)
#  (Sama persis dengan pdf2svg.py — dibutuhkan untuk polyline bezier/circle)
# ---------------------------------------------------------------------------
def cubic_to_lines(p0, p1, p2, p3, flatness):
    def _is_flat(p0, p1, p2, p3, tol_sq):
        ux, uy = p3[0] - p0[0], p3[1] - p0[1]
        vx1, vy1 = p1[0] - p0[0], p1[1] - p0[1]
        vx2, vy2 = p2[0] - p0[0], p2[1] - p0[1]
        len_sq = ux * ux + uy * uy
        if len_sq == 0:
            return True
        d1 = abs(ux * vy1 - uy * vx1) / math.sqrt(len_sq)
        d2 = abs(ux * vy2 - uy * vx2) / math.sqrt(len_sq)
        return max(d1, d2) ** 2 <= tol_sq

    def _subdivide(p0, p1, p2, p3, tol_sq, out):
        if _is_flat(p0, p1, p2, p3, tol_sq):
            out.append(p3)
            return
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
        for i in range(1, 17):
            t = i / 16
            u = 1 - t
            x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t * p2[0] + t**3 * p3[0]
            y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t * p2[1] + t**3 * p3[1]
            points.append((x, y))
    return points


def arc_to_lines(cx, cy, radius, start_deg, end_deg, flatness):
    """
    Linearisasi busur lingkaran → list titik.
    Pecah busur menjadi segmen-segmen cubic Bezier, lalu linearisasi
    dengan flatness yang sama.
    """
    # Normalisasi sudut agar end > start
    if end_deg < start_deg:
        end_deg += 360.0
    sweep = end_deg - start_deg
    if sweep <= 0:
        return []

    # Jumlah segmen cubic Bezier ≈ sweep/90 (cukup akurat)
    n_seg = max(1, int(math.ceil(abs(sweep) / 90.0)))
    seg_sweep = sweep / n_seg

    out = []
    start_rad = math.radians(start_deg)
    # Titik awal di koordinat DXF (Y-axis flip akan diterapkan di pemanggil)
    p0 = (cx + radius * math.cos(start_rad), cy + radius * math.sin(start_rad))
    out.append(p0)

    for i in range(n_seg):
        a0 = math.radians(start_deg + i * seg_sweep)
        a1 = math.radians(start_deg + (i + 1) * seg_sweep)
        mid = (a0 + a1) / 2.0

        p0 = (cx + radius * math.cos(a0), cy + radius * math.sin(a0))
        p3 = (cx + radius * math.cos(a1), cy + radius * math.sin(a1))

        # Control points (formula standar untuk busur lingkaran)
        k = 4.0 / 3.0 * math.tan((a1 - a0) / 4.0)
        p1 = (
            p0[0] - radius * k * math.sin(a0),
            p0[1] + radius * k * math.cos(a0),
        )
        p2 = (
            p3[0] + radius * k * math.sin(a1),
            p3[1] - radius * k * math.cos(a1),
        )

        pts = cubic_to_lines(p0, p1, p2, p3, flatness)
        # pts[0] == p0 (sama dengan ujung sebelumnya), skip
        out.extend(pts[1:])
    return out


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
#  Merge berbasis Pairwise Midpoint Snap (identik dengan pdf2svg.py)
# ---------------------------------------------------------------------------
def merge_lines_with_tolerance(lines, tolerance):
    if not lines or tolerance <= 0:
        return list(lines)

    endpoints = []
    endpoint_info = []

    for i, line in enumerate(lines):
        coords = list(line.coords)
        if len(coords) < 2:
            continue
        endpoints.append(coords[0])
        endpoint_info.append((i, True))
        endpoints.append(coords[-1])
        endpoint_info.append((i, False))

    n_ep = len(endpoints)
    if n_ep == 0:
        return []

    cell_size = tolerance
    grid = defaultdict(list)
    for idx in range(n_ep):
        x, y = endpoints[idx]
        cx = int(math.floor(x / cell_size))
        cy = int(math.floor(y / cell_size))
        grid[(cx, cy)].append(idx)

    tol_sq = tolerance * tolerance
    pairs = []
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
                        seg_a = endpoint_info[idx][0]
                        seg_b = endpoint_info[jdx][0]
                        if seg_a == seg_b:
                            continue
                        mid = (
                            round((x + x2) / 2, 6),
                            round((y + y2) / 2, 6),
                        )
                        pairs.append((dist_sq, idx, jdx, mid))

    pairs.sort(key=lambda p: p[0])
    snap_target = {}
    used_endpoints = set()
    for _, idx_a, idx_b, mid in pairs:
        if idx_a in used_endpoints or idx_b in used_endpoints:
            continue
        snap_target[idx_a] = mid
        snap_target[idx_b] = mid
        used_endpoints.add(idx_a)
        used_endpoints.add(idx_b)

    start_ep = {}
    end_ep = {}
    for ep_idx, (seg_idx, is_start) in enumerate(endpoint_info):
        if is_start:
            start_ep[seg_idx] = ep_idx
        else:
            end_ep[seg_idx] = ep_idx

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
        deduped = [new_coords[0]]
        for c in new_coords[1:]:
            if c != deduped[-1]:
                deduped.append(c)
        if len(deduped) >= 2:
            snapped.append(LineString(deduped))

    if not snapped:
        return []

    snapped = remove_duplicate_lines(snapped)
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
#  Ekstrak entity DXF → list of (color, LineString)
# ---------------------------------------------------------------------------
def entity_to_linestrings(entity, flatness_scaled):
    """
    Konversi entity DXF ke list of LineString dengan transformasi koordinat.
    DXF menggunakan koordinat world (Y ke atas). Untuk konsistensi dengan
    output svgwrite (Y ke bawah), kita flip Y axis di sini menggunakan
    bounding box Y sebagai referensi sederhana (akan dineutralkan di
    process_dxf_to_svg dengan translasi).
    """
    t = entity.dxftype() if hasattr(entity, "dxftype") else entity.dxf.type
    color = get_nearest_color(entity_color_rgb(entity))
    out = []

    def pt(x, y):
        return (round(x, 6), round(y, 6))

    if t == "LINE":
        try:
            s = entity.dxf.start
            e = entity.dxf.end
            out.append(LineString([pt(s.x, s.y), pt(e.x, e.y)]))
        except AttributeError:
            pass

    elif t == "LWPOLYLINE":
        try:
            pts = list(entity.get_points(format="xyseb"))  # x, y, start_width, end_width, bulge
        except Exception:
            pts = []
        # Fallback jika get_points gagal
        if not pts and hasattr(entity, "vertices"):
            try:
                vlist = []
                for v in entity.vertices:
                    loc = v.dxf.location
                    bulge = getattr(v.dxf, "bulge", 0) if hasattr(v.dxf, "bulge") else 0
                    vlist.append((loc.x, loc.y, 0, 0, bulge))
                pts = vlist
            except Exception:
                pts = []

        if not pts:
            return out

        coords = [(p[0], p[1]) for p in pts]
        bulges = [p[4] if len(p) > 4 else 0 for p in pts]
        is_closed = bool(getattr(entity, "closed", False))

        # Bangun list segmen: tiap pasang titik (i, i+1) bisa berupa
        # garis lurus (bulge=0) atau busur (bulge!=0)
        n = len(coords)
        indices = list(range(n)) + ([0] if is_closed else [])

        for k in range(len(indices) - 1):
            i0 = indices[k]
            i1 = indices[k + 1]
            p0 = coords[i0]
            p1 = coords[i1]
            bulge = bulges[i0]
            if abs(bulge) < 1e-9:
                out.append(LineString([pt(*p0), pt(*p1)]))
            else:
                # Busur dari p0 ke p1 dengan bulge
                # chord = jarak, radius, theta
                dx, dy = p1[0] - p0[0], p1[1] - p0[1]
                chord = math.hypot(dx, dy)
                if chord < 1e-12:
                    continue
                # theta = 4 * atan(|bulge|)
                theta = 4.0 * math.atan(abs(bulge))
                if abs(theta) < 1e-9:
                    out.append(LineString([pt(*p0), pt(*p1)]))
                    continue
                radius = chord / (2.0 * math.sin(theta / 2.0))
                # Pusat busur: tegak lurus chord, offset = radius * cos(theta/2)
                mid = ((p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0)
                # Arah unit chord
                ux, uy = dx / chord, dy / chord
                # Normal (ke kiri chord)
                nx, ny = -uy, ux
                # Tanda bulge: positif → busur ke kiri (CCW bila Y-up)
                sag = radius * math.cos(theta / 2.0)
                # DXF bulge positif = CCW di sistem Y-up, jadi pusat di sisi -normal
                sign = -1.0 if bulge > 0 else 1.0
                cx_arc = mid[0] + sign * nx * sag
                cy_arc = mid[1] + sign * ny * sag
                # Sudut awal dan akhir (derajat, Y-up world)
                ang0 = math.degrees(math.atan2(p0[1] - cy_arc, p0[0] - cx_arc))
                ang1 = math.degrees(math.atan2(p1[1] - cy_arc, p1[0] - cx_arc))
                sweep_deg = math.degrees(theta)
                if bulge < 0:
                    sweep_deg = -sweep_deg
                    if ang1 > ang0:
                        ang1 -= 360.0
                else:
                    if ang1 < ang0:
                        ang1 += 360.0
                arc_pts = arc_to_lines(cx_arc, cy_arc, radius, ang0, ang1, flatness_scaled)
                if len(arc_pts) >= 2:
                    out.append(LineString(arc_pts))
                else:
                    out.append(LineString([pt(*p0), pt(*p1)]))

    elif t == "POLYLINE":
        try:
            vertices = list(entity.vertices)
        except Exception:
            vertices = []
        is_closed = bool(getattr(entity, "is_closed", False))
        if not vertices:
            return out
        coords = [(v.dxf.location.x, v.dxf.location.y) for v in vertices]
        bulges = [getattr(v.dxf, "bulge", 0) if hasattr(v.dxf, "bulge") else 0
                  for v in vertices]
        n = len(coords)
        indices = list(range(n)) + ([0] if is_closed else [])
        for k in range(len(indices) - 1):
            i0, i1 = indices[k], indices[k + 1]
            p0, p1 = coords[i0], coords[i1]
            bulge = bulges[i0]
            if abs(bulge) < 1e-9:
                out.append(LineString([pt(*p0), pt(*p1)]))
            else:
                dx, dy = p1[0] - p0[0], p1[1] - p0[1]
                chord = math.hypot(dx, dy)
                if chord < 1e-12:
                    continue
                theta = 4.0 * math.atan(abs(bulge))
                if abs(theta) < 1e-9:
                    out.append(LineString([pt(*p0), pt(*p1)]))
                    continue
                radius = chord / (2.0 * math.sin(theta / 2.0))
                mid = ((p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0)
                ux, uy = dx / chord, dy / chord
                nx, ny = -uy, ux
                sag = radius * math.cos(theta / 2.0)
                sign = -1.0 if bulge > 0 else 1.0
                cx_arc = mid[0] + sign * nx * sag
                cy_arc = mid[1] + sign * ny * sag
                ang0 = math.degrees(math.atan2(p0[1] - cy_arc, p0[0] - cx_arc))
                ang1 = math.degrees(math.atan2(p1[1] - cy_arc, p1[0] - cx_arc))
                sweep_deg = math.degrees(theta)
                if bulge < 0:
                    sweep_deg = -sweep_deg
                    if ang1 > ang0:
                        ang1 -= 360.0
                else:
                    if ang1 < ang0:
                        ang1 += 360.0
                arc_pts = arc_to_lines(cx_arc, cy_arc, radius, ang0, ang1, flatness_scaled)
                if len(arc_pts) >= 2:
                    out.append(LineString(arc_pts))
                else:
                    out.append(LineString([pt(*p0), pt(*p1)]))

    elif t == "CIRCLE":
        try:
            c = entity.dxf.center
            r = entity.dxf.radius
            arc_pts = arc_to_lines(c.x, c.y, r, 0.0, 360.0, flatness_scaled)
            if len(arc_pts) >= 2:
                out.append(LineString(arc_pts))
        except AttributeError:
            pass

    elif t == "ARC":
        try:
            c = entity.dxf.center
            r = entity.dxf.radius
            s = entity.dxf.start_angle
            e = entity.dxf.end_angle
            arc_pts = arc_to_lines(c.x, c.y, r,
                                   math.degrees(s), math.degrees(e),
                                   flatness_scaled)
            if len(arc_pts) >= 2:
                out.append(LineString(arc_pts))
        except AttributeError:
            pass

    elif t == "SPLINE":
        # ezdxf bisa flatten spline
        try:
            try:
                pts = list(entity.flattening(distance=flatness_scaled))
            except Exception:
                pts = list(entity.control_points)
            if len(pts) >= 2:
                out.append(LineString([pt(p.x, p.y) for p in pts]))
        except Exception:
            pass

    elif t == "POINT":
        # POINT tidak di-emit sebagai line; diabaikan
        pass

    return [(color, ls) for ls in out if ls is not None]


# ---------------------------------------------------------------------------
#  Parser argumen halaman/entitas (kompatibel dengan pdf2svg.py)
# ---------------------------------------------------------------------------
def parse_index_arg(spec, n_items, kind="entitas"):
    """
    spec:
      "0"        → [0]
      "0,2,4"    → [0, 2, 4]
      "1-3"      → [1, 2, 3]
    Index 0-based. Validasi: tolak index >= n_items.
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

    invalid = [p for p in result if p < 0 or p >= n_items]
    if invalid:
        raise ValueError(
            f"{kind} index {invalid} di luar range 0..{n_items - 1}"
        )
    return result


# ---------------------------------------------------------------------------
#  Proses DXF → SVG
# ---------------------------------------------------------------------------
def process_dxf_to_svg(dxf_path, svg_path, scale, tolerance_mm,
                       merge=True, simplify=True, indices=None,
                       flatness_mm=0.05):
    """
    indices:
      - None  : proses semua entity
      - list  : daftar index entity 0-based
    DXF tidak memiliki "page" (semua entity dalam 1 ruang world).
    Untuk menyerupai -p di pdf2svg.py, -p menunjuk ke index entity.
    """
    doc = ezdxf.readfile(dxf_path)
    modelspace = doc.modelspace()

    # Kumpulkan semua entity yang relevan (skip non-graphical)
    all_entities = list(modelspace)
    n_entities = len(all_entities)

    print(f"\n📐 DXF: {dxf_path}  ({n_entities} entitas)")

    if indices is None:
        sel = list(range(n_entities))
    else:
        sel = list(indices)

    invalid = [p for p in sel if p < 0 or p >= n_entities]
    if invalid:
        print(f"❌ Entitas {invalid} di luar range 0..{n_entities - 1}")
        return
    if not sel:
        print(f"❌ Tidak ada entitas untuk diproses.")
        return

    flatness_scaled = flatness_mm * scale

    # ── Ekstraksi ─────────────────────────────────────────────────────
    color_lines = defaultdict(list)
    stats = {
        "initial_lines": 0,
        "after_dedup": 0,
        "after_merge": 0,
        "final_lines": 0,
        "initial_vertices": 0,
        "final_vertices": 0,
        "curves": 0,
    }
    timings = {}
    t_total_start = time.perf_counter()

    t0 = time.perf_counter()
    for idx in sel:
        entity = all_entities[idx]
        try:
            lss = entity_to_linestrings(entity, flatness_scaled)
        except Exception as e:
            print(f"   ⚠️  Entitas #{idx} ({entity.dxftype()}) dilewati: {e}")
            continue
        for color, ls in lss:
            color_lines[color].append(ls)
        if lss and entity.dxftype() in ("ARC", "CIRCLE", "SPLINE"):
            stats["curves"] += len([1 for _ in lss])
    t1 = time.perf_counter()
    timings["extract"] = t1 - t0

    # ── Hitung bounding box untuk viewBox & flip Y ────────────────────
    all_pts = []
    for lines in color_lines.values():
        for ls in lines:
            all_pts.extend(list(ls.coords))
    if not all_pts:
        print(f"❌ Tidak ada geometri yang bisa dikonversi.")
        return
    min_x = min(p[0] for p in all_pts)
    max_x = max(p[0] for p in all_pts)
    min_y = min(p[1] for p in all_pts)
    max_y = max(p[1] for p in all_pts)

    # Transformasi: scale + flip Y (DXF Y-up → SVG Y-down)
    # Simpan offset Y agar semua koordinat positif
    width_mm = (max_x - min_x) * scale
    height_mm = (max_y - min_y) * scale

    def transform(pt):
        x = (pt[0] - min_x) * scale
        # Flip Y: y = (max_y - pt[1]) * scale  →  Y turun, sesuai SVG
        y = (max_y - pt[1]) * scale
        return (round(x, 3), round(y, 3))

    # Terapkan transformasi ke semua LineString
    transformed = defaultdict(list)
    for color, lines in color_lines.items():
        for ls in lines:
            new_coords = [transform(c) for c in ls.coords]
            if len(new_coords) >= 2:
                transformed[color].append(LineString(new_coords))

    # ── Setup SVG ─────────────────────────────────────────────────────
    dwg = svgwrite.Drawing(
        svg_path,
        size=(f"{width_mm:.2f}mm", f"{height_mm:.2f}mm"),
        viewBox=f"0 0 {width_mm:.2f} {height_mm:.2f}",
    )
    tolerance_scaled = tolerance_mm * scale

    # ── Optimasi per warna ────────────────────────────────────────────
    t_merge_total = 0.0
    t_svg_total = 0.0

    for color in PALETTE:
        lines = transformed[color]
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

        # Step 2: Merge
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

    dwg.save()
    t_end = time.perf_counter()
    timings["save"] = t_end - t_merge_total - t_svg_total - t1
    timings["total"] = t_end - t_total_start

    # ── Laporan ───────────────────────────────────────────────────────
    print(f"\n{'─' * 55}")
    print(f" 📑 Entitas diproses: {len(sel)}/{n_entities}")
    print(f"{'─' * 55}")
    print(f"   Segmen: {stats['initial_lines']} → {stats['final_lines']}")
    print(f"   Vertex: {stats['initial_vertices']} → {stats['final_vertices']}")
    print(f"   ⏱  {timings['total']:.3f}s  ✅ {svg_path}")

    print(f"\n{'=' * 55}")
    print(f" 📊 LAPORAN TOTAL")
    print(f"{'=' * 55}")
    print(f"Segmen awal       : {stats['initial_lines']}")
    print(f"Setelah dedup     : {stats['after_dedup']}")
    print(f"Setelah merge     : {stats['after_merge']}")
    print(f"Segmen final      : {stats['final_lines']}")
    print(
        f"Vertex: {stats['initial_vertices']} → {stats['final_vertices']} "
        f"(Reduksi: {stats['initial_vertices'] - stats['final_vertices']})"
    )
    print(f"Kurva  : {stats['curves']}")
    total_time = timings.get("total", 0.0)
    if total_time > 0:
        print(f"\n⏱️  Waktu proses:")
        for name, t in timings.items():
            pct = t / total_time * 100
            bar = "█" * int(pct / 3)
            print(f"   {name:12s}: {t:6.3f}s  ({pct:5.1f}%) {bar}")


# ---------------------------------------------------------------------------
#  CLI entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Konversi DXF → SVG teroptimasi (pairwise merge + simplify)"
    )
    parser.add_argument("input_file", help="File DXF input")
    parser.add_argument("-o", "--output", help="Path SVG output (default: <input>.svg)")
    parser.add_argument("-s", "--scale", type=float, default=1.0,
                        help="Skala koordinat (default: 1)")
    parser.add_argument("-t", "--tolerance", type=float, default=0.15,
                        help="Toleransi merge/simplify dalam unit DXF (default: 0.15)")
    parser.add_argument(
        "-p", "--entities", type=str, default="0",
        help="Index entitas yang diproses (0-based). "
             "Contoh: '0' (entitas pertama), '0,2,4', '1-3', atau 'all'."
    )
    parser.add_argument("--no-merge", dest="merge", action="store_false",
                        help="Disable line merging (snap + linemerge)")
    parser.add_argument("--no-simplify", dest="simplify", action="store_false",
                        help="Disable geometry simplification")
    parser.add_argument(
        "-f", "--flatness", type=float, default=0.05,
        help="Toleransi linearisasi kurva (unit DXF). Default: 0.05"
    )
    args = parser.parse_args()

    if not os.path.isfile(args.input_file):
        print(f"❌ File tidak ditemukan: {args.input_file}")
        sys.exit(1)

    out_path = args.output or f"{os.path.splitext(args.input_file)[0]}.svg"

    # Hitung jumlah entitas dulu
    try:
        _doc = ezdxf.readfile(args.input_file)
        n_entities = len(list(_doc.modelspace()))
        del _doc
    except Exception as e:
        print(f"❌ Gagal membuka DXF: {e}")
        sys.exit(1)

    print(f"📐 {args.input_file} → {n_entities} entitas terdeteksi")

    indices = None
    if args.entities and args.entities.lower() != "all":
        try:
            indices = parse_index_arg(args.entities, n_entities, kind="entitas")
        except ValueError as e:
            print(f"❌ {e}")
            sys.exit(1)

    process_dxf_to_svg(
        args.input_file,
        out_path,
        args.scale,
        args.tolerance,
        merge=args.merge,
        simplify=args.simplify,
        indices=indices,
        flatness_mm=args.flatness,
    )
