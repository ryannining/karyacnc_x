# KaryaCNC Vector Data Flow Analysis

## Overview
Dokumen ini menganalisis alur transformasi data vector dari Inkscape Extension hingga menjadi G-code yang siap dikirim ke mesin CNC.

---

## 1. INPUT: Inkscape Extension (Python)

### File: `frontend/inkscape_ex/karyacnc1.py`

#### Proses Ekstraksi Data:

```
User Selection (SVG Paths) 
    ↓
effect() - Entry point
    ↓
get_info() → recursive_search()
    ↓
laser() - Convert to points
    ↓
export_path() - Format & Send
```

#### Detail Transformasi:

| Langkah | Fungsi | Input | Output | Library |
|---------|--------|-------|--------|---------|
| 1 | `recursive_search()` | SVG DOM Tree | Selected elements | inkex |
| 2 | `CubicSuperPath(d)` | Path "d" attribute | Cubic bezier curves | inkex.bezier |
| 3 | `apply_transforms()` | CSP + matrix | Transformed CSP | inkex.transforms |
| 4 | `cspsubdiv()` | Curves | Line segments | inkex.bezier |
| 5 | Point extraction | CSP arrays | Array of (x,y) tuples | Native |

#### Format Data yang Dikirim (Custom Protocol):

```
X:{scale}
P:{fill}:{stroke}:{stroke-width}
{x1},{y1}
{x2},{y2}
...

P:{fill}:{stroke}:{stroke-width}
{x1},{y1}
...

I,{x},{y},{width},{height},{type}
{base64_image_data}

>REVECTOR2
```

**Contoh:**
```
X:1.0
P:#ffffff:#000000:0
10.5,20.3
15.2,25.8
20.0,30.1

P:#ff0000:#000000:2
5.0,5.0
10.0,10.0
>REVECTOR2
```

#### Catatan Penting:
- Data dikirim via WebSocket dalam chunk 15KB
- Marker `>REVECTOR2` menandakan akhir data
- Koordinat sudah dinormalisasi (dikurangi xmin, ymin)
- Scale factor disertakan di header

---

## 2. TRANSPORT: WebSocket Communication

### Backend: `app.go`

```go
func (a *App) handleConnection(peer string, conn *websocket.Conn) {
    var buff strings.Builder
    for {
        msgType, message, err := conn.ReadMessage()
        if msgType == websocket.TextMessage {
            text := string(message)
            if text == ">REVECTOR2" {
                // Emit ke frontend
                runtime.EventsEmit(a.ctx, "WS_MESSAGE_RECEIVED", buff.String())
                buff.Reset()
            } else {
                buff.WriteString(text)  // Akumulasi chunk
            }
        }
    }
}
```

### Frontend: `main.js`

```javascript
await window.listen('WS_MESSAGE_RECEIVED', (event) => {
    buff = event.payload;           // String lengkap dari Inkscape
    text1 = pathstoText1(buff);     // Parse ke struktur internal
    savehistory(buff);              // Simpan ke localStorage
    refreshgcode();                 // Trigger regenerasi G-code
});
```

**Transformasi:**
- WebSocket Text Message → String lengkap
- String → Array of path objects (text1)

---

## 3. PARSING: Custom Format → Internal Structure

### File: `costy-x.js` (pathstoText1)

**Struktur Data Internal (text1):**

```javascript
text1 = {
    paths: [
        {
            style: {
                fill: "#ffffff",
                stroke: "#000000", 
                strokeWidth: "0"
            },
            points: [[x1,y1], [x2,y2], ...],
            closed: true/false
        },
        ...
    ],
    images: [
        {
            x, y, width, height, type,
            data: base64_string
        }
    ],
    scale: 1.0
}
```

**Transformasi:**
```
String (X:...\nP:...\n) 
    ↓ Split by "\n"
Array of lines
    ↓ Parse headers
Structured objects (paths, images)
    ↓ Normalize coordinates
Ready for processing
```

---

## 4. PROCESSING: Vector Operations

