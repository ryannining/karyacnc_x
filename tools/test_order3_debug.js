'use strict';
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('frontend/public/appcore.js', 'utf8');
const ctx = {
  console, Math, JSON, Date, Array, Object, String, Number, Boolean, parseFloat, parseInt,
  isFinite, Infinity, NaN, setTimeout, clearTimeout,
  getnumber: () => 0.1, getchecked: () => false,
  setvalue: () => {}, getvalue: () => '0',
  sqr: x => x * x, sqrt: Math.sqrt, pow: Math.pow,
  mround: x => Math.round(x), mround2: x => Math.round(x), mround1: x => Math.round(x),
  isInside: (x,y,poly) => { let in2=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))in2=!in2;} return in2; },
  intersect_point: (A,B,C,D)=>{const x1=A[0],y1=A[1],x2=B[0],y2=B[1],x3=C[0],y3=C[1],x4=D[0],y4=D[1];const den=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4);if(Math.abs(den)<1e-12)return null;const t=((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/den;return(t<0||t>1)?null:t;},
  CMD_LASER:1, CMD_CNC:3, cmd:3,
  window:{}, document:{getElementById:()=>null}, localStorage:{getItem:()=>null,setItem:()=>{}},
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const P = ctx.pathstoText1;

function dump(label) {
  const g = ctx.parsedGeometryData || [];
  console.log('--- ' + label + ' (' + g.length + ' kontur) ---');
  g.forEach((sh, i) => {
    console.log('  #' + i + ' closed=' + sh.closed + ' flip=' + (sh.flip?1:0) +
      ' parent=' + JSON.stringify(sh.sty.parent) + ' childs=' + sh.sty.childs +
      ' topparent=' + sh.sty.topparent + ' idp=' + sh.sty.idp);
  });
}

// 3 tingkat: O luar (200), counter (100), kotak (50)
const classic = [
  'X:1',
  'P:none:#000000:0', '0,0','200,0','200,200','0,200','0,0','',
  'P:none:#000000:0', '50,50','150,50','150,150','50,150','50,50','',
  'P:none:#000000:0', '75,75','125,75','125,125','75,125','75,75',''
].join('\n');
ctx.parsedGeometryData = [];
P(classic);
dump('CLASSIC 3-tingkat');

const wire = { type:'job', version:1, units:'mm', paths:[
  {color:'#000000', closed:true, pts:[[0,0],[200,0],[200,200],[0,200]]},
  {color:'#000000', closed:true, pts:[[50,50],[150,50],[150,150],[50,150]]},
  {color:'#000000', closed:true, pts:[[75,75],[125,75],[125,125],[75,125]]}
], images:[] };
const job = ctx.jobFromMiniSketchJSON(wire);
ctx.parsedGeometryData = [];
P(null, job);
dump('WIRE 3-tingkat');
