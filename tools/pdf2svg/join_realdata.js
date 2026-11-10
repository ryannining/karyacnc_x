// KaryaCNC combine-segment audit on real customer SVGs (the SVGs in this folder).
// Runs the LIVE join code from appcore.js and reports:
//   retrace  = line pairs inside one polyline that cut the same line twice
//   lost     = deleted geometry not covered by any surviving polyline (data loss)
//   del      = total length removed as duplicate / double-drawn
//
//   node join_realdata.js ../../frontend/public/appcore.js "SITE PLAN.svg" 0.1 [auditTolMul]
//
// mind = UI "R" field (SQUARED distance threshold). auditTolMul=1.5 relaxes the
// coverage audit; DEBUG_LOST=5 prints the uncovered segments.
// Test-only helper: tools/ is outside frontend/public, so nothing here ships
// in the built exe.
const fs = require('fs');

function loadJoin(file) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const anchor = lines.findIndex(l => l === 'function pathstoText1(gx) {');
    const hStart = lines.findIndex(l => l.indexOf('SECTION: Combine segment') >= 0);
    const helpers = (hStart >= 0 && hStart < anchor) ? lines.slice(hStart, anchor).join('\n') : '';
    const jStart = lines.findIndex(l => l === '\tif (join) {');
    let jEnd = -1;
    for (let i = jStart; i < lines.length; i++) if (lines[i] === '\t}') { jEnd = i; break; }
    return new Function('paths', 'mind', 'join',
        'function sqr(x){return x*x;}\n' + helpers + '\n' + lines.slice(jStart, jEnd + 1).join('\n') + '\nreturn paths;');
}

// --- minimal SVG -> internal path format (mm user units, M/L/H/V/Z; C uses its
// endpoint, the app's own curve flattening happens in Inkscape) ---
function parseSvg(file, mind) {
    const s = fs.readFileSync(file, 'utf8');
    const paths = [];
    let stroke = '#000000';
    const re = /<g([^>]*)>|<\/g>|<path([^>]*)\/?>/g;
    let m;
    const stack = [];
    while ((m = re.exec(s)) !== null) {
        if (m[0] === '</g>') { if (stack.length) stroke = stack.pop(); continue; }
        if (m[1] !== undefined) {
            const st = /stroke="([^"]+)"/.exec(m[1]);
            stack.push(stroke);
            if (st) stroke = st[1];
            continue;
        }
        const attrs = m[2];
        const dm = /\sd="([^"]+)"/.exec(attrs);
        if (!dm) continue;
        const own = /stroke="([^"]+)"/.exec(attrs);
        const st = own ? own[1] : stroke;
        const d = dm[1];
        let cx = 0, cy = 0, sx = 0, sy = 0;
        let cur = [];
        const toks = d.match(/[MmLlCcSsQqTtAaHhVvZz][^MmLlCcSsQqTtAaHhVvZz]*/g) || [];
        const flush = () => { if (cur.length >= 2) paths.push([cur, st]); cur = []; };
        for (const t of toks) {
            const c = t[0];
            const nums = (t.slice(1).match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
            const rel = c === c.toLowerCase();
            const C = c.toUpperCase();
            if (C === 'M') {
                flush();
                cx = rel ? cx + nums[0] : nums[0];
                cy = rel ? cy + nums[1] : nums[1];
                sx = cx; sy = cy;
                cur.push([cx, cy]);
                for (let i = 2; i + 1 < nums.length; i += 2) {
                    cx = rel ? cx + nums[i] : nums[i];
                    cy = rel ? cy + nums[i + 1] : nums[i + 1];
                    cur.push([cx, cy]);
                }
            } else if (C === 'L') {
                for (let i = 0; i + 1 < nums.length; i += 2) {
                    cx = rel ? cx + nums[i] : nums[i];
                    cy = rel ? cy + nums[i + 1] : nums[i + 1];
                    cur.push([cx, cy]);
                }
            } else if (C === 'H') {
                for (let i = 0; i < nums.length; i++) { cx = rel ? cx + nums[i] : nums[i]; cur.push([cx, cy]); }
            } else if (C === 'V') {
                for (let i = 0; i < nums.length; i++) { cy = rel ? cy + nums[i] : nums[i]; cur.push([cx, cy]); }
            } else if (C === 'C') {
                for (let i = 0; i + 5 < nums.length; i += 6) {
                    cx = rel ? cx + nums[i + 4] : nums[i + 4];
                    cy = rel ? cy + nums[i + 5] : nums[i + 5];
                    cur.push([cx, cy]);
                }
            } else if (C === 'Z') {
                cur.push([sx, sy]);
            }
        }
        flush();
    }
    return paths.map(([pts, st]) => {
        const a = pts[0], b = pts[pts.length - 1];
        const closed = pts.length > 2 && ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) < mind;
        return [pts.map(p => p.slice()), false, 0, 0, 0, [], 0, 0, closed, { stroke: st, fill: '#000000' }];
    });
}

