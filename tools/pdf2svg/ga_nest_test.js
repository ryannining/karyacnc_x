// Headless test for NFPGA (reduxjs2/frontend/js/nfp_ga.js).
// Test-only helper: tools/ is outside frontend/public, so nothing here ships
// in the built exe.
// Loads the real geometry.js + nfp.js + nfp2.js + nfp_ga.js in Node with a
// minimal DOM/performance shim, builds synthetic parts, and checks:
//   1. GA result fitness is never worse than the descending-size baseline.
//   2. All parts are placed exactly once (no loss, no duplicates).
//   3. No placement overlaps (pairwise polygonsIntersect check).
//   4. Custom-sheet (green) path still works.
//   5. Export-relevant data survives: transformMatrix present, originIndex kept.
//
// Usage: node ga_test.js [seed]
const fs = require('fs');
const path = require('path');
const JS = path.join(__dirname, '..', '..', 'nestjs2', 'frontend', 'js');
function load(f) {
    return fs.readFileSync(path.join(JS, f), 'utf8').replace(/\r\n/g, '\n');
}

// ---- minimal browser shims ----
global.window = {};
global.self = global;
global.performance = { now: () => Date.now() };
let __seed = (process.argv[2] ? parseInt(process.argv[2], 10) : 12345) >>> 0;
const _origRandom = Math.random;
Math.random = function () {
    __seed = (__seed + 0x6D2B79F5) >>> 0;
    let t = __seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const importScripts = () => {};
const WANTS = {
    'geometry.js': ['Path', 'Point', 'GeometryUtil', 'NFPCalculator', 'GEOM_SCALE'],
    'nfp.js': ['NFP'],
    'nfp2.js': ['NFP2SpatialHash', 'NFP2'],
    'nfp_ga.js': ['NFPGA'],
};
const __scope = {};
// geometry.js first: GEOM_SCALE is a top-level const there, and nfp*.js read
// it as a free variable, so it must live on the shared scope object.
for (const f of ['geometry.js', 'nfp.js', 'nfp2.js', 'nfp_ga.js']) {
    const code = load(f);
    const names = Object.keys(__scope);
    const pre = names.map(n => 'var ' + n + ' = __scope["' + n + '"];').join('\n');
    const post = '\nreturn { ' + WANTS[f].join(', ') + ' };';
    const fn = new Function('__scope', 'window', 'self', 'performance', 'importScripts', 'module', 'exports',
        pre + '\n' + code + post);
    Object.assign(__scope, fn(__scope, global.window, global.self, global.performance, importScripts, {}, {}));
}
const { Path, Point, GeometryUtil, NFP, NFP2SpatialHash, NFP2, NFPGA, GEOM_SCALE } = __scope;
if (typeof Path === 'undefined' || typeof NFP2 === 'undefined' || typeof NFPGA === 'undefined') {
    console.error('load failed:', Object.keys(__scope).join(','));
    process.exit(2);
}

// ---- synthetic part builders (units: mm floats, like the real loader) ----
let __idx = 0;
function mkPart(pts, lcolor) {
    const p = new Path([pts.map(q => new Point(q[0] * 1000, q[1] * 1000))], __idx++, '#ff0000', lcolor || '#000000');
    p.align();
    return p;
}
function rect(w, h) { return [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]; }
function tri(w, h) { return [[0, 0], [w, 0], [0, h], [0, 0]]; }
function lshape(w, h, t) {
    return [[0, 0], [w, 0], [w, t], [t, t], [t, h], [0, h], [0, 0]];
}
function withVariants(part, rotations) {
    const variants = rotations.map(a => {
        const v = part.clone();
        if (a !== 0) v.rotate(a);
        return v;
    });
    return { placed: false, color: part.color, lcolor: part.lcolor, originIndex: part.originIndex, childIndex: part.childIndex, variants: variants };
}
function areaOf(placements) {
    const t = new NFP2();
    const b = t.calculateTotalBounds(placements);
    return (b.width * b.height) / (1000 * 1000);
}
function noOverlap(placements) {
    const ps = placements.filter(p => p.lcolor !== '#00ff00');
    for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
            if (ps[i].polygonsIntersect(ps[j], true)) return [ps[i].originIndex, ps[j].originIndex];
        }
    }
    return null;
}
function coverCheck(parts, placements) {
    const want = new Set(parts.filter(p => p.lcolor !== '#00ff00').map(p => p.originIndex));
    const got = placements.filter(p => p.lcolor !== '#00ff00').map(p => p.originIndex);
    if (got.length !== want.size) return 'count ' + got.length + ' != ' + want.size;
    for (const o of got) if (!want.has(o)) return 'unknown originIndex ' + o;
    if (new Set(got).size !== got.length) return 'duplicate placement';
    return null;
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

const SHEET = { width: 1000, height: 1000 };
const GRID = 4 * 1000;

function runCase(name, partList, rotations, sheet) {
    console.log('\nCase: ' + name);
    const parts = partList.map(p => withVariants(p, rotations));
    const sh = sheet || SHEET;

    // plain NFP2 reference (single heuristic run, ascending/descending internal order)
    const ref = new NFP2();
    ref.setSpacing(0);
    const refOut = ref.findBestPosition(parts.map(e => {
        const c = e.variants.map(v => v.clone());
        return { placed: false, color: e.color, lcolor: e.lcolor, originIndex: e.originIndex, childIndex: e.childIndex, variants: c };
    }), sh, null, GRID, []);
    const refArea = areaOf(refOut);

    const ga = new NFPGA();
    ga.setSpacing(0);
    ga.setGAParams(10, 10, 0.1);
    const gaOut = ga.findBestPosition(parts, sh, null, GRID, []);
    const gaArea = areaOf(gaOut);

    check('GA area <= NFP2 reference (' + gaArea.toFixed(1) + ' <= ' + refArea.toFixed(1) + ')',
        gaArea <= refArea + 1e-6, 'ga=' + gaArea + ' ref=' + refArea);
    const ov = noOverlap(gaOut);
    check('no overlaps', ov === null, ov ? ('overlap ' + ov.join(' vs ')) : '');
    const cv = coverCheck(parts, gaOut);
    check('all parts placed exactly once', cv === null, cv || '');
    const tm = gaOut.every(p => Array.isArray(p.transformMatrix) && p.transformMatrix.length === 6);
    check('transformMatrix intact for export', tm);
    check('stats reported', ga.getPerformanceStats().evaluations > 0,
        JSON.stringify(ga.getPerformanceStats()));
}

// 1. mixed rects + triangles (classic order-sensitive case)
__idx = 0;
runCase('mixed rects+triangles', [
    mkPart(rect(200, 120)), mkPart(rect(150, 150)), mkPart(tri(180, 180)),
    mkPart(rect(90, 60)), mkPart(tri(100, 100)), mkPart(rect(120, 80)),
    mkPart(rect(60, 60)), mkPart(tri(70, 140)),
], [0, 90, 180, 270]);

// 2. L-shapes (concave, order matters a lot)
__idx = 0;
runCase('concave L-shapes', [
    mkPart(lshape(200, 200, 60)), mkPart(lshape(180, 180, 50)),
    mkPart(lshape(150, 150, 50)), mkPart(rect(100, 100)),
    mkPart(rect(80, 120)), mkPart(lshape(120, 120, 40)),
], [0, 90, 180, 270]);

// 3. many small identical parts (mass production)
__idx = 0;
runCase('12x identical rects', Array.from({ length: 12 }, () => mkPart(rect(100, 60))), [0, 90]);

// 4. single part (degenerate)
__idx = 0;
runCase('single part', [mkPart(rect(300, 200))], [0, 90, 180, 270]);

// 5. custom green sheet outline
__idx = 0;
console.log('\nCase: custom sheet outline');
{
    const green = mkPart(rect(600, 400), '#00ff00');
    const parts = [withVariants(green, [0]),
        withVariants(mkPart(rect(200, 120)), [0, 90]),
        withVariants(mkPart(tri(150, 150)), [0, 90])];
    const ga = new NFPGA();
    ga.setSpacing(0);
    ga.setGAParams(6, 4, 0.1);
    const out = ga.findBestPosition(parts, SHEET, null, GRID, []);
    const inside = out.filter(p => p.lcolor !== '#00ff00').every(p => {
        const b = p.getBounds();
        return b.x >= -1 && b.y >= -1 && (b.x + b.width) <= 600 * 1000 + 1 && (b.y + b.height) <= 400 * 1000 + 1;
    });
    check('parts stay inside custom sheet', inside);
    const ov = noOverlap(out);
    check('no overlaps', ov === null, ov ? ('overlap ' + ov.join(' vs ')) : '');
    const cv = coverCheck(parts, out);
    check('all parts placed exactly once', cv === null, cv || '');
}

console.log('\n=========================================');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('=========================================');
process.exit(fail === 0 ? 0 : 1);
