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
  // real point-in-polygon (ray cast), signature used by pathstoText1
  isInside: (x, y, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  },
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

  const svg1 = ctx.getSvgText();
  const svg2 = ctx.getSvgText();   // should be cached
  console.log('SVG lazy valid:', svg1.length > 100 && svg1.indexOf('<svg') === 0, '| cached identical:', svg1 === svg2, '| len', svg1.length);

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
      { color: '#000000', closed: true, depth: 3, skipJoin: true, weight: 5000,
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
  const snapW = ctx.lastParsedSnapshot;
  console.log('wire snapshot paths:', snapW ? snapW.paths.length : 'NULL', '| containment:', snapW && snapW.containment ? 'yes' : 'no', '| skipJoin:', snapW ? snapW.skipJoin : '?');
  console.log((job.paths.length === 3 && job.skipJoin === true && ctx.parsedGeometryData && ctx.parsedGeometryData.length >= 1 && snapW && snapW.containment && snapW.skipJoin === true) ? 'OK: wire MiniSketch round-trip + snapshot cache works' : 'FAIL: wire round-trip');
  const stSort = ctx.parsedGeometryData && ctx.parsedGeometryData[0] ? ctx.parsedGeometryData[0].sty.sortadd : null;
  console.log('wire first path sortadd (weight 5000):', stSort);
  console.log((stSort === 5000) ? 'OK: weight -> sortadd works' : 'FAIL: weight mapping');

  // Inkscape-style #2B0000 vs weight
  const w2 = {
    type: 'job', version: 1, units: 'mm',
    paths: [
      { color: '#2B0000', closed: true, pts: [[0,0],[10,0],[10,10],[0,10]] }
    ], images: []
  };
  const job2 = ctx.jobFromMiniSketchJSON(w2);
  ctx.parsedGeometryData = [];
  pathstoText1(null, job2);
  const st2 = ctx.parsedGeometryData && ctx.parsedGeometryData[0] ? ctx.parsedGeometryData[0].sty.sortadd : null;
  console.log('legacy #2B0000 sortadd:', st2);
  console.log((st2 === 100000) ? 'OK: legacy #2B0000 -> sortadd 100000' : 'FAIL: legacy mapping');

  // Negative weight must survive (not zeroed)
  const wNeg = {
    type: 'job', version: 1, units: 'mm',
    paths: [
      { color: '#000000', closed: true, weight: -10000, pts: [[0,0],[10,0],[10,10],[0,10]] }
    ], images: []
  };
  const jobNeg = ctx.jobFromMiniSketchJSON(wNeg);
  ctx.parsedGeometryData = [];
  pathstoText1(null, jobNeg);
  const stNeg = ctx.parsedGeometryData && ctx.parsedGeometryData[0] ? ctx.parsedGeometryData[0].sty.sortadd : null;
  console.log('negative weight sortadd:', stNeg);
  console.log((stNeg === -10000) ? 'OK: negative weight preserved' : 'FAIL: negative weight zeroed');

  // Outline + hole (nested real case): compare fresh vs hydrate final flip + points
  const holeInput = [
    'X:1',
    'P:none:#000000:0',
    '0,0','100,0','100,100','0,100','0,0',
    '',
    'P:none:#000000:0',
    '40,40','60,40','60,60','40,60','40,40',
    ''
  ].join('\n');
  function snapshotFlips() {
    const g = ctx.parsedGeometryData;
    return (g||[]).map(sh => (sh.flip ? 1 : 0)).join(',');
  }
  function snapshotPts() {
    const g = ctx.parsedGeometryData;
    return (g||[]).map(sh => sh.points.length).join(',');
  }
  pathstoText1(holeInput);
  const freshF = snapshotFlips();
  const freshPts = snapshotPts();
  const snapH = JSON.parse(JSON.stringify(ctx.lastParsedSnapshot));
  ctx.parsedGeometryData = [];
  pathstoText1(null, snapH);
  const hydF = snapshotFlips();
  const hydPts = snapshotPts();
  console.log('outline+hole fresh flip:', freshF, '| hydrate flip:', hydF);
  console.log('outline+hole points fresh:', freshPts, '| hydrate:', hydPts);
  // SEMANTIK: pada kasus nested, hole harus flip BERLAWANAN dgn outline (yaitu
  // salah satunya ter-inversi oleh containment). Bukan sekadar konsistensi.
  const fArr = freshF.split(',').map(Number);
  const holeDistinct = fArr.length >= 2 && fArr[0] !== fArr[1];
  console.log('SEMANTIK outline flip != hole flip:', holeDistinct, '(fresh flip=', freshF, ')');
  console.log((freshF === hydF && freshPts === hydPts && holeDistinct) ? 'OK: outline+hole flip & pts identical fresh vs hydrate, hole distinct' : (holeDistinct ? 'OK: hole distinct; konsistensi gagal' : 'FAIL: hole TIDAK dibedakan dari outline (gejala bug)'));

  // Compare TEXT path vs WIRE path for identical geometry (flip)
  const wireHole = {
    type: 'job', version: 1, units: 'mm',
    paths: [
      { color: '#000000', closed: true, pts: [[0,0],[100,0],[100,100],[0,100]] },
      { color: '#000000', closed: true, pts: [[40,40],[60,40],[60,60],[40,60]] }
    ], images: []
  };
  const jobH = ctx.jobFromMiniSketchJSON(wireHole);
  ctx.parsedGeometryData = [];
  pathstoText1(null, jobH);
  const wireF = snapshotFlips();
  console.log('wire outline+hole flip:', wireF, '| text fresh:', freshF);
  console.log((wireF === freshF) ? 'OK: wire & text flip identical' : 'FAIL: wire flip differs from text');

  // ---- double-join regression: enablejoin=ON, outline+hole must both survive ----
  const origGc = ctx.getchecked;
  ctx.getchecked = (k) => k === 'enablejoin' ? true : false;
  const joinInput = [
    'X:1',
    'P:none:#000000:0',
    '0,0','100,0','100,100','0,100','0,0',
    '',
    'P:none:#000000:0',
    '40,40','60,40','60,60','40,60','40,40',
    ''
  ].join('\n');
  ctx.parsedGeometryData = [];
  pathstoText1(joinInput);
  const jFresh = ctx.parsedGeometryData.length;
  const snapJ = JSON.parse(JSON.stringify(ctx.lastParsedSnapshot));
  ctx.parsedGeometryData = [];
  pathstoText1(null, snapJ);
  const jHyd = ctx.parsedGeometryData.length;
  ctx.getchecked = origGc;
  console.log('join=ON fresh contours:', jFresh, '| hydrate contours:', jHyd);
  console.log((jFresh === 2 && jHyd === 2) ? 'OK: no double-join loss (outline+hole survive)' : 'FAIL: contour lost in hydrate (double-join)');

  // ---- childs must not be double-counted on hydrate (regression) ----
  ctx.parsedGeometryData = [];
  pathstoText1(holeInput);
  const childsFresh = (ctx.parsedGeometryData||[]).map(sh => (sh.sty.childs || 0));
  const snapC = JSON.parse(JSON.stringify(ctx.lastParsedSnapshot));
  ctx.parsedGeometryData = [];
  pathstoText1(null, snapC);
  const childsHyd = (ctx.parsedGeometryData||[]).map(sh => (sh.sty.childs || 0));
  console.log('childs fresh:', childsFresh.join(','), '| hydrate:', childsHyd.join(','));
  console.log((JSON.stringify(childsFresh) === JSON.stringify(childsHyd)) ? 'OK: childs identical fresh vs hydrate (no double-count)' : 'FAIL: childs double-counted on hydrate');

  // ---- green guide boxes must not flip cut direction when fill missing (wire) ----
  const greenWire = { type:'job', version:1, units:'mm', paths:[
    {color:'#00ff00', closed:true, pts:[[0,0],[200,0],[200,200],[0,200]]},
    {color:'#00ff00', closed:true, pts:[[10,10],[190,10],[190,190],[10,190]]},
    {color:'#00ff00', closed:true, pts:[[20,20],[180,20],[180,180],[20,180]]},
    {color:'#000000', closed:true, pts:[[40,40],[160,40],[160,160],[40,160]]},
    {color:'#000000', closed:true, pts:[[80,80],[120,80],[120,120],[80,120]]}
  ], images:[] };
  const gJob = ctx.jobFromMiniSketchJSON(greenWire);
  ctx.parsedGeometryData = [];
  pathstoText1(null, gJob);
  const gFlip = (ctx.parsedGeometryData||[]).slice(-2).map(sh => (sh.flip?1:0)).join(',');
  console.log('green wire cut flips (big,small):', gFlip);
  console.log((gFlip === '1,0') ? 'OK: green guide boxes do not flip cut direction' : 'FAIL: green boxes flipped cut direction');

  // ---- wire must close loops so starttab (teal line) detects BOTH crossings ----
  const tlWire = { type:'job', version:1, units:'mm', paths:[
    {color:'#000000', closed:true, pts:[[50,50],[150,50],[150,150],[50,150]]},
    {color:'#008080', closed:false, pts:[[10,100],[190,100]]}
  ], images:[] };
  tlWire.skipJoin = true;
  const tlJob = ctx.jobFromMiniSketchJSON(tlWire);
  ctx.parsedGeometryData = [];
  pathstoText1(null, tlJob);
  const tlVspTotal = (ctx.virtualStartPoints||[]).reduce((a,v)=>a+v.points.length,0);
  const tlClosedAll = (ctx.parsedGeometryData||[]).every(s=>s.closed);
  const tlContours = (ctx.parsedGeometryData||[]).length;
  console.log('wire teal-line total vsp crossings:', tlVspTotal, '| contours:', tlContours, '| all closed:', tlClosedAll);
  console.log((tlVspTotal >= 2 && tlClosedAll) ? 'OK: wire closes loop, teal-line detects crossings' : 'FAIL: wire not closing loop / vsp wrong');
} catch (e) {
  console.error('ERROR:', e.stack);
  process.exit(1);
}