function live(paths) { return paths.filter(p => p[0].length > 0); }
function plen(pts) {
    let l = 0;
    for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return l;
}
function retrace(paths, mind, win) {
    const eps = Math.sqrt(mind + 0.1) * 1.2;
    let n = 0;
    for (const p of paths) {
        const q = p[0];
        for (let i = 0; i + 1 < q.length; i++) {
            const ax = q[i][0], ay = q[i][1], bx = q[i + 1][0], by = q[i + 1][1];
            const ul = Math.hypot(bx - ax, by - ay);
            if (ul < 1e-12) continue;
            const ux = (bx - ax) / ul, uy = (by - ay) / ul;
            for (let j = i + 2; j + 1 < q.length && j <= i + win; j++) {
                const cx = q[j][0], cy = q[j][1], dx = q[j + 1][0], dy = q[j + 1][1];
                const vl = Math.hypot(dx - cx, dy - cy);
                if (vl < 1e-12) continue;
                const vx = (dx - cx) / vl, vy = (dy - cy) / vl;
                if (Math.abs((cx - ax) * uy - (cy - ay) * ux) > eps) continue;
                if (Math.abs((dx - ax) * uy - (dy - ay) * ux) > eps) continue;
                if (Math.abs((ax - cx) * vy - (ay - cy) * vx) > eps) continue;
                if (Math.abs((bx - cx) * vy - (by - cy) * vx) > eps) continue;
                const tc = ((cx - ax) * ux + (cy - ay) * uy) / ul;
                const td = ((dx - ax) * ux + (dy - ay) * uy) / ul;
                const lo = Math.max(0, Math.min(tc, td)), hi = Math.min(1, Math.max(tc, td));
                if ((hi - lo) * ul > eps) { n++; }
            }
        }
    }
    return n;
}

function jcPtSegD2(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
    const vv = vx * vx + vy * vy;
    let t = vv > 0 ? (wx * vx + wy * vy) / vv : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const dx = px - ax - t * vx, dy = py - ay - t * vy;
    return dx * dx + dy * dy;
}

