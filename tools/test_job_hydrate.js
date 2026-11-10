// Lightweight harness: verifies the new structured-JOB round-trip for
// pathstoText1 (Option A: store raw parsed geometry, re-run processing on hydrate).
// Run: node tools/test_job_hydrate.js
'use strict';
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync('frontend/public/appcore.js', 'utf8');

const ctx = {
  console,
  Math, JSON, Date, Array, Object, String, Number, Boolean, parseFloat, parseInt,
  isFinite, Infinity, NaN, setTimeout, clearTimeout,
  // stubs for karyacnc.js / browser globals used at call-time
  getnumber: () => 0.1,
  getchecked: () => false,
  setvalue: () => {},
  getvalue: () => '0',
  sqr: x => x * x,
  sqrt: Math.sqrt,
  pow: Math.pow,
  mround: x => Math.round(x),
  mround2: x => Math.round(x),
  mround1: x => Math.round(x),
  isInside: () => false,
  // segment intersection used by virtualStartPoints (returns t along AB or null)
  intersect_point: (A, B, C, D) => {
    const x1 = A[0], y1 = A[1], x2 = B[0], y2 = B[1];
    const x3 = C[0], y3 = C[1], x4 = D[0], y4 = D[1];
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(den) < 1e-12) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    return (t < 0 || t > 1) ? null : t;
  },
  CMD_LASER: 1,
  CMD_CNC: 3,
  cmd: 3,
  window: {},
  document: { getElementById: () => null },
  localStorage: { getItem: () => null, setItem: () => {} },
};
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'appcore.js' });

const pathstoText1 = ctx.pathstoText1;

// square returned to origin -> closed
const input = [
  'X:1',
  'P:none:#000000:0',
  '0,0', '10,0', '10,10', '0,10', '0,0',
  ''
].join('\n');

try {
  const t1 = pathstoText1(input);
  console.log('fresh parse text1 length:', (t1||'').length);
  const lastParsedSnapshot = ctx.lastParsedSnapshot;
  console.log('snapshot paths:', lastParsedSnapshot ? lastParsedSnapshot.paths.length : 'NULL');
  console.log('fresh parsedGeometryData:', ctx.parsedGeometryData ? ctx.parsedGeometryData.length : 'NULL');

  // SAME object (simulates stored history entry being reused across restores)
  const snap = ctx.lastParsedSnapshot;
  const beforeSnap = JSON.parse(JSON.stringify(snap));

  function run(f) {
    ctx.parsedGeometryData = [];
    const t = pathstoText1(null, f);
    const g = ctx.parsedGeometryData;
    return { t: (t||'').length, n: g ? g.length : 0,
             closed: (g && g[0]) ? g[0].closed : null,
             pts: (g && g[0]) ? g[0].points.length : 0 };
  }

  const r1 = run(snap);
  const r2 = run(snap);
  const same = r1.t === r2.t && r1.n === r2.n && r1.closed === r2.closed && r1.pts === r2.pts;
  const unchanged = JSON.stringify(snap) === JSON.stringify(beforeSnap);
  console.log('run1:', JSON.stringify(r1));
  console.log('run2:', JSON.stringify(r2));
  console.log('deterministic across repeated restore:', same);
  console.log('stored snapshot unchanged after hydrate:', unchanged);

  const snapClean = JSON.parse(JSON.stringify(snap));
  snapClean.skipJoin = true;
  const r3 = run(snapClean);
  console.log('run3 (skipJoin flag):', JSON.stringify(r3));
  console.log((same && unchanged && r1.n === 1 && r3.n === 1 && r3.t === r1.t) ? 'OK: repeated-restore + skipJoin works' : 'FAIL: still mutating');

  // ---- nested containment case (outer + inner square) ----
  const nestedInput = [
    'X:1',
    'P:none:#000000:0',
    '0,0','100,0','100,100','0,100','0,0',
    '',
    'P:none:#000000:0',
    '30,30','70,30','70,70','30,70','30,30',
    ''
  ].join('\n');
  function collectFlips() {
    const g = ctx.parsedGeometryData;
    const arr = [];
    for (const sh of (g||[])) arr.push(sh.flip ? 1 : 0);
    return arr.join(',');
  }
  pathstoText1(nestedInput);
  const freshFlips = collectFlips();
  const snapN = JSON.parse(JSON.stringify(ctx.lastParsedSnapshot));
  ctx.parsedGeometryData = [];
  pathstoText1(null, snapN);
  const hydFlips = collectFlips();
  const flipsEqual = freshFlips === hydFlips;
  const hasContainment = !!(snapN.containment);
  console.log('nested fresh flip:', freshFlips);
  console.log('nested hydrate flip:', hydFlips);
  console.log('nested flips equal:', flipsEqual, '| containment cached:', hasContainment);
  console.log((flipsEqual && hasContainment) ? 'OK: nested containment cache preserves flip' : 'FAIL: flip mismatch');

  // ---- MiniSketch wire round-trip (kontrak v1) ----
  const wire = {
    type: 'job', version: 1, units: 'mm',
    paths: [
      { color: '#000000', closed: true, depth: 3, skipJoin: true,
        pts: [[0,0],[100,0],[100,100],[0,100]] },
      { color: '#008080', closed: false, pts: [[50,-10],[50,10]] },
      { color: '#008080', closed: true, pts: [[-5,-5],[5,-5],[5,5],[-5,5]] }
    ],
    images: []
  };
  const job = ctx.jobFromMiniSketchJSON(wire);
  console.log('wire->internal paths:', job.paths.length, '| skipJoin:', job.skipJoin);
  ctx.parsedGeometryData = [];
  const tW = pathstoText1(null, job);
  console.log('wire hydrate text1 len:', (tW||'').length, '| kontur:', ctx.parsedGeometryData ? ctx.parsedGeometryData.length : 0);
  console.log((job.paths.length === 3 && job.skipJoin === true && ctx.parsedGeometryData && ctx.parsedGeometryData.length >= 1) ? 'OK: wire MiniSketch round-trip works' : 'FAIL: wire round-trip');
} catch (e) {
  console.error('ERROR:', e.stack);
  process.exit(1);
}