### 4.1 Style Interpretation

**Color Codes (Semantic Meaning):**

| Warna Stroke | Kode | Operasi | Fungsi |
|-------------|------|---------|--------|
| Black | `#000000` | Cut | Potong penuh (CNC/Laser) |
| Blue | `#0000FF` | Engrave | Ukir raster |
| Aqua/Cyan | `#00FFFF` | V-Carve | Ukir V-bit |
| Purple | `#800080` | Pocket | Saku/Area clearing |
| Red | `#FF0000` | Drilling | Bor titik |
| Green | `#00FF00` | Marking | Tanda saja |

**Parameter tambahan dari style:**
- `stroke-width` → Tool diameter
- Custom attributes dalam stroke (e.g., `S2F1000`) → Speed/Feed

### 4.2 Offset Calculation (Tool Radius Compensation)

**File:** `costy-x.js` - `prepare_line2()`

**Algoritma:**

```javascript
// 1. Convert ke Clipper format (scale 1000x untuk precision)
var paths = [];
for (each point in line) {
    paths.push({
        X: point.x * 1000,
        Y: point.y * 1000
    });
}

// 2. Setup Clipper
var co = new ClipperLib.ClipperOffset();
co.AddPaths(paths, 
    ClipperLib.JoinType.jtRound,      // Join: Round
    ClipperLib.EndType.etClosedPolygon // End: Closed
);
co.MiterLimit = 2;
co.ArcTolerance = 0.02 * scale;

// 3. Calculate offset
var delta = tool_radius * scale;      // Positive = outward
if (!clockwise) delta = -delta;       // Negative = inward

co.Execute(offsetted_paths, delta);

// 4. Simplify & convert back
for (each offset_path) {
    var simplified = ClipperLib.JS.Lighten(offset_path, detail * scale);
    // Convert back to line format
}
```

**Visualisasi Offset:**

```
Original Path (hitam)     Offset Result (merah)
    ┌─────┐                  ╭─────╮
    │     │       →         │     │  (outward)
    └─────┘                  ╰─────╯
    
    ┌─────┐                  ┌───┐
    │     │       →         │   │    (inward - pocket)
    └─────┘                  └───┘
```

### 4.3 Overcut / DogBone (Sharp Corner Compensation)

**File:** `costy-x.js` - `sharp()`

**Tujuan:** Menambah sedikit cut di sudut tajam agar CNC dapat masuk penuh

**Algoritma:**
```javascript
function sharp(lines, closed) {
    for (each corner in path) {
        // Calculate dot product (cosine of angle)
        var dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2);
        
        if (dot < threshold) {  // Sudut tajam
            // Add overcut move
            add_extended_cut(corner, direction, overcut_amount);
        }
    }
}
```

### 4.4 Cutting Tabs ( untuk CNC )

**File:** `costy-x.js` - `getcutpos()`

**Konsep:** Menyisakan material agar workpiece tidak lepas saat cutting

**Implementasi:**
```javascript
// Calculate tab positions along path
var tab_positions = [];
var spacing = path_length / num_tabs;

for (i = 0; i < num_tabs; i++) {
    tab_positions.push(i * spacing + spacing/2);
}

// Saat generate G-code:
for (each point in path) {
    if (near_tab_position(current_distance)) {
        // Lift Z to tab height
        gcode += `G1 Z${tab_z}\n`;
        gcode += `G1 X${x} Y${y}\n`;  // Move at tab height
        gcode += `G1 Z${cut_z}\n`;     // Back down
    } else {
        gcode += `G1 X${x} Y${y} Z${cut_z}\n`;
    }
}
```

### 4.5 Sorting (Travel Optimization)

**Tujuan:** Minimalkan travel distance antar paths

**Algoritma:**
```javascript
// 1. Sort by priority (outside before inside)
paths.sort((a, b) => b.area - a.area);

// 2. Nearest neighbor untuk minimal travel
var current_pos = [0, 0];
var sorted = [];
var remaining = [...paths];

while (remaining.length > 0) {
    var nearest = find_nearest(current_pos, remaining);
    sorted.push(nearest);
    current_pos = nearest.end_point;
    remaining.remove(nearest);
}
```