// Audit: every deleted path must still be covered by a surviving polyline
// (sample points within tol). Anything not covered is real geometry loss.
function coverageAudit(all, orig, tol, debug) {
    const cell = Math.max(4 * tol, 0.5);
    const grid = Object.create(null);
    const key = (x, y) => x + ',' + y;
    for (const p of all) {
        const q = p[0];
        if (q.length < 2) continue;
        for (let i = 0; i + 1 < q.length; i++) {
            const ax = q[i][0], ay = q[i][1], bx = q[i + 1][0], by = q[i + 1][1];
            const len = Math.hypot(bx - ax, by - ay);
            const steps = Math.max(1, Math.ceil(len / cell));
            for (let s = 0; s <= steps; s++) {
                const x = ax + (bx - ax) * s / steps, y = ay + (by - ay) * s / steps;
                const k = key(Math.floor(x / cell), Math.floor(y / cell));
                (grid[k] || (grid[k] = [])).push([ax, ay, bx, by]);
            }
        }
    }
    const t2 = tol * tol;
    const near = (x, y) => {
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            const c = grid[key(cx + dx, cy + dy)];
            if (!c) continue;
            for (const s of c) if (jcPtSegD2(x, y, s[0], s[1], s[2], s[3]) < t2) return true;
        }
        return false;
    };
    let lostSeg = 0, lostLen = 0, lostPaths = 0;
    let debugShown = 0;
    let segShown = 0;
    for (let i = 0; i < all.length; i++) {
        if (all[i][0].length > 0) continue;
        const q = orig[i];
        let bad = 0;
        for (let j = 0; j + 1 < q.length; j++) {
            const x0 = q[j][0], y0 = q[j][1], x1 = q[j + 1][0], y1 = q[j + 1][1];
            let uncov = false;
            for (let t = 0; t <= 4; t++) {
                const x = x0 + (x1 - x0) * t / 4, y = y0 + (y1 - y0) * t / 4;
                if (!near(x, y)) { uncov = true; break; }
            }
            if (uncov) {
                lostSeg++;
                lostLen += Math.hypot(x1 - x0, y1 - y0);
                bad = 1;
                if (debug && debugShown < debug) {
                    debugShown++;
                    console.log('    LOST path#' + i + ' seg#' + j + ' (' + x0 + ',' + y0 + ')->(' + x1 + ',' + y1 +
                        ') len=' + Math.hypot(x1 - x0, y1 - y0).toFixed(3) +
                        ' npts=' + orig[i].length + ' stroke=' + all[i][9].stroke);
                }
            } else if (debug && debugShown < debug && segShown < 3) {
                segShown++;
                console.log('    kept path#' + i + ' seg#' + j);
            }
        }
        if (bad) lostPaths++;
    }
    return { lostSeg, lostLen, lostPaths };
}

const file = process.argv[2];
const svg = process.argv[3];
const mind = process.argv[4] ? Number(process.argv[4]) : 0.1;
const runJoin = loadJoin(file);
const paths = parseSvg(svg, mind);
const inP = paths.length, inV = paths.reduce((s, p) => s + p[0].length, 0);
const inL = paths.reduce((s, p) => s + plen(p[0]), 0);
const inClosed = paths.filter(p => p[8]).length;
const orig = paths.map(p => p[0].map(q => q.slice()));
const t0 = Date.now();
runJoin(paths, mind, true);
const ms = Date.now() - t0;
const lv = live(paths);
const outV = lv.reduce((s, p) => s + p[0].length, 0);
const outL = lv.reduce((s, p) => s + plen(p[0]), 0);
const bad = retrace(lv, mind, 200);
const auditMul = process.argv[5] ? Number(process.argv[5]) : 1;
const cov = coverageAudit(paths, orig, Math.sqrt(mind) * auditMul, parseInt(process.env.DEBUG_LOST || '0', 10));
console.log(
    svg.replace(/.*\//, '').padEnd(26) +
    ' mind=' + String(mind).padEnd(5) +
    ' in ' + String(inP).padStart(6) + 'p/' + String(inV).padStart(6) + 'v/' + String(inClosed).padStart(4) + 'closed/' + inL.toFixed(1).padStart(9) + 'mm' +
    '  ->  out ' + String(lv.length).padStart(6) + 'p/' + String(outV).padStart(6) + 'v/' + outL.toFixed(1).padStart(9) + 'mm' +
    '  del ' + (inL - outL).toFixed(1).padStart(8) + 'mm' +
    '  retrace=' + String(bad).padStart(4) +
    '  lost=' + String(cov.lostSeg).padStart(4) + 'seg/' + cov.lostLen.toFixed(1).padStart(7) + 'mm' +
    '  ' + String(ms).padStart(6) + 'ms');
