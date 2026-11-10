// KaryaCNC combine-segment test harness (the `if (join)` block of pathstoText1).
// Extracts the LIVE code out of appcore.js and runs CAD "double line" fixtures.
//
//   node join_harness.js ../../frontend/public/appcore.js expect   -> assertions + invariants
//   node join_harness.js ../../frontend/public/appcore.js dump     -> print only (baseline)
//
// Test-only helper: tools/ is outside frontend/public, so nothing here ships
// in the built exe.
const fs = require('fs');
const file = process.argv[2];
const mode = process.argv[3] === 'expect' ? 'expect' : 'dump';

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const anchor = lines.findIndex(l => l === 'function pathstoText1(gx) {');
const hStart = lines.findIndex(l => l.indexOf('SECTION: Combine segment') >= 0);
let helpers = '';
if (hStart >= 0 && hStart < anchor) helpers = lines.slice(hStart, anchor).join('\n');
const jStart = lines.findIndex(l => l === '\tif (join) {');
let jEnd = -1;
for (let i = jStart; i < lines.length; i++) if (lines[i] === '\t}') { jEnd = i; break; }
const joinBlock = lines.slice(jStart, jEnd + 1).join('\n');
const runJoin = new Function('paths', 'mind', 'join',
    'function sqr(x){return x*x;}\n' + helpers + '\n' + joinBlock + '\nreturn paths;');
console.log('code under test: ' + file);
console.log('helpers: ' + (helpers ? 'present' : 'absent') + ', join block lines ' + (jStart + 1) + '-' + (jEnd + 1));

const B = '#000000';
function mk(pts, stroke, closed) {
    return [pts.map(p => p.slice()), false, 0, 0, 0, [], 0, 0, !!closed,
            { stroke: stroke || B, fill: '#000000' }];
}
function live(paths) {
    return paths.filter(p => p[0].length > 0).map(p => p[0].map(q => q.slice()));
}
function norm(paths) {
    return live(paths).map(p => JSON.stringify(p)).sort().join('|');
}
function closedFlags(paths, mind) {
    return live(paths).map(p => {
        const a = p[0], b = p[p.length - 1];
        return (mind < 0.1 ? false : Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) < mind);
    });
}
function fmt(paths) {
    return live(paths).map(p => '[' + p.map(q => q.join(',')).join('] [') + ']').join('   ') || '(none)';
}

// fixtures: [name, path1, path2, ..., mind]   (a path = array of [x,y] vertices)
const F = [
    ['A exact 2pt duplicate', [[0, 0], [10, 0]], [[0, 0], [10, 0]], 0.1],
    ['B 2pt duplicate offset 0.2mm', [[0, 0], [10, 0]], [[0, 0.2], [10, 0.2]], 0.1],
    ['C sloppy dup (one end 0.4mm)', [[0, 0], [10, 0]], [[0.4, 0.05], [10, 0.05]], 0.1],
    ['D 3pt polyline + reversed duplicate', [[0, 0], [10, 0], [10, 5]], [[10, 5], [10, 0], [0, 0]], 0.1],
    ['E open rect drawn twice', [[0, 0], [10, 0], [10, 5], [0, 5]], [[0.05, 0.02], [10.03, 0.01], [10.02, 5.04], [0.01, 5.02]], 0.1],
    ['F crossing weld at the tail', [[0, 0], [10, 0]], [[10, 0.3], [4, -1.0]], 0.1],
    ['L crossing right at the joint stays joined', [[0, 0], [10, 0]], [[10, 0.15], [2, -3]], 0.1],
    ['G two overlapping candidates (short+long)', [[0, 0], [10, 0]], [[10, 0], [6, 0.03]], [[10, 0], [-0.02, 0.03]], 0.1],
    ['H R=0.5 on a 0.4mm parallel pair (known, unchanged)', [[0, 0], [10, 0]], [[0, 0.4], [10, 0.4]], 0.5],
    ['I regression: 4-segment straight chain', [[0, 0], [1, 0]], [[1, 0], [2, 0]], [[2, 0], [3, 0]], [[3, 0], [4, 0]], 0.1],
    ['J regression: L turn', [[0, 0], [10, 0]], [[10, 0], [10, 5]], 0.1],
    ['K regression: disconnected', [[0, 0], [1, 0]], [[5, 5], [6, 6]], 0.1],
];
const EXPECT = {
    'A exact 2pt duplicate': '[[[0,0],[10,0]]]',
    'B 2pt duplicate offset 0.2mm': '[[[0,0],[10,0]]]',
    'C sloppy dup (one end 0.4mm)': '[[[0,0],[10,0]]]',
    'D 3pt polyline + reversed duplicate': '[[[0,0],[10,0],[10,5]]]',
    'E open rect drawn twice': '[[[0.05,0.02],[10.03,0.01],[10.02,5.04],[0.01,5.02]]]',
    'F crossing weld at the tail': '[[[0,0],[10,0]],[[10,0.3],[4,-1]]]',
    'L crossing right at the joint stays joined': '[[[0,0],[10,0],[10,0.15],[2,-3]]]',
    'G two overlapping candidates (short+long)': '[[[10,0],[-0.02,0.03]]]',
    'H R=0.5 on a 0.4mm parallel pair (known, unchanged)': '[[[0,0],[10,0]]]',
    'I regression: 4-segment straight chain': '[[[0,0],[1,0],[1,0],[2,0],[2,0],[3,0],[3,0],[4,0]]]',
    'J regression: L turn': '[[[0,0],[10,0],[10,0],[10,5]]]',
    'K regression: disconnected': '[[[0,0],[1,0]],[[5,5],[6,6]]]',
};
// closed flag expected at appcore.js:4088 semantics (mind<0.1 -> false)
const EXPECT_CLOSED = {
    'D 3pt polyline + reversed duplicate': 'false',
    'E open rect drawn twice': 'false',
};