---

## 5. SPECIAL OPERATIONS

### 5.1 V-Carving (Aqua Stroke)

**File:** `cnc.js` - `vcarve()`

**Konsep:** Mengukir dengan V-bit, kedalaman tergantung lebar area

**Algoritma:**

```javascript
function vcarve(max_radius, v_angle, step_size, path) {
    // Constants
    const ve = 1 / Math.tan(v_angle * PI / 360);
    const max_depth = -max_radius * ve;
    
    // 1. Segmentasi path
    var segments = [];
    segment_path(path, step_size, segments);
    
    // 2. Spatial Grid untuk collision detection
    var grid = {};
    var grid_size = max_radius;
    
    for (each seg in segments) {
        var gx = Math.floor(seg.x / grid_size);
        var gy = Math.floor(seg.y / grid_size);
        var key = `${gx},${gy}`;
        if (!grid[key]) grid[key] = [];
        grid[key].push(seg);
    }
    
    // 3. Hitung radius maksimum untuk setiap segment
    for (each seg1 in segments) {
        var max_r = max_radius;
        
        // Check collision dengan segments lain
        var nearby = get_nearby_segments(seg1, grid, grid_size);
        for (each seg2 in nearby) {
            var dist = distance(seg1, seg2);
            max_r = Math.min(max_r, dist / 2);
        }
        
        // Binary search untuk precision
        var low = 0, high = max_r;
        for (iter = 0; iter < 12; iter++) {
            var mid = (low + high) / 2;
            if (has_collision(seg1, mid, grid)) high = mid;
            else low = mid;
        }
        
        // Convert radius to depth
        seg1.depth = (low >= max_radius) ? max_depth : -low * ve;
    }
    
    // 4. Generate G-code
    return generate_vcarve_gcode(segments);
}
```

**Transformasi:**
```
2D Path → Segments → Radius/Depth per segment → 3D G-code
```

### 5.2 Pocketing (Purple Stroke)

**File:** `cnc.js` - `pocketcarve()`

**Konsep:** Membersihkan area dengan pola spiral inward

**Algoritma:**
```javascript
function pocketcarve(step_over, paths) {
    var all_offsets = [];
    var current_offset = 0;
    var depth = 0;
    
    while (true) {
        current_offset += step_over;
        
        // Offset inward
        var co = new ClipperLib.ClipperOffset();
        co.AddPaths(paths, jtRound, etClosedPolygon);
        
        var offsetted = [];
        co.Execute(offsetted, -current_offset * scale);
        
        if (offsetted.length == 0) break;  // Fully cleared
        
        all_offsets.push({
            depth: depth++,
            paths: offsetted
        });
    }
    
    // Generate G-code: Connect offsets dengan ramp
    return generate_pocket_gcode(all_offsets);
}
```

**Visualisasi:**
```
┌─────────────────────────────┐
│ ╭─────────────────────────╮ │
│ │ ╭─────────────────────╮ │ │
│ │ │ ╭─────────────────╮ │ │ │
│ │ │ │                 │ │ │ │
│ │ │ ╰─────────────────╯ │ │ │
│ │ ╰─────────────────────╯ │ │
│ ╰─────────────────────────╯ │
└─────────────────────────────┘
   ↑ Spiral inward pattern
```

### 5.3 Engraving (Blue Stroke)

**File:** `costy-x.js` - Rasterization

**Konsep:** Raster line dengan dithering untuk grayscale

