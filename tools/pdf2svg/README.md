# pdf2svg — KaryaCNC PDF optimiser

Converts a vector PDF (typically exported from AutoCAD / Sketchup) into a
clean SVG that opens fast in Inkscape and is ready for the KaryaCNC Inkscape
extension.

## What it does

1. **Parses the raw PDF content stream** (not `page.get_drawings()`, which
   silently drops ~20 % of line segments). Every `m`/`l`/`h`/`re`/`c` operator
   is captured, with full graphics-state tracking (`q`/`Q`/`cm` transforms,
   `RG`/`rg`/`G`/`g`/`K`/`k` colours).
2. **Merges collinear overlapping segments into UNION segments** — handles
   CAD 3D-export doubled edges without losing geometry. Segments of different
   colours are never merged together.
3. **Chains connected segments into polylines** via a spatial-hash endpoint
   match. Chaining is scoped per exact colour so a red hatch never welds to
   a dark-red fill border.
4. **Simplifies** each polyline (collinear-point removal + Douglas-Peucker).
5. **Snaps colours** to the three KaryaCNC operational categories at output
   time only:
   - `#000000` — Cutting
   - `#ff0000` — Marking
   - `#0000ff` — Laser Engrave Fill
6. **Writes SVG** grouped into at most three Inkscape layers, every path with
   `fill="none"` and Inkscape hairline stroke
   (`vector-effect:non-scaling-stroke;-inkscape-stroke:hairline`).

## Install

### Windows
Double-click **`install_windows.bat`** (or run
`powershell -ExecutionPolicy Bypass -File install_windows.ps1`).

Installs Python + PyMuPDF if missing, then registers:
- Right-click on any PDF → **Optimize to SVG (KaryaCNC)**
- *Open with* → **Optimize to SVG (KaryaCNC)**

### Linux (Ubuntu / Debian)
```bash
bash install_linux.sh
```

Installs `python3` + `pip` + PyMuPDF, then registers a `.desktop` entry:
- Files manager: right-click PDF → *Open With* → **Optimize to SVG (KaryaCNC)**

## Manual usage

```bash
python pdf2svg.py input.pdf                      # -> input_optimized.svg
python pdf2svg.py input.pdf -o out.svg --stats
python pdf2svg.py input.pdf --min-length 2 --merge-tolerance 0.5
```

| Option | Default | Meaning |
|---|---|---|
| `--min-length` | `0.3` pt (≈0.1 mm) | Segments shorter than this are dropped (filters sub-pixel noise / grass texture). Increase to e.g. `2` for aggressive cleanup. |
| `--merge-tolerance` | `0.2` pt (≈0.07 mm) | Tolerance for merging collinear overlapping/duplicate CAD edges into one UNION segment. `0` disables. |
| `--tolerance` | `0.5` pt | Endpoint matching tolerance for chaining segments into polylines. |
| `--simplify` | `0.1` mm | Douglas-Peucker tolerance. `0` disables. |
| `--skip-filled` | off | Skip filled shapes (hatch fills, solid regions). |
| `--page` | `0` | PDF page index to process. |

All length tolerances are in **points** (1 pt = 0.353 mm) except `--simplify`
which is in millimetres.

## Workflow (end-to-end)

```
DXF/PDF from AutoCAD/Sketchup
        |
        v
   pdf2svg.py  ──►  drawing_optimized.svg  (3 colour-coded layers)
        |
        v
   open in Inkscape  ──►  KaryaCNC extension  ──►  CNC machine
```

The converter is a **pure pre-processing step** — no changes to the existing
KaryaCNC extension, Go backend, or frontend JavaScript are required.

## Dependencies

- Python 3.8+
- PyMuPDF (`pip install pymupdf`)
