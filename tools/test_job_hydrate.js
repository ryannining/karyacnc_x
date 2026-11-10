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

  const snap = JSON.parse(JSON.stringify(lastParsedSnapshot)); // simulate storage round-trip
  ctx.parsedGeometryData = [];
  const t2 = pathstoText1(null, snap);
  console.log('hydrate text1 length:', (t2||'').length);
  console.log('hydrate parsedGeometryData:', ctx.parsedGeometryData ? ctx.parsedGeometryData.length : 'NULL');

  const a = ctx.parsedGeometryData;
  if (a && a.length === 1) {
    console.log('hydrate shape[0].closed =', a[0].closed, '| points =', a[0].points.length);
    console.log('OK: round-trip works');
  } else {
    console.log('WARN: unexpected parsedGeometryData');
  }
} catch (e) {
  console.error('ERROR:', e.stack);
  process.exit(1);
}