// invariant: no output polyline may retrace itself (two non adjacent segments
// lying on each other) — this is what the P1/P2/P3 work is supposed to prevent.
function retraceViolations(paths, mind) {
    const eps = Math.sqrt(mind + 0.1) * 1.5;
    const bad = [];
    for (const p of live(paths)) {
        for (let i = 0; i + 1 < p.length; i++) {
            for (let j = i + 2; j + 1 < p.length; j++) {
                const ov = jcOverlapLen(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1],
                    p[j][0], p[j][1], p[j + 1][0], p[j + 1][1], eps);
                if (ov > eps) bad.push('seg' + i + '~seg' + j + ' overlap ' + ov.toFixed(3) + 'mm');
            }
        }
    }
    return bad;
}

// helpers copied for the invariant check only
function jcOverlapLen(ax, ay, bx, by, cx, cy, dx, dy, eps) {
    let ux = bx - ax, uy = by - ay;
    const ul = Math.sqrt(ux * ux + uy * uy);
    if (ul < 1e-12) return 0;
    let vx = dx - cx, vy = dy - cy;
    const vl = Math.sqrt(vx * vx + vy * vy);
    if (vl < 1e-12) return 0;
    ux /= ul; uy /= ul; vx /= vl; vy /= vl;
    if (Math.abs((cx - ax) * uy - (cy - ay) * ux) > eps) return 0;
    if (Math.abs((dx - ax) * uy - (dy - ay) * ux) > eps) return 0;
    if (Math.abs((ax - cx) * vy - (ay - cy) * vx) > eps) return 0;
    if (Math.abs((bx - cx) * vy - (by - cy) * vx) > eps) return 0;
    const tc = ((cx - ax) * ux + (cy - ay) * uy) / ul;
    const td = ((dx - ax) * ux + (dy - ay) * uy) / ul;
    let lo = Math.min(tc, td), hi = Math.max(tc, td);
    if (lo < 0) lo = 0;
    if (hi > 1) hi = 1;
    return (hi - lo) * ul;
}

let pass = 0, fail = 0;
for (const f of F) {
    const name = f[0];
    const items = [];
    let mind = 0.1;
    for (const r of f.slice(1)) {
        if (typeof r === 'number') mind = r;
        else items.push(mk(r));
    }
    const paths = items;
    const before = fmt(paths);
    const t0 = Date.now();
    runJoin(paths, mind, true);
    const ms = Date.now() - t0;
    const got = JSON.stringify(live(paths));
    const cf = closedFlags(paths, mind).join(',');
    console.log('--- ' + name + '   (mind=' + mind + ')');
    console.log('    in : ' + before);
    console.log('    out: ' + fmt(paths) + '   closed=[' + cf + ']   ' + ms + 'ms');
    if (mode === 'expect') {
        const want = EXPECT[name];
        if (want !== undefined) {
            const ok = want === got;
            console.log('    ' + (ok ? 'PASS' : 'FAIL') + ' expect ' + want + (ok ? '' : '  got ' + got));
            ok ? pass++ : fail++;
        }
        if (EXPECT_CLOSED[name] !== undefined) {
            const ok = EXPECT_CLOSED[name] === cf;
            console.log('    ' + (ok ? 'PASS' : 'FAIL') + ' closed=' + EXPECT_CLOSED[name] + (ok ? '' : '  got ' + cf));
            ok ? pass++ : fail++;
        }
    }
    {
        const rv = retraceViolations(paths, mind);
        const okv = rv.length === 0;
        console.log('    ' + (mode === 'expect' ? (okv ? 'PASS' : 'FAIL') + ' ' : (okv ? 'ok  ' : 'BAD ')) +
            'invariant: no self-retrace' + (okv ? '' : '  ' + rv.join('; ')));
        if (mode === 'expect') okv ? pass++ : fail++;
    }
}

// perf: 2000-segment straight chain, plus a doubled variant
for (const [label, dup] of [['2000-seg chain', false], ['2000-seg chain + duplicate of every segment', true]]) {
    const inp = [];
    for (let i = 0; i < 2000; i++) {
        inp.push(mk([[i, 0], [i + 1, 0]]));
        if (dup) inp.push(mk([[i, 0.05], [i + 1, 0.05]]));
    }
    const n = inp.length;
    const t0 = Date.now();
    runJoin(inp, 0.1, true);
    const ms = Date.now() - t0;
    const lv = live(inp);
    const pts = lv.reduce((s, p) => s + p.length, 0);
    console.log('--- perf: ' + label + ' (' + n + ' input paths) -> ' + lv.length + ' polylines, ' + pts + ' pts, ' + ms + 'ms');
}

if (mode === 'expect') {
    console.log('\n=========================================');
    console.log('  ' + pass + ' passed, ' + fail + ' failed');
    console.log('=========================================');
    process.exit(fail === 0 ? 0 : 1);
}