**Algoritma:**
```javascript
function engrave(image_data, line_spacing, dithering) {
    var raster_lines = [];
    
    // 1. Convert to raster lines
    for (y = 0; y < height; y += line_spacing) {
        var line = [];
        for (x = 0; x < width; x++) {
            var gray = get_gray(image_data, x, y);
            line.push(gray);
        }
        raster_lines.push(line);
    }
    
    // 2. Apply dithering (Floyd-Steinberg)
    if (dithering == 'floyd') {
        floyd_steinberg(raster_lines);
    }
    
    // 3. Generate G-code dengan power modulation
    var gcode = "";
    for (each line in raster_lines) {
        gcode += "G0 X{x} Y{y}\n";  // Move to start
        for (each pixel in line) {
            var power = pixel / 255 * max_power;
            gcode += `G1 X${x} S${power}\n`;
        }
    }
    
    return gcode;
}
```

---

## 6. G-CODE GENERATION

### File: `cnc.js` - `lines2gcode()`

**Input:** Processed path data dengan semua operasi di atas

**Output:** G-code string

**Struktur G-code:**
```
; Header
G21 ; Metric
G90 ; Absolute positioning

; Initialization
G0 Z{safe_z} F{travel_speed}
M3 S{power} ; Spindle/Laser on

; Body - Processed paths
G0 X{x} Y{y} ; Rapid to start
G1 Z{cut_z} F{plunge_speed} ; Plunge
G1 X{x} Y{y} F{cut_speed} ; Cut
...
G0 Z{safe_z} ; Retract

; Footer
M5 ; Spindle/Laser off
G0 X0 Y0 ; Return home
```

**Parameter per operasi:**

| Parameter | Sumber | Keterangan |
|-----------|--------|------------|
| Feed Rate | User input / Style attr | Kecepatan cutting |
| Plunge Rate | User input | Kecepatan Z down |
| Safe Z | User input | Z untuk travel |
| Cut Z | Material thickness | Z cutting depth |
| Power | User input | Untuk laser |
| Tool Dia | User input / Style | Diameter tool |

---

## 7. COMPRESSION (Optional)

### File: `gcodex.js`

**Format Binary GX:**

```
Header (1 byte):
  Bits 0-3: Command type
  Bits 4-7: Flags (X present, Y present, Z present, etc.)

Data (variable):
  X: 2 bytes (scaled integer, 0.005mm resolution)
  Y: 2 bytes (scaled integer)
  Z: 1 byte (scaled integer, 0.1mm resolution)
  F: 2 bytes (feed rate)
  S: 1 byte (power)
```

**Transformasi:**
```
G1 X10.5 Y20.3 Z-1.0 F1000 S255
    ↓
[Header: 0x07] [X: 2100] [Y: 4060] [Z: 246] [F: 1000] [S: 255]
    ↓
~50% size reduction
```

---

## 8. OUTPUT

### 8.1 Display Preview

**Canvas Rendering:**
```javascript
// Draw paths dengan color coding
ctx.strokeStyle = path.color;
ctx.beginPath();
for (each point in path) {
    ctx.lineTo(point.x, point.y);
}
ctx.stroke();

// Draw travel moves (dashed gray)
ctx.setLineDash([5, 5]);
ctx.strokeStyle = "#808080";
// ... draw travel paths

// Draw cutting direction arrows
for (each segment) {
    draw_arrow(midpoint, direction);
}
```

### 8.2 Machine Communication

**Via Serial/WebSocket:**
```javascript
// Send G-code line by line dengan flow control
function sendgcode(line) {
    if (buffer_size - buffer_used > line.length) {
        serial.write(line + "\n");
        buffer_used += line.length;
    } else {
        wait_for_ok();
    }
}

// Handle OK response dari CNC
function on_ok() {
    buffer_used -= last_line_length;
    send_next_line();
}
```

**Via File Upload:**
```go
// app.go - UploadFile
func (a *App) UploadFile(ip, filename, data string) error {
    body := &bytes.Buffer{}
    writer := multipart.NewWriter(body)
    part, _ := writer.CreateFormFile("file", filename)
    part.Write([]byte(data))
    writer.Close()
    
    resp, err := http.Post("http://"+ip+"/upload", 
                          writer.FormDataContentType(), body)
    return err
}
```

---

## Summary Flowchart

