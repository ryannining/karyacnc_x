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
  console.log((same && unchanged && r1.n === 1) ? 'OK: repeated-restore bug fixed' : 'FAIL: still mutating');
} catch (e) {
  console.error('ERROR:', e.stack);
  process.exit(1);
}
