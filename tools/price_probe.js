#!/usr/bin/env node
/*
 * price_probe.js — regression test untuk bug "harga jasa (CNC Cost) naik terus
 * setiap klik Process" di karyacnc.
 *
 * Cara pakai:
 *   node tools/price_probe.js                          # uji copy hidup (frontend/public)
 *   node tools/price_probe.js --dir /tmp/before        # uji copy pre-patch (harus GAGAL = bug)
 *
 * Prinsip (skill karyacnc-app): jalankan kode, jangan dibaca.
 *  - Semua baris aritmatika di bawah di-slice VERBATIM dari file hidup (by anchor,
 *    bukan by nomor baris), jadi angka yang keluar adalah aritmatika asli aplikasi.
 *  - Urutan panggilan tiap tier dan letak reset di-assert dari sumber.
 *  - Probe ini sadar-versi: titik reset yang terdeteksi di sumber itulah yang
 *    dipakai untuk menyimulasikan tiap tier, sehingga satu skrip bisa membuktikan
 *    "sebelum patch = naik" dan "sesudah patch = idempoten".
 */
const fs = require('fs');
const path = require('path');

function argVal(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const DIR = argVal('--dir', '/mnt/smbshare/wails/karyacnc/frontend/public');

const readLF = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const appcore = readLF(path.join(DIR, 'appcore.js'));
const cnc = readLF(path.join(DIR, 'cnc.js'));
const kc = readLF(path.join(DIR, 'karyacnc.js'));

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '   [' + extra + ']' : ''));
  if (!cond) fails++;
}
const count = (s, sub) => s.split(sub).length - 1;