```
┌──────────────────────────────────────────────────────────────────────┐
│                        INKSCAPE EXTENSION                            │
│  SVG Paths → CubicSuperPath → Transforms → Subdivision → Points     │
│                           ↓                                          │
│              Custom Format String (X:, P:, coords, >REVECTOR2)       │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ WebSocket
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         GO BACKEND                                   │
│              WebSocket Server → Event Emit                           │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ Wails Event
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      FRONTEND PROCESSING                             │
│  Parse → Style Decode → Offset (Clipper) → Overcut → Tabs → Sort    │
│                           ↓                                          │
│     ┌─────────────┬─────────────┬─────────────┐                     │
│     ▼             ▼             ▼             ▼                     │
│  [V-Carve]    [Pocket]    [Engrave]      [Cut]                      │
│  Segmentation Spiral       Raster      Standard                     │
│  Collision   Clearing      Dithering   Offset                       │
│  Depth calc  Toolpath      Power mod   Direction                    │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       G-CODE GENERATION                              │
│  lines2gcode() → G-code String → (Optional: Binary Compression)     │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        [Display]    [Editor]     [Machine]
       Canvas        Ace.js       Serial/WS/HTTP
       Preview       Edit         Send
```

---

## Key Data Structures

### 1. Inkscape Output (Python Dict)
```python
kpaths = [
    ({
        'fill:': '#ffffff',
        'stroke:': '#000000',
        'stroke-width:': '0'
    }, [
        (10.5, 20.3),
        (15.2, 25.8),
        ...
    ]),
    ...
]
```

### 2. Internal Format (JavaScript Object)
```javascript
{
    paths: [{
        style: {fill, stroke, strokeWidth},
        points: [[x,y], ...],
        closed: boolean
    }],
    images: [{x, y, width, height, data}],
    scale: number
}
```

### 3. Processed Lines (Pre-G-code)
```javascript
{
    length: number,
    offset: number,
    startX: number,
    startY: number,
    lines: [[cmd, x, y], ...],
    isClosed: boolean,
    shapeNum: number,
    tabs: [positions],
    cutDirection: 'climb'|'conventional'
}
```

### 4. G-code String
```
G21
G90
M3 S255
G0 Z5 F6000
G0 X10 Y20
G1 Z-1 F300
G1 X15 Y25 F1000
...
M5
```

---

## Catatan Penting untuk Refactoring

### Issue yang Teridentifikasi:

1. **Single File Complexity** 
   - `costy-x.js` dan `cnc.js` terlalu besar (>2000 lines)
   - Mixing concerns: UI, calculation, G-code generation

2. **Global State**
   - Banyak variabel global yang saling terkait
   - Sulit track data flow

3. **Duplicate Logic**
   - Offset calculation ada di beberapa tempat
   - Clipper operations tersebar

4. **Tight Coupling**
   - Parsing terkait erat dengan processing
   - UI logic bercampur dengan business logic

### Rekomendasi Struktur Modular:

```
src/
├── parser/
│   ├── inkscape-parser.js    # Parse custom format
│   └── svg-parser.js         # SVG direct parsing
├── processor/
│   ├── offset.js             # Clipper operations
│   ├── vcarve.js             # V-carving algorithm
│   ├── pocket.js             # Pocketing algorithm
│   ├── engrave.js            # Rasterization
│   └── sorter.js             # Path sorting
├── generator/
│   ├── gcode-generator.js    # Main G-code gen
│   ├── laser-generator.js    # Laser specific
│   ├── cnc-generator.js      # CNC specific
│   └── plasma-generator.js   # Plasma specific
├── machine/
│   ├── sender.js             # Communication
│   ├── compressor.js         # Binary compression
│   └── protocol.js           # Machine protocols
└── ui/
    ├── canvas.js             # Preview rendering
    ├── editor.js             # G-code editor
    └── controls.js           # Machine controls
```

---

*Dokumen ini dibuat untuk membantu refactoring dan pemahaman sistem KaryaCNC*