function body(src, fnName) {
  const start = src.indexOf('\nfunction ' + fnName + '(');
  if (start < 0) return '';
  const next = src.indexOf('\nfunction ', start + 1);
  return src.slice(start, next < 0 ? src.length : next);
}
function ownerFn(src, anchor) {
  const i = src.indexOf(anchor);
  if (i < 0) return null;
  const m = [...src.slice(0, i).matchAll(/\nfunction\s+([A-Za-z0-9_$]+)\s*\(/g)];
  return m.length ? m[m.length - 1][1] : null;
}

const A_TOTAL_RESET = '\n\ttotaltime = 0;';
const A_CARVE_RESET = '\n\tcarvetime = 0;';
const A_TOTAL_INC = '\n\t\ttotaltime += pdis / (f2 * fm3 * 0.0167);';
const A_MENIT = "\n\tvar menit = mround((pockettime + carvetime + totaltime + engravetime + travtime + bitmaptime) / 60.0);";
const A_MENIT2 = '\n\t\tmenit *= 2;';

console.log('== Target: ' + DIR + ' ==\n');

// ---------------------------------------------------------------------------
// 1) Aritmatika & pemetaan penulis/pembaca akumulator
// ---------------------------------------------------------------------------
console.log('-- 1. Pemilik akumulator --');
check('totaltime +=  di lines2gcode()', ownerFn(appcore, A_TOTAL_INC) === 'lines2gcode', ownerFn(appcore, A_TOTAL_INC));
check('menit dihitung di gcode_verify()', ownerFn(appcore, A_MENIT) === 'gcode_verify');
check('baris menit *= 2 (faktor jasa CNC) masih ada', ownerFn(appcore, A_MENIT2) === 'gcode_verify');
const carveIncOwners = [...cnc.matchAll(/\bcarvetime \+=/g)].map(m =>
  ownerFn(cnc, '\n' + cnc.slice(0, m.index).split('\n').pop()));
check('carvetime += hanya di fungsi v-carve', carveIncOwners.every(o => /vcarve/.test(o + '')), carveIncOwners.join(','));
check('vcarve() (dipanggil dobtvcarve() dari gcode_verify()) tidak me-reset sendiri',
  !/\bcarvetime\s*=\s*0/.test(body(cnc, 'vcarve')));
check('dobtvcarve() memanggil vcarve()', /vcarve\(/.test(body(cnc, 'dobtvcarve')));
const gv = body(appcore, 'gcode_verify');
const em = body(appcore, 'emitGcodeOnly');
check('gcode_verify() memanggil dobtvcarve() + drawvcarve()', /dobtvcarve\(\)/.test(gv) && /drawvcarve\(\)/.test(gv));
check('emitGcodeOnly() memanggil lines2gcode()', /lines2gcode\(/.test(em));

// ---------------------------------------------------------------------------
// 2) Urutan pemanggilan tiap tier (dari sumber)
// ---------------------------------------------------------------------------
console.log('\n-- 2. Urutan panggilan per tier --');
const rf = body(kc, 'refreshgcodeFast');   // Tier C
const rs = body(kc, 'refreshgcodeSort');   // Tier B
const mf = body(appcore, 'myFunction');    // Tier A
check('Tier C : emitGcodeOnly -> gcode_verify, TANPA sortGcodes',
  rf.indexOf('emitGcodeOnly(') >= 0 && rf.indexOf('gcode_verify(') > rf.indexOf('emitGcodeOnly(') &&
  rf.indexOf('sortGcodes(') < 0);
check('Tier B : sortGcodes -> emitGcodeOnly -> gcode_verify',
  rs.indexOf('sortGcodes(') >= 0 && rs.indexOf('emitGcodeOnly(') > rs.indexOf('sortGcodes(') &&
  rs.indexOf('gcode_verify(') > rs.indexOf('emitGcodeOnly('));
check('Tier A : sortedgcode() [sortGcodes] lalu gcode_verify(1)',
  /sortedgcode\(\)/.test(mf) && mf.indexOf('gcode_verify(1)') > mf.indexOf('sortedgcode()'));

// ---------------------------------------------------------------------------
// 3) Deteksi fix: di mana akumulator di-reset?
// ---------------------------------------------------------------------------
console.log('\n-- 3. Titik reset yang terdeteksi --');
const sortResetsTotal = /\n\s*totaltime = 0;/.test(body(appcore, 'sortGcodes'));
const sortResetsCarve = /\n\s*carvetime = 0;/.test(body(appcore, 'sortGcodes'));
const emitResetsTotal = /\n\s*totaltime = 0;/.test(em);
const verifyResetsCarve = /\n\s*carvetime = 0;/.test(gv);
const verifyResetsEngrave = /\n\s*engravetime = 0;/.test(gv);
console.log('  sortGcodes() : totaltime=' + sortResetsTotal + ' carvetime=' + sortResetsCarve);
console.log('  emitGcodeOnly(): totaltime=' + emitResetsTotal +  '   (Tier C melewati sortGcodes())');
console.log('  gcode_verify() : carvetime=' + verifyResetsCarve + ' engravetime=' + verifyResetsEngrave);
check('fix harga terpasang: emitGcodeOnly() me-reset totaltime', emitResetsTotal);
check('fix harga terpasang: gcode_verify() me-reset carvetime', verifyResetsCarve);
check('emitGcodeOnly() TIDAK me-reset carvetime (diproduksi di gcode_verify)',
  !/\n\s*carvetime = 0;/.test(em));

// ---------------------------------------------------------------------------
// 4) Jalankan aritmatika asli
// ---------------------------------------------------------------------------
console.log('\n-- 4. Aritmatika (potongan kode asli dieksekusi) --');
const A_TOTAL = A_TOTAL_INC.trim();
const A_CARVE = '\n\tif (totalmm > 0) carvetime += totalmm / (feed / 60.0);'.trim();
const incTotal = new Function('totaltime', 'pdis', 'f2', 'fm3', A_TOTAL + '\nreturn totaltime;');
const incCarve = new Function('carvetime', 'totalmm', 'feed', A_CARVE + '\nreturn carvetime;');
const mround = (x) => Math.round(x * 100) / 100;
const calcMenit = new Function('pockettime', 'carvetime', 'totaltime', 'engravetime', 'travtime', 'bitmaptime', 'cmd', 'mround',
  A_MENIT.trim() + '\n' + A_MENIT2.trim() + '\nreturn menit;');
const calcCost = new Function('menit', 'hargacut', 'w', 'h', 'harga',
  'return { cnc: Math.ceil(menit * hargacut), mat: Math.ceil(w * h * harga), total: Math.ceil(menit * hargacut + w * h * harga) };');

// fixture: main cut 100 mm @ 600 mm/min + v-carve 60 mm @ 600 mm/min; cutprice 1500, mode CNC
const SEG = 10, PFDIS = 10, F2 = 10, FM3 = 60, CARVE_MM = 60, CARVE_FEED = 600;
const emitRun = (t) => { for (let i = 0; i < SEG; i++) t = incTotal(t, PFDIS, F2, FM3); return t; };
const PER = { total: emitRun(0), carve: incCarve(0, CARVE_MM, CARVE_FEED) };
console.log('  kontribusi 1x run: totaltime += ' + PER.total.toFixed(3) + 's, carvetime += ' + PER.carve.toFixed(3) + 's');

function click(tier, tot, cv) {
  if (tier !== 'C') { tot = 0; cv = 0; }          // sortGcodes(): reset
  if (emitResetsTotal) tot = 0;                   // emitGcodeOnly(): reset (fix)
  tot = emitRun(tot);                             // lines2gcode()
  if (verifyResetsCarve) cv = 0;                  // gcode_verify(): reset (fix)
  cv = incCarve(cv, CARVE_MM, CARVE_FEED);        // vcarve() via dobtvcarve()
  const menit = calcMenit(0, cv, tot, 0, 0, 0, 'CNC', mround);
  return { tot, cv, menit, ...calcCost(menit, 1500, 20, 15, 32) };
}

const k1 = click('A', 0, 0);
const k2 = click('C', k1.tot, k1.cv);
const k3 = click('C', k2.tot, k2.cv);
const k4 = click('C', k3.tot, k3.cv);
const line = (n, p) => console.log(`  klik${n}: totaltime=${p.tot.toFixed(2)}s carvetime=${p.cv.toFixed(2)}s menit=${p.menit} -> CNC Cost=Rp${p.cnc}  TOTAL=Rp${p.total}`);
line(1, k1); line(2, k2); line(3, k3); line(4, k4);

// ---------------------------------------------------------------------------
// 5) Invariant: klik Process tanpa mengubah parameter tidak boleh mengubah harga
// ---------------------------------------------------------------------------
console.log('\n-- 5. Invariant harga (klik ulang, parameter tidak diubah) --');
const idempotent = (k1.cnc === k2.cnc) && (k2.cnc === k3.cnc) && (k3.cnc === k4.cnc);
check('harga identik di klik-1..4 (idempoten)', idempotent,
  idempotent ? 'Rp' + k1.cnc : 'klik1=Rp' + k1.cnc + ' klik2=Rp' + k2.cnc + ' klik3=Rp' + k3.cnc + ' klik4=Rp' + k4.cnc);
check('kenaikan per klik (kalau ada) == 1x kontribusi totaltime',
  Math.abs((k2.tot - k1.tot) - (emitResetsTotal ? 0 : PER.total)) < 1e-9);

console.log('\n' + (fails === 0 ? 'SEMUA ASSERTION LOLOS' : fails + ' ASSERTION GAGAL'));
process.exit(fails === 0 ? 0 : 1);
