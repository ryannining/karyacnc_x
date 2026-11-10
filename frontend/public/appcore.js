// ============================================================================
// SECTION: Constants and Global Variables
// ============================================================================

// ------------------------------------------------------------------------
// Notes and Documentation
// ------------------------------------------------------------------------
// gcodeoption used to determine: travel,feed,repeat, offset, [render mode 0:normal 1:plt mode 2:engrave]
// RED = PLT MODE for hershey text, offset =0
// BLUE = ENGRAVE
// BLACK = NORMAL
// GREEN = 
// Note: Constants CMD_*, ENGRAVE, OVC_MODE are defined in karyacnc.js
// Note: $, getvalue, setvalue, getchecked, cuttabs are defined in karyacnc.js

// ------------------------------------------------------------------------
// Coordinate and Position Variables
// ------------------------------------------------------------------------
var X1 = 0;
var Y1 = 0;
var lenmm = 0;
var lenn = 0;
var lastf = 0;
var x1 = 0;
var y1 = 0;
var z1 = 0;
var e1 = 0;
// var cmd = 0;  // Defined in karyacnc.js

// ------------------------------------------------------------------------
// Bounding Box Variables
// ------------------------------------------------------------------------
var xmin = 100000;
var ymin = 100000;
var xmax = 0;
var ymax = 0;

var xmin2 = 100000;
var ymin2 = 100000;
var xmax2 = 0;
var ymax2 = 0;

var sxmin = 100000;
var symin = 100000;
var sxmax = 0;
var symax = 0;
var calcmax = 0;

// ------------------------------------------------------------------------
// G-code and Processing Arrays
// ------------------------------------------------------------------------
var gcodes = [];
var harga = 1000;
var cncz = 0;

// ------------------------------------------------------------------------
// 3D Printing Parameters
// ------------------------------------------------------------------------
var layerheight = 0.35;
var filamentD = 1.75;
var filamentTemp = 180;
var retract = 0;
var overlap = 15;
var extrudeMul = 1;
var extrude = (layerheight * layerheight) / (filamentD * filamentD);

// ------------------------------------------------------------------------
// G-code Generation State
// ------------------------------------------------------------------------
var fm = 0;
var gcntr = 0;
var inretract = 0;
var sgcodes = [];
var detail = 1.0;
var opx = -1000;
var opy = -1000;
var line = [];

// ------------------------------------------------------------------------
// Geometry and Cutting Variables
// ------------------------------------------------------------------------
var overcut = [0, 0];
var cross = 0;
var jmltravel = 0;

// ------------------------------------------------------------------------
// Path Processing State
// ------------------------------------------------------------------------
var srl = [];
var disable_ovc = [];
var marking_cut = [];
var disable_tab = [];
var disable_cut = [];
var pause_at = [];
var shapectr = 0;
var collapsepoint = 7;
var noprocess = 14;
var oldlines = [];
var shapenum = 0;
var maxofs = 0;
var combinedpath = [];
var oshapenum = -1;
var cuttab_manual = [];
var starttab_manual = [];
var centerpath = [];
var parsedGeometryData = null;

// ------------------------------------------------------------------------
// Cutting Tab Configuration
// ------------------------------------------------------------------------
var cutevery = 200;
var cutmax = 6;
var cuttablen = 5.5;

// ------------------------------------------------------------------------
// Engraving Variables
// ------------------------------------------------------------------------
var engrave = {};
var engraveDPI = 50;
var carvedeep = 5;
var engrave1 = [];
var engravetime = 0;
var bitmaptime = 0;
var eangle = 0;
var radians = (Math.PI / 180) * eangle;
var rcos = Math.cos(radians);
var rsin = Math.sin(radians);
var r1cos = Math.cos(-radians);
var r1sin = Math.sin(-radians);
var currPw = 0;
var M3 = "M3";

// ------------------------------------------------------------------------
// Style Constants
// ------------------------------------------------------------------------
var dpm;
var defaultsty = {
	"stroke": "#000000",
	"stroke-width": 0,
	"deep": undefined,
	"repeat": undefined
};

var carvesty = {
	"stroke": "#0000ff",
	"fill": "#ff00ff",
	"stroke-width": 0,
	"deep": undefined,
	"dovcarve": true,
	"repeat": undefined
};

var carvestyIn = {
	"stroke": "#0000ff",
	"fill": "#ff00ff",
	"stroke-width": 0,
	"deep": undefined,
	"dovcarve": true,
	"flip": false,
	"repeat": undefined
};

var carvestyOut = {
	"stroke": "#0000ff",
	"fill": "#ff00ff",
	"stroke-width": 0,
	"deep": undefined,
	"dovcarve": true,
	"flip": true,
	"repeat": undefined
};

// ------------------------------------------------------------------------
// Drawing and Visualization Variables
// ------------------------------------------------------------------------
var veeline;
var conline;
var oyct = 0;
var firstline = 0;

// ------------------------------------------------------------------------
// G-code Generation State Variables
// ------------------------------------------------------------------------
var lastz = 0;
var lasee = 0;
var lx;
var ly;
var lastspeed = 1;
var tabcutspeed = 1;
var totaltime = 0;
var skipz = 0;

// ------------------------------------------------------------------------
// Lead and Ramp Variables
// ------------------------------------------------------------------------
var X9 = null;
var Y9;
var X0 = null;
var Y0;
var leads = [];
var rampmoves = []; // save the ramp moves to make a finish move

// ------------------------------------------------------------------------
// Cost and Time Tracking
// ------------------------------------------------------------------------
var fnl = 0;
var hasfnl = 0;
var laddz = 0;

// ------------------------------------------------------------------------
// Cache Variables
// ------------------------------------------------------------------------
var cache_ink_img = [];
var cacheloaded = 0;
var cachedcutpos = [];

// ------------------------------------------------------------------------
// SVG and Path Variables
// ------------------------------------------------------------------------
var lines = [];
var svgdata = [];
var sflipx;
var sflipy;

// ------------------------------------------------------------------------
// Speed and Movement Parameters
// ------------------------------------------------------------------------
var speedplunge = 1000;
var speedretract = 3000;
var speedfeed = 5;
var speedtravel = 100;
var zretract = 15;

// ------------------------------------------------------------------------
// Power and Cutting Parameters
// ------------------------------------------------------------------------
var acpengrave = 0;
var cutpw;
var _rampdown = 0;
var cut_eng = "";

// ------------------------------------------------------------------------
// Image Processing Variables
// ------------------------------------------------------------------------
var ink_images = [];
var engravebounds = [];
var cuttabs = [];
var starttabs = [];
var virtualStartPoints = [];
// ------------------------------------------------------------------------
// Spatial-hash indices (rebuilt on each pathstoText1 / sortedgcode call).
// - cuttabGrid / starttabGrid: maps cell → cuttab / starttab indices, for
//   O(1) edge-vs-tab intersection lookup in prepare_line2
// - srtGrid: built inside sortedgcode for O(1) nearest-polygon lookup
// (parent/child detection uses brute-force intentionally — see note in
//  pathstoText1 — since a 3x3 grid window can miss valid parents.)
// ------------------------------------------------------------------------
// var cuttabGrid = null;     // { grid: Object, cellSize: number, items: [...] }
// var starttabGrid = null;   // { grid: Object, cellSize: number, items: [...] }

// ------------------------------------------------------------------------
// Warning and Output
// ------------------------------------------------------------------------
var warningpath = 0;
// ============================================================================
// SECTION: Helper Functions and Math Utilities
// ============================================================================

// ------------------------------------------------------------------------
// Geometry Helpers
// ------------------------------------------------------------------------
function arrayRotate(arr, count) {
	count -= arr.length * Math.floor(count / arr.length);
	arr.push.apply(arr, arr.splice(0, count));
	return arr;
}
function degSin(d) {
	return Math.sin(Math.PI * d / 180);
}
function degCos(d) {
	return Math.cos(Math.PI * d / 180);
}

function getMatrix(tr) {
	if (tr == "scale(-1, 1)") return [-1, 0, 0, 1, 0, 0];
	if (tr == "scale(1, -1)") return [1, 0, 0, -1, 0, 0];
	if (tr == "scale(-1)" || tr == "scale(-1, -1)") return [-1, 0, 0, -1, 0, 0];
	if (tr.indexOf("rotate") == 0) {
		var d = StrToNum(tr);
		return [degCos(d), degSin(d), -degSin(d), degCos(d), 0, 0];
	}
	if (tr.indexOf("scale") == 0) {
		trx = tr.split(",");
		var sx = StrToNum(trx[0]);
		var sy = StrToNum(trx[1]);
		return [sx, 0, 0, sy, 0, 0];
	}
	// transform matrix
	if (tr.indexOf("matrix") == 0) {
		return JSON.parse(tr.replace("matrix(", "[").replace(")", "]").replaceAll(" ", ","));
	}
	return [1, 0, 0, 1, 0, 0];
}
function mx1(p, mt) {
	return [p[0] * mt[0] + p[1] * mt[2] + mt[4],
	p[0] * mt[1] + p[1] * mt[3] + mt[5]];
}


function intersects_p(a, b, c, d, p, q, r, s) {
	var A = {
		x: a,
		y: b
	};
	var B = {
		x: c,
		y: d
	};
	var C = {
		x: p,
		y: q
	};
	var D = {
		x: r,
		y: s
	};
	return intersect_point(A, B, C, D);
}

function isClockwise(poly, px = 1, py = 2) {
	var sum = 0;
	for (var i = 0; i < poly.length; i++) {
		var cur = poly[i];
		ii = i + 1;
		if (ii == poly.length) ii = 0;
		var next = poly[ii];
		sum += (next[py] * cur[px]) - (next[px] * cur[py]);
	}
	return sum < 0;
}

function sharp(poly, px = 1, py = 2, idx = 0, num = 2, dotcross = 0) {
	var sum = 0;
	ci = idx;
	nci = ci;
	pci = ci;
	cur = poly[ci];
	d1 = 0;
	d2 = 0;
	l = 1;
	while (d1 == 0) {
		pci--;
		if (pci < 0) {
			pci += poly.length;
			l--;
			if (l < 0) break;
		}
		prev = poly[pci];
		vec1 = [prev[px] - cur[px], prev[py] - cur[py]];
		d1 = sqrt(vec1[0] * vec1[0] + vec1[1] * vec1[1]);
	}
	l = 1;
	while (d2 == 0) {
		nci++;
		if (nci >= poly.length) {
			nci -= poly.length;
			l--;
			if (l < 0) break;
		}
		next = poly[nci];
		vec2 = [next[px] - cur[px], next[py] - cur[py]];
		d2 = sqrt(vec2[0] * vec2[0] + vec2[1] * vec2[1]);
	}

	vec1 = [vec1[0] / d1, vec1[1] / d1];
	vec2 = [vec2[0] / d2, vec2[1] / d2];
	dot = (vec1[0] * vec2[0]) + (vec1[1] * vec2[1]);
	cross = (vec1[0] * vec2[1]) - (vec2[0] * vec1[1]);
	if (dotcross) return [dot, cross, vec1, vec2];

	// corner overcut
	if (cross < 0)
		overcut = [vec1[0] + vec2[0], vec1[1] + vec2[1]];
	else overcut = [0, 0];

	return (dot);
}

/**
 * Menghasilkan titik-titik interpolasi Bézier Teardrop Loop untuk sudut dalam.
 * Parameter konsisten dengan dogbone lama: ro (radius), ovmore, vec1, vec2.
 */
function generateBezierDogboneLoop(curPoint, vec1, vec2, ro, ovmore, steps = 8) {
	// vec1 = prev - cur (arah ke titik sebelumnya, ternormalisasi)
	// vec2 = next - cur (arah ke titik berikutnya, ternormalisasi)
	// Arah datang adalah u_in = -vec1
	// Arah keluar adalah u_out = vec2
	var u_in = [-vec1[0], -vec1[1]];
	var u_out = [vec2[0], vec2[1]];

	// Arah puncak loop adalah u_in - u_out
	var bisectX = u_in[0] - u_out[0];
	var bisectY = u_in[1] - u_out[1];
	var bisectLen = Math.sqrt(bisectX * bisectX + bisectY * bisectY);
	if (bisectLen < 0.0001) return [];

	// Kedalaman clearance yang dibutuhkan
	var reqDepth = (Math.sqrt(2 * ro * ro) - ro) + ovmore;
	if (reqDepth <= 0) reqDepth = 0.01;

	// Puncak cubic Bezier t=0.5 berjarak (3/8)*L*bisectLen dari titik sudut C
	var L = (8.0 * reqDepth) / (3.0 * bisectLen);

	var cx = curPoint[1];
	var cy = curPoint[2];

	var p0 = [cx, cy];
	var p1 = [cx + L * u_in[0], cy + L * u_in[1]];
	var p2 = [cx - L * u_out[0], cy - L * u_out[1]];
	var p3 = [cx, cy];

	var loopPoints = [];
	var feed = curPoint[0];
	var tl = curPoint[3];

	var lastX = cx;
	var lastY = cy;

	for (var k = 1; k <= steps; k++) {
		var t = k / steps;
		var mt = 1.0 - t;
		var b0 = mt * mt * mt;
		var b1 = 3.0 * mt * mt * t;
		var b2 = 3.0 * mt * t * t;
		var b3 = t * t * t;

		var bx = b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0];
		var by = b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1];

		var segLen = Math.sqrt((bx - lastX) * (bx - lastX) + (by - lastY) * (by - lastY));
		loopPoints.push([feed, bx, by, tl, segLen]);
		lastX = bx;
		lastY = by;
	}

	return loopPoints;
}

/**
 * Geser posisi tab manual dari panjang busur path offset (sebelum dogbone)
 * ke panjang busur path yang sudah disisipi loop dogbone bezier.
 * cuttab_manual diukur memakai gline[i][3]; addBefore[i] adalah total
 * panjang loop dogbone yang sudah dilewati sebelum titik asli ke-i.
 */
function remapTabLengths(cuts, gline, addBefore) {
	if (!cuts || !cuts.length) return;
	for (var c = 0; c < cuts.length; c++) {
		var pos = cuts[c];
		var bi = gline.length - 1;
		for (var q = 0; q < gline.length; q++) {
			if (gline[q][3] >= pos) {
				bi = q;
				break;
			}
		}
		cuts[c] = pos + addBefore[bi];
	}
}

function xarea() {
	dx = xmax2 - xmin2;
	dy = ymax2 - ymin2;
	v = dx * dy + 1;

	xmin2 = 100000;
	ymin2 = 100000;
	xmax2 = 0;
	ymax2 = 0;
	return v;
}

// ------------------------------------------------------------------------
// Style and Offset Helpers
// ------------------------------------------------------------------------

function getoffset() {
	if (getchecked("pltmode")) return 0;
	var ofs = getnumber('offset');
	return ofs;
}

function RBcolor(stro) {
	stro = stro.toLowerCase();
	return stro.substr(1, 2) + stro.substr(5, 2);
}

// ------------------------------------------------------------------------
// Rotation Helpers
// ------------------------------------------------------------------------

function setup_rotate(angle) {
	currPw = ((angle >> 4) & 15) * 17; // 0 - 255
	eangle = angle;
	angle = (angle & 15) * 12;
	if (angle == 0) angle = getvalue("rasterangle") * 12;
	radians = (Math.PI / 180) * (angle);
	rcos = Math.cos(radians);
	rsin = Math.sin(radians);
	r1cos = Math.cos(-radians);
	r1sin = Math.sin(-radians);
}

function rotateV(cx, cy, x, y, angle) {
	var radians = (Math.PI / 180) * (angle);
	var rcos = Math.cos(radians);
	var rsin = Math.sin(radians);
	var r1cos = Math.cos(-radians);
	var r1sin = Math.sin(-radians);
	nx = (rcos * (x - cx)) + (rsin * (y - cy)) + cx,
		ny = (rcos * (y - cy)) - (rsin * (x - cx)) + cy;
	return [nx, ny];
}

function rotateCW(cx, cy, x, y) {
	nx = (rcos * (x - cx)) + (rsin * (y - cy)) + cx,
		ny = (rcos * (y - cy)) - (rsin * (x - cx)) + cy;
	return [nx, ny];
}

function rotateclimb(cx, cy, x, y) {
	nx = (r1cos * (x - cx)) + (r1sin * (y - cy)) + cx,
		ny = (r1cos * (y - cy)) - (r1sin * (x - cx)) + cy;
	return [nx, ny];
}

// ------------------------------------------------------------------------
// Index Helpers
// ------------------------------------------------------------------------

function getRealIndex(ci, llen, climb, shift, closed) {
	// if climb cut
	var i;
	if (climb) {
		i = (llen) - ci;
		if (!closed) i--;
	} else {
		i = ci;
	}

	i += shift;
	// make sude index is 0 to lines.length-1
	while (i < 0) {
		i += llen;
	}
	while (i >= llen) {
		i -= llen;
	}
	return i;
}

// ------------------------------------------------------------------------
// Spindle Control Helpers
// ------------------------------------------------------------------------

function getspindleoff() {
	if (cmd == CMD_PLASMA) return M3 + " S0\n";
	if (cmd == CMD_LASER) return "";
	return M3 + " S" + Math.floor(getnumber("spindleoffval") * 2.55) + "\n";
}

function getspindleon(dw = 1, dwt = 0) {
	if (cmd == CMD_LASER) return M3 + " S" + cutpw + "\n";
	var tm = (dwt > 0) ? dwt : parseInt(getnumber("dwelltime") * 1000);
	if (cmd == CMD_PLASMA && tm < 100) tm = 100;
	var P = " P" + tm;
	if ((dw == 0) || (P == " P0")) P = "";
	return M3 + " S" + (cmd == CMD_PLASMA ? "255" : cutpw) + P + "\n";
}

// ------------------------------------------------------------------------
// Utility Functions
// ------------------------------------------------------------------------

function getRandomColor() {
	var letters = '0123456789ABCDEF';
	var color = '#';
	for (var i = 0; i < 6; i++) {
		color += letters[Math.floor(Math.random() * 16)];
	}
	return color;
}

function destroyClickedElement(event) {
	document.body.removeChild(event.target);
}

function check_img_cache() {
	cacheloaded++;
	if (cacheloaded == ink_images.length) gcode_verify(1);
}
// ============================================================================
// SECTION: G-code Generation Core
// ============================================================================

// ------------------------------------------------------------------------
// Core G-code Generation Functions
// ------------------------------------------------------------------------

function gcoden(g, f, x2, y2, z2 = 10000, e2 = 1000000) {
	var dx = x2 - x1;
	var dy = y2 - y1;
	var distance = Math.sqrt(dx * dx + dy * dy);

	var xs = 1;
	if (z1 == z2) z2 = 10000;
	g = g * 1;
	f = mround(f);
	gcntr += 1;
	if (gcntr > 30) {
		gcntr = 0;
	}
	if (fm != f) {
		fm = f;
		f = " F" + f;
	} else f = "";
	if (cmd == 4) xs = -1;

	div = div + 'G' + g + f + ' X' + mround(x2 * xs) + ' Y' + mround(y2);
	if (z2 != 10000) div += " Z" + mround(z2);
	if (e2 != 1000000) div += " E" + mround(e2);
	div += '\n';
	x1 = x2;
	y1 = y2;
	if (z2 != 10000) z1 = z2;
	if (e2 != 1000000) e1 = e2;
	lastf = f;
	xmin = Math.min(xmin, x2);
	ymin = Math.min(ymin, y2);
	xmax = Math.max(xmax, x2);
	ymax = Math.max(ymax, y2);
	xmin2 = Math.min(xmin2, x2);
	ymin2 = Math.min(ymin2, y2);
	xmax2 = Math.max(xmax2, x2);
	ymax2 = Math.max(ymax2, y2);
}

function gcode0(f, x2, y2, z2 = 10000, e2 = 1000000) {
	if (retract && (cmd == 4)) {
		if (!inretract) {
			inretract = 1;
			div += "G1 F60 E" + mround(e1 - 1) + "\n";
		}
	}
	gcoden(0, f, x2, y2, z2);
}

function gcode1(f, x2, y2, z2 = 10000, e2 = 1000000) {
	x1 -= x2;
	y1 -= y2;
	lenn = sqrt(x1 * x1 + y1 * y1);
	if (cmd == 4) {
		if (inretract) {
			div += "G1 F60 E" + mround(e1) + "\n";
			inretract = 0;
		}
		e2 = e1 + lenn * extrude * extrudeMul;
	}
	lenmm += lenn;
	gcoden(1, f, x2, y2, z2, e2);
}

function linepush(f, x2, y2, fr = 0) {
	if (fr || (x2 != x1) || (y2 != y1)) {
		x1 -= x2;
		y1 -= y2;
		lenn = sqrt(x1 * x1 + y1 * y1);
		if (cmd == 4) {
			if (inretract) {
				div += "G1 F60 E" + mround(e1) + "\n";
				inretract = 0;
			}
			e2 = e1 + lenn * extrude * extrudeMul;
		}
		lenmm += lenn;
		xmin = Math.min(xmin, x2);
		ymin = Math.min(ymin, y2);
		xmax = Math.max(xmax, x2);
		ymax = Math.max(ymax, y2);

		xmin2 = Math.min(xmin2, x2);
		ymin2 = Math.min(ymin2, y2);
		xmax2 = Math.max(xmax2, x2);
		ymax2 = Math.max(ymax2, y2);

		line.push([f, x2, y2, lenmm, lenn]);
		x1 = x2;
		y1 = y2;
	}
}

// ------------------------------------------------------------------------
// G-code Push Functions
// ------------------------------------------------------------------------

function gcodepush(lenmm, X1, Y1, lenmm1, line, closed) {
	var area;
	if (closed) {
		line.pop();
		closed = line.length > 2;
	}
	if (closed) area = xarea();
	else area = 1;
	var lines;
	var sty = gcstyle[shapenum];
	if (!sty) return;
	var parent = sty.parent;
	if (closed) {
		var ofs1 = 0;
		var linesx = prepare_line2(lenmm, line, 0)[0];
		var centerpath2 = centerpath;
		var clk = linesx[1];

		if (!(sty.greentravel || sty.domarking || sty.dovcarve || sty.greenskip || sty.doengrave || sty.dopocket) && (lenmm > (clk ? 200 : 50) && getchecked("usefinish"))) ofs1 = getnumber('finishline');
		if (ofs1 > 0) {
			lines2 = prepare_line2(lenmm, line, ofs1);
			var lines = lines2[0];
			clk = lines2[1];
		} else lines = [];
		if (lines.length == 0) {
			ofs1 = 0;
			lines = linesx;
			centerpath = centerpath2;
		}

		if (sty.greenskip) area += 500000;
		sty.subchilds = lines.length - 1;
		var ii = (ofs1 ? 1 : 0);
		for (var i = 0; i < lines.length; i++) {
			var line1 = lines[i];
			var ar = area;
			if (i > 0) ar = 1;
			var x1 = line1[0][1];
			var y1 = line1[0][2];

			gcodes.push([lenmm, ofs1 ? "D" : "", x1, y1, lines[i], srl, ar, closed, shapenum, [cuttab_manual[i], starttab_manual[i]], ii, centerpath[i]]);
			ii++;
		}
		var nc = lines.length - 1;
		if (ofs1) {
			sty.subchilds += linesx.length;
			for (var i = 0; i < linesx.length; i++) {
				var line1 = linesx[i];
				var ar = area;
				if (i > 0) ar = 1;
				var x1 = line1[0][1];
				var y1 = line1[0][2];
				gcodes.push([lenmm, "F", x1, y1, linesx[i], srl, ar + 1000, closed, shapenum, [cuttab_manual[i], starttab_manual[i]], i, centerpath2[i]]);
			}
			nc += linesx.length;
		}
		for (var pi in parent) {
			gcstyle[parent[pi]].exchilds += nc;
		}
		if (nc < 0) warningpath -= nc;
	} else {
		xct = 0;
		yct = 0;
		for (var i = 0; i < line.length; i++) {
			xct += line[i][1];
			yct += line[i][2];
		}
		gcodes.push([lenmm, "", X1, Y1, line, srl, area, closed, shapenum, [], 0, [xct / line.length, yct / line.length]]);
	}
	// Capture the pristine per-shape child count so that a repeated sort-only
	// refresh can restore the decrements made by the sorting scan.
	sty.osubchilds = sty.subchilds;
	shapenum++;
}

function gcodepushcombined() {
	var f2 = "F" + (getvalue('feed') * 60) + " ";
	var X1;
	var Y1;
	var ox;
	var oy;
	var scale = 1000;
	var s = 0;
	var ds = 0;
	var cx = 0;
	var cy = 0;
	for (var ni = 0; ni < 2; ni++) {
		var cpr = new ClipperLib.Clipper();
		var pp = [];
		for (var j = 0; j < combinedpath.length; j++) {
			if (combinedpath[j][1] == (ni == 1)) continue;
			pp.push(combinedpath[j][0]);
		}
		cpr.AddPaths(pp, ClipperLib.PolyType.ptSubject, true);
		var solution_paths = [];
		var glines = [];
		var succeeded = cpr.Execute(ClipperLib.ClipType.ctUnion, solution_paths, 1, 1);
		if (!succeeded) continue;
		shapenum++;
		for (var i = 0; i < solution_paths.length; i++) {
			var newline = [];
			var path = solution_paths[i];
			if (path.length) {
				for (var j = 0; j < path.length; j++) {
					var jj = j;
					var l = path[jj];
					x = l.X * 1.0 / scale;
					y = l.Y * 1.0 / scale;
					if (j > 0) {
						ds = sqrt(sqr(x - ox) + sqr(y - oy));
					}
					s += ds;
					ox = x;
					oy = y;
					newline.push([f2, x, y, s, ds]);
					cx += x;
					cy += y;
				}
				if (solution_paths.length) {
					cx /= solution_paths.length;
					cy /= solution_paths.length;
				}
				var l = path[0];
				x = l.X * 1.0 / scale;
				y = l.Y * 1.0 / scale;
				if (i == 0) {
					X1 = x;
					Y1 = y;
				}
				newline.push([f2, x, y, s, ds]);
				glines.push([newline, cx, cy]);

			}
		}
		for (var i = 0; i < glines.length; i++) {
			var line1 = glines[i];
			gcodes.push([s, "", X1, Y1, line1[0],
				[], 1, 1, shapenum, [], 0
				, [line1[1], line1[2]]]);
		}
		gcstyle[shapenum] = ni == 0 ? carvestyIn : carvestyOut;
	}
}

// ------------------------------------------------------------------------
// Cut Position Calculation
// ------------------------------------------------------------------------

function getcutpos(index, shift, flip) {
	if (cachedcutpos[index] == undefined) {
		var rcutpos = sgcodes[index][0][9][0];
		if (rcutpos == undefined) rcutpos = [];
		lines = sgcodes[index][0][4];
		var climb = flip;
		if (getchecked("cutclimb")) climb = !climb;
		if (getchecked("flipx")) climb = !climb;
		var lshift = 0;
		var len = 0;
		var sharps = [];
		var cosd = 1 + Math.cos(165 * Math.PI / 180);

		for (var ci = 0; ci < lines.length; ci++) {
			if (climb) {
				i = (lines.length - 0) - ci;
			} else {
				i = ci;
			}
			while (i >= lines.length) {
				i -= lines.length;
			}
			len += lines[i][4];
			pi = i + (climb ? 1 : 0);
			if (pi >= lines.length) pi -= lines.length;
			pdis = lines[pi][4];
			if ((i <= shift)) lshift += pdis;

			var cksharp = sharp(lines, 1, 2, i);
			// Titik loop dogbone bezier bukan sudut asli. Abaikan saat menyusun
			// daftar "hindari tab" supaya aturan slc = sharps[i] + 15 tidak
			// menggeser auto tab berkali-kali mengikuti titik-titik loop.
			// Sudut aslinya tetap ditandai _dogboneCorner di prepare_line2.
			if (!lines[i]._dogboneLoop &&
				(lines[i]._dogboneCorner || Math.abs(1 + cksharp) > cosd)) sharps.push(len);

		}

		if (rcutpos.length == 0) {
			if (len < Math.min(50, cutevery * 2)) cuttabz = 0;
			var lenc = 0;

			dv = Math.min(cutmax, Math.round(len / cutevery));
			if (dv < 2) dv = 0;
			if (dv > 8) dv = 4;
			lc = len / dv;
			rcutpos = [];
			for (var k = 0; k < dv; k++) {
				slc = lc * 0.5 + k * lc;
				for (var i = 0; i < sharps.length; i++) {
					if (Math.abs(sharps[i] - slc) < 15) slc = sharps[i] + 15;
				}
				rcutpos.push(slc);
			}
		}

		var cutpos = [];
		for (var k = 0; k < rcutpos.length; k++) {
			var p = rcutpos[k] - lshift;
			if (p < 0) p = len + p;
			if (climb) p = len - p;
			cutpos.push(Math.max(Math.min(p - cuttablen / 2, len - cuttablen / 2), cuttablen / 2));
		}

		nsort = function (a, b) {
			return (a * 1 - b * 1);
		};

		cachedcutpos[index] = cutpos.sort(nsort);
	}
	return cachedcutpos[index];
}
// ============================================================================
// SECTION: Path Processing and Offset
// ============================================================================

// ------------------------------------------------------------------------
// Main Path Preparation Function
// ------------------------------------------------------------------------

function prepare_line2(lenmm, lines, ofs1) {
	cuttab_manual = [];
	starttab_manual = [];
	centerpath = [];
	var detail = getnumber("curveseg") * 0.2;
	var ovmore = getnumber("ovcmore");
	var f2 = "F" + (getnumber('feed') * 60) + " ";
	var ofs = getoffset() + ofs1;
	var sty = gcstyle[shapenum];
	oshapenum = shapenum;
	if (sty == undefined) sty = defaultsty;
	if (getchecked("strokeoffset")) ofs += sty["stroke-width"] * 1;

	if (sty.dopocket || sty.dovcarve) ofs = 0;
	ofs *= 0.5;
	maxofs = Math.max(ofs, maxofs);
	collapsepoint = cmd == CMD_CNC ? getnumber("drill") : 0;
	dodrill = getchecked("dodrill");
	noprocess = getnumber("overcutmin");
	shapectr++;
	var newlines = [];
	srl = [];
	lx = 0;
	ly = 0;
	sty.isPoint = 0;

	if ((cmd == CMD_CNC) && (lenmm < collapsepoint)) {
		if (dodrill) {
			var sx = 0;
			var sy = 0;
			for (var i = 0; i < lines.length; i++) {
				sx += lines[i][1];
				sy += lines[i][2];
			}
			sx /= lines.length;
			sy /= lines.length;
			newlines.push([
				[lines[0][0], sx, sy, 0, 0]
			]);
			sty.isPoint = 1;
			centerpath.push([sx, sy]);
		}
		return [newlines, false];
	} else {
		var glines = [];
		var clk = isClockwise(lines);
		if (1) {
			var path = [];
			var paths = [];
			var scale = 1000;
			var S = 0;
			for (var i = -1; i < lines.length; i++) {
				var l = lines[i < 0 ? lines.length - 1 : i];
				var D = 0;
				if (i >= 0) S += (D = sqrt(sqr(l[1] - x) + sqr(l[2] - y)));
				x = l[1];
				y = l[2];
				if (i >= 0 && D > 0.01) {
					path.push({
						X: x * scale,
						Y: y * scale
					});
				}
			}
			sty.S0 = S;
			paths.push(path);

			var co = new ClipperLib.ClipperOffset();
			var offsetted_paths = new ClipperLib.Paths();
			co.Clear();

			co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
			co.MiterLimit = 2;
			co.ArcTolerance = (sty.dovcarve ? 0.01 : 0.02) * scale;
			var delta = ofs * scale;
			if (!clk) delta = -delta;
			co.Execute(offsetted_paths, delta);
			var s = 0;
			var S = 0;
			var ds = 0;
			var ox = 0;
			var oy = 0;
			for (var i = 0; i < offsetted_paths.length; i++) {
				var newline = [];
				var path = offsetted_paths[i];
				// var path = ClipperLib.JS.Lighten(offsetted_paths[i], detail * scale);
				if (sty.dovcarve) {
					combinedpath.push([path, clk]);
				} else {
					if (path.length) {
						s = 0;
						var cuts = [];
						var starts = [];
						cenx = 0;
						ceny = 0;
						var cektab = (lenmm >= getnumber("tabevery"));
						for (var j = 0; j <= path.length; j++) {
							var jj = j;
							if (jj == path.length) jj = 0;
							if (clk) jj = path.length - 1 - jj;
							var l = path[jj];
							x = l.X * 1.0 / scale;
							y = l.Y * 1.0 / scale;

							if (j > 0) {
								ds = sqrt(sqr(x - ox) + sqr(y - oy));
								if (cektab) {
									// Spatial-hash lookup: expanding-ring query around
									// the edge midpoint (mx, my). Cell size is 1.0
									// and the ring expands until all tabs are
									// covered, preserving the original "test all
									// tabs against all edges" semantic.
									var _mx = (ox + x) * 0.5;
									var _my = (oy + y) * 0.5;
									// if (cuttabGrid) {
									// 	var _cands = gridQueryRing(cuttabGrid, _mx, _my, cuttabs.length);
									// 	for (var _ci = 0; _ci < _cands.length; _ci++) {
									// 		var k = _cands[_ci];
									// 		var p1 = cuttabs[k][0];
									// 		var p2 = cuttabs[k][1];
									// 		var si = intersects_p(p1[0], p1[1], p2[0], p2[1], ox, oy, x, y);
									// 		if (si != null) {
									// 			si = s + ds * (si);
									// 			console.log("Intersect at" + (si));
									// 			cuts.push(si);
									// 		}
									// 	}
									// } else 
									{
										for (var k = 0; k < cuttabs.length; k++) {
											var p1 = cuttabs[k][0];
											var p2 = cuttabs[k][1];
											var si = intersects_p(p1[0], p1[1], p2[0], p2[1], ox, oy, x, y);
											if (si != null) {
												si = s + ds * (si);
												console.log("Intersect at" + (si));
												cuts.push(si);
											}
										}
									}
									// if (starttabGrid) {
									// 	var _cands2 = gridQueryRing(starttabGrid, _mx, _my, starttabs.length);
									// 	for (var _ci2 = 0; _ci2 < _cands2.length; _ci2++) {
									// 		var k = _cands2[_ci2];
									// 		var p1 = starttabs[k][0];
									// 		var p2 = starttabs[k][1];
									// 		var si = intersects_p(p1[0], p1[1], p2[0], p2[1], ox, oy, x, y);
									// 		if (si != null) {
									// 			si = s + ds * (si);
									// 			console.log("Intersect at" + (si));
									// 			starts.push(si);
									// 		}
									// 	}
									// } else {
									// 	for (var k = 0; k < starttabs.length; k++) {
									// 		var p1 = starttabs[k][0];
									// 		var p2 = starttabs[k][1];
									// 		var si = intersects_p(p1[0], p1[1], p2[0], p2[1], ox, oy, x, y);
									// 		if (si != null) {
									// 			si = s + ds * (si);
									// 			console.log("Intersect at" + (si));
									// 			starts.push(si);
									// 		}
									// 	}
									// }
								}

							}
							s += ds;
							cenx += x;
							ceny += y;
							ox = x;
							oy = y;
							newline.push([f2, x, y, s, ds]);
						}
						S += s;
						centerpath.push([cenx / path.length, ceny / path.length]);
						glines.push(newline);
						cuttab_manual.push(cuts);
						starttab_manual.push(starts);
					}
				}
			}
			sty.S1 = S;
			if (ofs > 0) oldlines.push([lines, sty.num])
		} else {
			glines.push(lines);
		}
		if (sty.dovcarve) {
			return [newlines, clk];
		}
		if ((disable_ovc.indexOf(shapectr + "") >= 0) || (lenmm < noprocess)) return [glines, clk];
		sharpv = getnumber("sharp");
		ov = 0.01;
		var dogboneMode = typeof getDogboneMode === "function" ? getDogboneMode() : (getchecked("overcut") ? "line" : "none");
		var dogbone = dogboneMode !== "none";
		var isnotcutting = (sty.greenskip || sty.doEngrave || sty.dovcarve || sty.dopocket || sty.domarking) ||
			(!sty.isblack);
		if (getchecked("overcut2") && sty.domarking) isnotcutting = false;
		var ro = 0;
		if ((cmd == CMD_CNC) && dogbone && !isnotcutting) {
			ro = $("offset").value / 2;
			ov += (sqrt(2 * sqr(ro)) - ro) + ovmore;
		}
		cxt = 0;
		cyt = 0;
		cnt = 0;
		var tl = 0;
		for (var j = 0; j < glines.length; j++) {
			var gline = glines[j];
			var newline = [];
			var addBefore = [];
			var dogboneAdd = 0;
			for (var i = 0; i < gline.length; i++) {

				addBefore[i] = dogboneAdd;

				tl2 = gline[i][4];
				if (i < gline.length - 1)
					tl += tl2;
				x = gline[i][1];
				y = gline[i][2];
				cxt += x;
				cyt += y;
				cnt += 1.0;

				// Lewatkan i == 0 agar tidak menyisipkan dogbone prematur pada titik plunge awal.
				// Sudut penutup diproses saat kontur kembali menutup di i == gline.length - 1.
				if (dogbone && i > 0) {
					sr = sharp(gline, 1, 2, i);
					if ((sr > sharpv) && (cross < 0)) {
						newline.push(gline[i]);
						if (dogboneMode === "bezier") {
							// Tandai sudut asli agar getcutpos tetap menganggapnya
							// "sharp" walaupun geometri gabungan (loop kembali ke
							// sudut) terlihat lurus.
							gline[i]._dogboneCorner = true;
							var loopPts = generateBezierDogboneLoop(gline[i], vec1, vec2, ro, ovmore, 8);
							for (var lp = 0; lp < loopPts.length; lp++) {
								loopPts[lp]._dogboneLoop = true;
								newline.push(loopPts[lp]);
								dogboneAdd += loopPts[lp][4];
							}
							var midPt = loopPts.length ? loopPts[Math.floor(loopPts.length / 2)] : gline[i];
							srl.push([x, y, sr, tl, i, [midPt[1], midPt[2]], cross, cxt / cnt, cyt / cnt]);
						} else {
							ox = overcut[0] * ov;
							oy = overcut[1] * ov;
							if ((OVC_MODE == 0) && ((ox != 0) || (oy != 0))) {
								newline.push([gline[i][0], x - ox, y - oy, tl, 0]);
								newline.push([gline[i][0], x, y, tl, 0]);
							}
							srl.push([x, y, sr, tl, i, [x - ox, y - oy], cross, cxt / cnt, cyt / cnt]);
						}
						cxt = 0;
						cyt = 0;
						cnt = 0;
						lx = x;
						ly = y;
					} else newline.push(gline[i]);
				} else newline.push(gline[i]);
			}
			// Tab manual diukur pada path offset sebelum dogbone. Geser ke
			// panjang busur path setelah dogbone supaya penempatannya tidak
			// mundur sebesar panjang loop bezier yang sudah dilewati.
			if (dogboneAdd > 0) {
				remapTabLengths(cuttab_manual[j], gline, addBefore);
				remapTabLengths(starttab_manual[j], gline, addBefore);
			}
			newlines.push(newline);
		}
		return [newlines, clk];
	}
}
// ============================================================================
// SECTION: Engraving System
// ============================================================================

// ------------------------------------------------------------------------
// Engrave Drawing Function
// ------------------------------------------------------------------------
function drawengrave() {
	//	if (cmd!=CMD_LASER)return;
	if (!getchecked("enableraster")) return;
	var c = $("myCanvas1");
	var ctx = c.getContext("2d");
	ctx.setLineDash([]);
	ctx.lineWidth = 0.25;
	$("ystep").innerHTML = mround(25.41 / engraveDPI) + "mm";
	for (var i = 0; i < engrave1.length; i++) {
		var e = engrave1[i];
		ctx.beginPath();
		if (e[4] * 1 > 0) {
			var c = parseInt(255 - e[4]).toString(16);
			if (c.length == 1) c = "0" + c;
			ctx.strokeStyle = "#" + c + c + c;
		} else ctx.strokeStyle = "#0000ff";
		ctx.moveTo((e[0] + maxofs) * dpm, (e[1] + maxofs) * dpm);
		ctx.lineTo((e[2] + maxofs) * dpm, (e[3] + maxofs) * dpm);
		ctx.stroke();

	}
}

// ------------------------------------------------------------------------
// Main Engrave Processing Function
// ------------------------------------------------------------------------

function doengrave() {
	if (ENGRAVE == 0) engrave1 = [];
	if (!getchecked("enableraster")) return;
	if (!Object.keys(engrave).length) return;
	var c = $("myCanvas1");
	var ctx = c.getContext("2d");
	var ofs = getoffset();
	carvedeep = getnumber('carved');
	var f2 = getnumber('rasterfeed') * 60;
	var pw = getnumber('rasterpw') * 0.01 * 255;
	var cpwd = " S" + pw;
	var f1 = f2;
	if (cmd == CMD_CNC) {
		f2 = getnumber('rasterfeed') * 60;
		var f1 = speedtravel * 60;
	}
	var pup = "";
	if (cmd == CMD_CNC) pup = "G0 Z" + getnumber('safez') + "\n";
	var pdn = getvalue('pdn') + "\n";
	var overs = getnumber('overshoot');
	var grayInvert = getchecked('grayinvert');
	var skiplen = 0;
	if (cmd == CMD_CNC) overs = 0;
	if (getchecked("enablesmartraster")) skiplen = getnumber('skiplength');
	nsortx = function (a, b) {
		return (a[0] * 1 - b[0] * 1);
	};
	msortx = function (a, b) {
		return (b[0] * 1 - a[0] * 1);
	};
	nsort = function (a, b) {
		return (a * 1 - b * 1);
	};
	msort = function (a, b) {
		return (b * 1 - a * 1);
	};

	var re = Math.ceil(getnumber("carved") / getnumber("carvedp"));
	var rep1 = Math.ceil(getnumber("carved") / getnumber("firstd"));
	if (cmd == CMD_LASER) re = rep1 = 1;
	carvedeep = getnumber("carved");
	var rz = carvedeep / re;
	gc = "";
	var beforecut_p = getchecked("carvepause") && (cmd != CMD_LASER) ? "G0 Z0\nM3 S" + pw + " P10000\n" : "";
	for (ang in engrave) {
		aengrave = engrave[ang];
		if (cmd == CMD_LASER) {
			setup_rotate(ang);
			var pwa = ((ang >> 4) & 15) * 17;
			if (grayInvert) pwa = 255 - pwa;
			if (!pwa) pwa = pw;
		} else {
			setup_rotate(0);
			pwa = pw;
			if (ang) carvedeep = ang * 0.1;
		}
		rz = carvedeep / re;
		gc += M3 + " S" + pwa + "\nG0 F" + f1 + "\nG1 F" + f2 + "\n";
		gc += pup;
		var ry = Object.keys(aengrave).sort(nsort);
		if (ry.length == 0) {
			continue;
		}
		var lry = -10000;
		ri = -1;
		var engr;
		var lengr;

		drwR = 0.2;
		var c1 = getchecked("rasteroutline");
		var dir = 1;
		var run = 1;
		var tx = 0;
		var skipx = 0;
		var maxrun = 10;

		for (var fi = 0; fi < ry.length; fi++) {
			var y = ry[fi];
			engr = aengrave[y];
			var pdata = engr.sort(nsortx);
			var cstack = [pdata[0][1]];
			var rdata = [];
			var pp = pdata.length / 2 - 1;
			var v3 = null;
			for (fj = 0; fj <= pp; fj++) {
				var v1 = pdata[fj * 2];
				var v2 = pdata[fj * 2 + 1];
				if (v1[1] == v2[1]) {
					rdata.push(v1);
					rdata.push(v2);
					v3 = null;
				} else {
					if (fj < pp) {
						v3 = pdata[fj * 2 + 2];
						rdata.push(v1);
						var xb = v3[0];
						v3[1] = v2[1];
						v2[1] = v1[1];
						rdata.push([v2[0], v2[1]]);
					} else {
						rdata.push([v1[0], v2[1]]);
						rdata.push(v2);
					}
				}
			}
			aengrave[y] = rdata;
		}
		var lpw = "";
		var tlx = 1000;
		var tly = 1000;
		var lsofs = getnumber("laserofs") * 0.5;
		var pass = 0;
		var bidir = (getchecked("engrave_y_bidirectional"));
		if (!bidir) dir = !dir;
		while (run && maxrun) {
			run = 0;
			maxrun--;
			if (bidir) dir = !dir;
			// dir = !dir;
			// skipx = 0;
			var first = 1;
			first = 1;
			for (var fi = 0; fi < ry.length; fi++) {
				var i = fi;
				if (dir) i = ry.length - 1 - i;
				var _rz = rz;
				var _re = re;
				if (i == 0) {
					_re = rep1;
					_rz = carvedeep / _re;
				}
				if (cmd == CMD_LASER) _re = 1;
				var z = 0;
				var y = ry[i];
				engr = aengrave[y];
				if (engr.length == 0) continue;
				first = 1;
				skipx = 0;
				var slowdown = 0;
				var slowx = [];

				// if ((cmd == CMD_CNC) && (i > 1)) {
				// 	var temp = [];
				// 	for (var c = 0; c < engr.length; c++) {
				// 		temp.push([engr[c], 0]);
				// 	}
				// 	for (var c = 0; c < lengr.length; c++) {
				// 		temp.push([lengr[c], 1]);
				// 	}
				// 	temp = temp.sort(nsortx);
				// 	var lc = [0, 0];

				// 	for (var c = 0; c < temp.length - 2; c++) {
				// 		var t = temp[c];
				// 		lc[t[1]] = !lc[t[1]];
				// 		if (c > 1 && t[1] && lc[0] && !lc[1] && (Math.abs(t[0] - temp[c + 1][0]) > 5)) {
				// 			slowdown = 1;
				// 			break;
				// 		}
				// 	}
				// }
				var ctxstrokeStyle;
				if (slowdown) {
					gc += ";Y:" + mround2(y) + " Slowdown .. \nG1 F" + (f2 * 0.5) + "\n";
					ctxstrokeStyle = "#ff0000";
				} else {
					ctxstrokeStyle = "#0000ff";
				}
				lengr = engr;
				var ogy = (y * 25.41 / engraveDPI);
				lx = -100;
				if (cmd == CMD_LASER) gc += pup;
				var ashift = 0;
				var pdata = engr.sort(nsortx);

				var dx = (cmd == CMD_LASER) ? 0 : ox;
				dx = 0;
				var rdata = [];
				pp = pdata.length / 2 - 1;
				for (var j = 0; j <= pp; j++) {
					var p1 = pdata[j * 2 + 1];

					var p2 = pdata[j * 2];
					ox = p1[0] * 1 + dx;
					fx = p2[0] * 1 - dx;
					ashift = j * 2 + 2;

					if (skiplen > 0 && Math.abs(ox - skipx) > skiplen) {
						pass++;
						if (!first) {
							ashift -= 2;
							run = 1;
							break;
						}
					}
					rdata.push([ox, p1[1]]);
					rdata.push([fx, p2[1]]);
					skipx = ox;
					first = 0;
				}
				if (rdata.length > 0) {
					pdata.splice(0, ashift);
					aengrave[y] = pdata;
					var ooox1 = 0;
					for (var r = 0; r < _re; r++) {
						ri++;
						var ofsx = 0;
						rdata.sort(ri & 1 ? msortx : nsortx);
						tx = rdata[0][0];


						var ox = tx + (((ri) & 1) ? overs : -overs);
						oox = ox;

						var xy0 = rotateclimb(0, 0, ox, ogy);

						gy = xy0[1];
						ox = xy0[0];
						var dd = sqrt(sqr(ox - tlx) + sqr(gy - tly)) > (ofs * 2);
						if (dd) gc += pup;
						gc += (dd ? "G0" : "G1") + " Y" + mround2(gy) + " X" + mround2(ox) + "\n";
						if (dd) {
							gc += beforecut_p; beforecut_p = "";
						}
						var drw = 1;
						if (drw) lry = gy;
						var xy1 = rotateclimb(0, 0, rdata[0][0], ogy);

						xmin = Math.min(xmin, xy1[0]);
						xmax = Math.max(xmax, xy1[0]);
						ymin = Math.min(ymin, xy1[1]);
						ymax = Math.max(ymax, xy1[1]);
						z -= _rz;

						pp = rdata.length / 2 - 1;
						var xy2;
						var oox1;
						var LY = -10000;
						var LPW = -100;
						for (var j = 0; j <= pp; j++) {
							oox1 = rdata[j * 2 + 1][0] * 1 + ofsx;
							oox2 = rdata[j * 2][0] * 1 + ofsx;
							cpw = parseInt(rdata[j * 2][1] * pw / 255);
							if (cpw > 0)
								cpw = " S" + cpw;
							else
								cpw = cpwd;

							if (lpw == cpw)
								cpw = "";
							else
								lpw = cpw;

							if (lsofs > 0 && cmd == CMD_LASER) {
								lso = Math.min(lsofs, Math.abs(oox2 - ooox1) * 0.8);
								if (oox2 <= oox1) oox2 -= lso; else oox2 += lso;
							}
							ooox1 = oox1;
							xy1 = rotateclimb(0, 0, oox1, ogy);
							xy2 = rotateclimb(0, 0, oox2, ogy);
							ox = xy1[0];
							fx = xy2[0];
							if (cmd == CMD_LASER) {
								gc += "G0 X" + mround2(fx);
								if (LY != xy2[1]) gc += " Y" + mround2(xy2[1]);
								LY = xy2[1];
								if (cpw && LPW != cpw) {
									gc += "\nM3 " + cpw + "\n";
									LPW = cpw;
								}
								gc += "\nG1 X" + mround2(ox);
								if (LY != xy1[1]) gc += " Y" + mround2(xy1[1]);
								gc += "\n";
								LY = xy1[1];


							} else {
								if (Math.abs(ox - fx) >= ofs) {
									gc += "G0 X" + mround(fx) + " Y" + mround(xy2[1]) + "\n";
									if (j) gc += "G0 Z0 F" + speedretract + "\n";
									gc += "G1 Z" + mround(z) + "\n";
									gc += "G1 X" + mround(ox) + " Y" + mround(xy1[1]) + "\n";
									tlx = ox;
									tly = xy1[1];
									if (j < pp) gc += pup;
									engravetime += 0.8 * Math.abs(ox - fx) / (f2 * 0.0167);
								}
							}
							if (drw && !r) {
								engrave1.push([fx, xy2[1], ox, xy1[1], rdata[j * 2][1], ctxstrokeStyle]);
							}

						}
						xmin = Math.min(xmin, ox);
						xmax = Math.max(xmax, ox);
						if (cmd == CMD_LASER) {
							ox = oox1 + (((ri) & 1) ? -overs : overs);
							xy1 = rotateclimb(0, 0, ox, ogy);

							gc += "G0 X" + mround2(xy1[0]);
							if (LY != xy1[1]) gc += " Y" + mround2(xy1[1]);
							gc += "\n";
							engravetime += 1.3 * Math.sqrt(sqr(xy0[0] - xy1[0]) + sqr(xy0[1] - xy1[1])) / (f2 * 0.0167);
						} else {
							ox = oox1;
						}
					}
					if (slowdown) gc += "G1 F" + (f2) + "\n";
				}
			}
		}
		if (cmd == CMD_LASER) gc += pup + "\n";
	}
	gc += pup + "\n";
	gc = getvalue("engcode") + gc;
	setvalue("engcode", gc);
}

// ------------------------------------------------------------------------
// Engrave Data Management
// ------------------------------------------------------------------------

function addengrave(ang, pw, cx, cy) {
	if (engrave[ang] == undefined) engrave[ang] = {};
	if (engrave[ang][cy] == undefined) engrave[ang][cy] = [];
	engrave[ang][cy].push([cx, pw]);
}

function newengraveline(x1, y1, x2, y2, half) {
	xy1 = rotateCW(0, 0, x1, y1);
	xy2 = rotateCW(0, 0, x2, y2);
	x1 = xy1[0];
	y1 = xy1[1];
	x2 = xy2[0];
	y2 = xy2[1];


	if (!getchecked("enableraster")) return;
	if (y2 < y1) {
		x3 = x1;
		x1 = x2;
		x2 = x3;

		y3 = y1;
		y1 = y2;
		y2 = y3;

	}
	var dy = y2 - y1;
	if (dy == 0) return;
	var dx = x2 - x1;
	var ratio = engraveDPI / 25.41;
	var ratiox = ratio * 8;
	// Half-open [y1, y2): vertex yang jatuh tepat di baris scanline hanya
	// dihitung oleh edge yang MULAI dari vertex itu (ceil y1), tidak oleh
	// edge yang SELESAI di vertex (lama: floor y2 -> vertex silang dihitung
	// 2x -> jumlah crossing ganjil -> pairing raster geser / off jadi on).
	var sy1 = Math.ceil(y1 * ratio);
	var sy2 = Math.ceil(y2 * ratio) - 1;
	var ts = (sy2 - sy1) + 1;
	if (ts > 0) {
		cy = sy1;
		var srx = 1 / ratiox;
		var sr = 1 / ratio;
		var r = dx / dy;
		sx1 = (x1 + (sy1 * sr - y1) * r) * ratiox;
		sx2 = (x1 + (sy2 * sr - y1) * r) * ratiox;
		sdx = sx2 - sx1;
		sx = ts > 1 ? sdx / (ts - 1) : 0;
		for (var i = 0; i < ts; i++) {
			if (!half || (half && ((cy & 1) == 0))) addengrave(eangle, currPw, Math.floor(sx1) * srx, cy);
			sx1 += sx;
			cy += 1;
		}
	}
}
var engraveline = newengraveline;
// ============================================================================
// SECTION: Drawing and Visualization
// ============================================================================

// ------------------------------------------------------------------------
// Lead Drawing Function
// ------------------------------------------------------------------------

function draw_leads() {
	var cw = $("myCanvas1").width - 70;
	var ch = $("myCanvas1").height - 70;
	dpm = cw / (sxmax + maxofs * 2);
	dpm = Math.min(dpm, ch / (symax + maxofs * 2));
	var x = lx / dpm;
	var y = ly / dpm;
	var c = $("myCanvas1");
	var ctx = c.getContext("2d");
	ctx.font = "8px Arial";

	ctx.beginPath();
	ctx.setLineDash([]);
	ctx.strokeStyle = "blue";
	for (var i = 0; i < leads.length; i++) {
		var l = leads[i];
		ctx.moveTo((l[0] + maxofs) * dpm, (l[1] + maxofs) * dpm);
		ctx.lineTo((l[2] + maxofs) * dpm, (l[3] + maxofs) * dpm);
		if (l[4]) ctx.lineTo((l[4] + maxofs) * dpm, (l[5] + maxofs) * dpm);

	}
	ctx.stroke();
}

// ------------------------------------------------------------------------
// Main Line Drawing Function
// ------------------------------------------------------------------------

function draw_line(num, lcol, lines, srl, dash, len, closed, snum, flip, shift, warn, cutpos) {
	cuttabz = getnumber("tabc");

	var olx = lx;
	var oly = ly;
	if (shift == undefined) shift = 0;
	var dline = [];
	engraveDPI = getnumber("rasterdpi");
	var sty = gcstyle[snum];
	setup_rotate(cmd == CMD_LASER ? sty.angle : 0);
	eangle = sty.angle;
	var stu = sty == undefined;
	if (stu) sty = defaultsty;
	if (warn) {
		warn = (sty.S1 <= 0 || (sty.S1 / sty.S0 < 0.5));
		if (warn) {
			lcol = "#FF0000";
			warningpath++;
		}
		sty = defaultsty;
	}
	var isnotcutting = (sty.greenskip || sty.doEngrave || sty.dovcarve || sty.dopocket || sty.domarking) ||
		(!sty.isblack);
	if (getchecked("overcut2") && sty.domarking) isnotcutting = false;
	if (sty.greenskip || sty.doEngrave || sty.dovcarve || sty.dopocket || (!closed)) {
		stu = 1;
		cuttabz = 0;
	}

	plt = (getchecked("pltmode"));

	var cutindex = 0;
	slc = cutpos[cutindex];

	var ofs = getoffset();
	var cw = $("myCanvas1").width - 70;
	var ch = $("myCanvas1").height - 70;
	dpm = cw / (sxmax + maxofs * 2);
	dpm = Math.min(dpm, ch / (symax + maxofs * 2));
	var x = lx / dpm;
	var y = ly / dpm;
	var cxmin = 100000;
	var cymin = 100000;
	var cxmax = 0;
	var cymax = 0;
	var n = 0;
	var sc = 1;

	var climb = flip;
	if (getchecked("cutclimb")) climb = !climb;
	if (getchecked("flipx")) {
		climb = !climb;
		sc = -1;
	}

	var ro = getchecked("rotate") ? -1 : 1;
	var c = $("myCanvas1");
	var ctx = c.getContext("2d");
	ctx.font = "8px Arial";

	// Apply stroke width setting
	var strokeWidth = getnumber("strokewidth");
	if (strokeWidth <= 0) strokeWidth = 1;
	var scale = (window.myCanvas1 && window.myCanvas1._scale) ? window.myCanvas1._scale : 1;
	ctx.lineWidth = strokeWidth / scale; // Adjust for zoom level to keep consistent visual width

	var g = 0;
	var X1 = 0;
	var Y1 = 0;

	tl = 0;

	seg = getchecked("segment");

	start = 0;
	sharpv = getnumber("sharp");

	ov = 0;
	var dogboneMode = typeof getDogboneMode === "function" ? getDogboneMode() : (getchecked("overcut") ? "line" : "none");
	if ((cmd == CMD_CNC) && (dogboneMode !== "none") && !isnotcutting) {
		var rr = $("offset").value / 2;
		ov = sqrt(2 * sqr(rr)) - rr;
	}
	lsx = -10;
	lsy = 0;
	var i = 0;
	var incut = 0;
	var lenctr = 0;
	var iscut = 0;
	ctx.beginPath();
	if (firstline) {
		firstline = 0;
		var ss = getvalue("startat").split(",");
		lx = ss[0] * 1;
		ly = ss[1] * 1;

		lx = (lx + maxofs) * dpm;
		ly = (ly + maxofs) * dpm;
		ctx.setLineDash([]);
		ctx.moveTo(lx - 15, ly);
		ctx.lineTo(lx + 15, ly);
		ctx.moveTo(lx, ly - 15);
		ctx.lineTo(lx, ly + 15);
		ctx.strokeStyle = "rgba(200,100,255,0.8)";
		ctx.stroke();
		ctx.strokeStyle = "rgba(200,200,100,0.8)";
	}
	ctx.setLineDash([]);
	ctx.moveTo(lx, ly);
	lx2 = lx;
	ly2 = ly;
	nc = 2;
	var pocketdeep = 0;

	var carvedeep = getnumber('carved');
	stro = sty["stroke"];
	fil = sty["stroke"];

	if (sty.dopocket) {
		pocketdeep = sty.strokedeep > 0 ? sty.strokedeep : carvedeep;
	}

	var orig = (lcol == "#0000CC88") || (lcol == "#CCCCCCCC");
	var cll = false;
	if (!orig) {
		if (closed) {
			cll = isClockwise(lines);
			if (!cll) lcol = "#00C800";
			else lcol = theme == 0 ? "#000000" : "#ee8888";
		} else {
			lcol = theme == 0 ? "#664400" : "#cc4400";
		}
		if (sty.dovcarve) lcol = "#00ffff";
		if (sty.dopocket) lcol = "#800080";
		if (sty.domarking) lcol = "#FF6666";
	}
	$("myCanvas1td").style.background = theme == 1 ? "#333333" : "#EEEEEE";
	$("myCanvas1td").style.color = theme == 1 ? "#FFFFFF" : "#000000";
	ox = 0;
	oy = 0;
	ll = lines.length;

	if (shift) ll++;

	var pdis = 0;
	var lenc = 0;
	pdis = 0;
	var tabin = getchecked("tabinside");
	for (var ci = -1; ci < ll; ci++) {

		i = getRealIndex(ci, lines.length, climb, shift, closed);

		x = lines[i][1];
		y = lines[i][2];
		if (sc == -1) {
			x = sxmax - x;
		}
		if (ro == -1) {
			xx = x;
			x = y;
			y = sxmax - xx;
		}

		if (ci < 0) {
			lx2 = x;
			ly2 = y;
			continue;
		}

		nlenctr = lenctr;

		pi = i + (climb ? 1 : 0);
		if (pi >= lines.length) pi -= lines.length;
		pdis = ci > 0 ? lines[pi][4] : 0;

		lenctr += pdis;
		// ci==0 & shift==0: segmen penutup traversal (titik terakhir -> titik
		// awal) tidak pernah terkompensasi oleh `if (shift) ll++`, sehingga
		// tepi itu hilang -> jumlah crossing per baris jadi ganjil -> pairing
		// raster bergeser (off jadi on). Wajib ikut diraster.
		if ((ci > 0 || shift == 0) && closed && sty.doEngrave) {
			engraveline(lx2, ly2, x, y, sty.halfDPI);
		}
		xmax = Math.max(xmax, x);
		ymax = Math.max(ymax, y);
		xmin = Math.min(xmin, x);
		ymin = Math.min(ymin, y);

		dline.push(x);
		dline.push(y);
		if (cmd == CMD_CNC) {
			if (tabin || cll) {
				iscut = 0;
				if (cuttabz) {
					if ((slc >= lenc) && (slc <= lenctr)) {
						iscut = 1;
						dx = x - lx2;
						dy = y - ly2;
						llen = lenctr - lenc;

						lcut = slc - lenctr;
						x = x + dx * (lcut / llen);
						y = y + dy * (lcut / llen);
						lenc = slc;

						if ((incut == 1)) {
							incut = 0;
							cutindex++;
							slc = cutpos[cutindex];
						} else {
							incut = 1;
							slc += cuttablen;
						}
					}
				}
			}
		}

		g = ci;
		if (g >= 0) {

			if (g > 0) ctx.strokeStyle = lcol;
			if (iscut) {
				if (incut == 1) {
				} else {
				}
				ci--;
				lenctr -= pdis;
			} else {
				lenc = lenctr;
			}

			cxmin = Math.min(cxmin, x);
			cymin = Math.min(cymin, y);
			cxmax = Math.max(cxmax, x);
			cymax = Math.max(cymax, y);
			lx = (x + maxofs) * dpm;
			ly = (y + maxofs) * dpm;

			ctx.lineTo(lx, ly);

			lx2 = x;
			ly2 = y;
			if (g == 0) {

				X1 = lx;
				Y1 = ly;
				if (!stu) {
					ctx.strokeStyle = "rgba(247, 225, 34, 0.79)";
					jmltravel += sqrt(sqr(olx - lx) + sqr(oly - ly)) / dpm;
					ctx.stroke();
				}
				ctx.beginPath();
				ctx.setLineDash(dash);
				ctx.moveTo(lx, ly);
			}
			if (iscut) {
				if (cuttabz) ctx.arc(lx, ly, 2, 0, 2 * Math.PI);
				nc += 2;
				ctx.moveTo(lx, ly);
			}
		}
	}

	if (closed && lines.length > 1) {
		ctx.lineTo(X1, Y1);
	}
	ctx.stroke();
	if (lines.length == 1) {
		ctx.strokeStyle = "#CC0088";
		var r = getnumber("offset") * dpm * 0.5;
		ctx.moveTo(lx + r, ly);
		ctx.arc(lx, ly, r, 0, 2 * Math.PI)

		ctx.stroke();
	}
	ctx.strokeStyle = "#FFFF00";

	d1 = sqrt(sqr(lx - X1) + sqr(ly - Y1)) / dpm;
	if (num == "") return;

	if (closed) {
		lx = X1;
		ly = Y1;
	}

	var fs = (13 * 1);
	ctx.font = fs + "px Arial";
	sg = "[#" + num + "] ";
	for (i = 0; i < srl.length; i++) {
		if (i) sg += ",";

		ctx.strokeStyle = "red";
		ctx.beginPath();
		oc = srl[i][5];
		sx = srl[i][0];
		sy = srl[i][1];
		if (sc == -1) {
			sx = sxmax - sx;
		}
		if (ro == -1) {
			xx = sx;
			sx = sy;
			sy = sxmax - xx;
		}
		sx *= dpm;
		sy *= dpm;
		if (srl[i][6] < 0) {
		}
		ctx.stroke();
		if (seg) {
			ctx.fillStyle = ctx.strokeStyle;
			ni = i + 1;
			if (ni >= srl.length) ni = 0;
			xt = srl[ni][0] * dpm;
			yt = srl[ni][1] * dpm;
			xt2 = srl[i][0] * dpm;
			yt2 = srl[i][1] * dpm;
			l = Math.round(10 * (srl[ni][3] - srl[i][3])) / 10.0;
			sg += l;
			if (l > 0.5) {
				ctx.beginPath();
				ctx.strokeStyle = "lime";
				ctx.fillStyle = ctx.strokeStyle;
				var xct = (xt + xt2) / 2 + Math.random() * 40;
				var yct = 0;
				var tt = 20;
				while (--tt > 0) {
					yct = (yt + yt2) / 2 + Math.random() * 40;
					if (Math.abs(yct - oyct) > (fs * 2)) break;
				}
				if (yct < 20) yct = 20;
				oyct = yct + fs;

				ctx.fillText(l, xct, yct);
				ctx.moveTo(xt, yt);
				ctx.lineTo(xct, yct);
				ctx.lineTo(xt2, yt2);
				ctx.stroke();
				ctx.beginPath();

				ctx.strokeStyle = theme == 0 ? "#000000" : "#cceeee";
				ctx.fillStyle = ctx.strokeStyle;
				ctx.fillText(l, xct - 1, yct - 1);

				ctx.stroke();

			}
		}
	}
	if (seg) $("segm").value += sg + "\n";

	ctx.fillStyle = "#000000";
	if (climb) {
		clw = ">";
		if (cll) clw = "<";
	} else {
		clw = "<";
		if (cll) clw = ">";
	}
	if (sty.dovcarve) veeline.push([dline, sty.flip]);
	if (sty.dopocket) conline.push([dline, pocketdeep]);
	if (sty.greenskip) {
		lx = olx;
		ly = oly;
	}
}
// ============================================================================
// SECTION: Main Processing Functions - Part A (lines2gcode)
// ============================================================================

function uptosafe(f) { }

function movetofast(x, y, f) { }

function lines2gcode(num, data, z, z2, cuttabz, srl, lastlayer = 0, firstlayer = 1, snum, f2, flip, shift, cutpos, penaway = 0) {
	if (lastlayer && laddz > 0) {
		z2 -= laddz;
		cuttabz -= laddz;
	}

	if (z2 > skipz) {
		lastz = z;
		return "";
	}
	if (cmd == CMD_LASER) {
		z = 0;
		z2 = 0;
	}
	var dz = z2 - z;
	var cll = false;
	fm = 0;
	var iscanresume = getchecked("canresume");
	var lines = data[4];
	if (lines.length == 0) return;
	var isnotpoint = lines.length > 1;
	var closed = data[7] && isnotpoint;

	var len = Math.abs(data[0]);
	var _ramp = _rampdown;
	if (!closed) _ramp = 0;
	if (_ramp) {
		dz = Math.min(z2 - z, -len * 0.3);
	} else {
		dz = 0;
		z = z2;
	}
	var climb = flip;
	if (getchecked("cutclimb")) climb = !climb;

	var cutindex = 0;
	slc = cutpos[cutindex];

	var p = getRealIndex(0, lines.length, climb, shift, closed);

	var X1 = lines[p][1];
	var Y1 = lines[p][2];
	var l1 = getvalue("leadin");

	var leadmm = parseFloat(l1[0]);
	var uselead = cmd == CMD_PLASMA && closed && getchecked("useleadin") && (leadmm < len);
	var cll = isClockwise(lines);
	if (uselead && firstlayer) {
		X0 = null;
		var dx = 0;
		var dy = 0;
		var pp = p;
		var d = 0;
		var ang1 = parseFloat(l1[1]) || 40;
		var ang2 = parseFloat(l1[2]);
		var p2 = sqr(leadmm);
		var nn = 10;
		X9 = null;
		while (d < p2) {
			pp--;
			nn--;
			if (!nn) break;
			if (pp < 0) {
				pp += lines.length;
			}
			var dx = lines[pp][1] - X1;
			var dy = lines[pp][2] - Y1;
			d = sqr(dx) + sqr(dy);
		}
		if (nn) {
			d = sqrt(d);
			dx /= d;
			dy /= d;
			var p = rotateV(0, 0, leadmm * dx, leadmm * dy, ang1);
			var dn = 5;
			var cin = 0;
			while (--dn) {
				X0 = p[0] * dn * 0.2 + X1;
				Y0 = p[1] * dn * 0.2 + Y1;
				if (cin) break;
				cin = isInside(X0, Y0, lines, 1) == (cll ? 0 : 1);
			}
			XLEAD = X0;
			YLEAD = Y0;
			if (ang2) {
				var p = rotateV(0, 0, leadmm * dx, leadmm * dy, ang2);
				var dn = 5;
				cin = 0;
				while (--dn) {
					X9 = p[0] * dn * 0.2 + X1;
					Y9 = p[1] * dn * 0.2 + Y1;
					if (cin) break;
					cin = isInside(X9, Y9, lines, 1) == (cll ? 0 : 1);
				}
			}
			leads.push([X0, Y0, X1, Y1, X9, Y9]);
		}
	}
	var sc = 1;
	if (getchecked("flipx")) {
		sc = -1;
		X1 = sxmax - X1;
		if (X0 != null) X0 = sxmax - X0;
		climb = !climb;
	}
	var ro = 1;
	if (getchecked("rotate")) {
		ro = -1;
		XX = X1;
		X1 = Y1;
		Y1 = sxmax - XX;
		if (X0 != null) {
			XX = X0;
			X1 = Y0;
			Y0 = sxmax - XX;
		}
	}
	drillf = 0;

	var edis = 0;
	if (!(lx === undefined)) {
		edis = sqrt(sqr(lx - X1) + sqr(ly - Y1));
	};

	var pw1 = 1;
	var pw2 = 0;
	var pup = getvalue("pup");
	if (fnl) pup = "G0 Z4\n";
	var pdn = getvalue('pdn');
	if (cmd == CMD_PLASMA || getchecked("spindleoff") || getchecked("pausecut")) {
		if (cmd == CMD_PLASMA) {
			z = -z;
			if (getchecked("usefakeinit")) pdn = "G0 Z-" + getvalue("fakeinit") + "\nG92 Z0\n";
			else pdn = "G0 Z0\n";
			if (getchecked("pausecut") && firstlayer) pdn += "M3 S0 P10000\n";
			pdn += "M3 S0 P100\n" + getspindleon() + "G1 Z" + mround(z);
			pup = getspindleoff() + pup;
		} else {
			pup = (hasfnl ? pup : getspindleoff()) + pup;
			pdn = (((firstlayer || fnl)) ? (getspindleon()) + (getchecked("pausecut") ? "G0 Z0\nM3 S255 P10000\n" : "") : "")

				+ pdn;
		}
	}
	var f1 = speedtravel * 60;
	var rep = getinteger('repeat');
	if (rep > 1) {
		if (lastlayer) {
			f1 *= lastspeed;
			f2 *= lastspeed;
		} else {
			if (cuttabz > z) {
				f1 *= tabcutspeed;
				f2 *= tabcutspeed;
			}
		}
	}
	if (cmd == CMD_FOAM) {
		pw1 = pw2;
		f1 = f2;
	}
	div = "";
	if (sxmax < sxmin) return cdiv;
	div = div + "\n;SHAPE #" + num + "\n";
	if (!closed && isnotpoint) div += pup + "\n";
	if (cmd == CMD_3D) {
		z = -z;
		if (z <= layerheight) {
			f2 = 800;
			extrude = 3 * (layerheight * layerheight) / (filamentD * filamentD);

		} else {
			extrude = 2 * (layerheight * layerheight) / (filamentD * filamentD);
		}
		div += ";extra feed\nG92 E" + mround(e1 - (edis / 350.0)) + "\n";
	}
	var oextrude = extrude;


	if (pw2) div = div + "M106 S" + pw1 + "\n";
	if (cmd == CMD_FOAM) {
		gcode0(f1, X1, 0);
	}
	if (uselead && firstlayer && X0 != null) {
		gcode0(f1, X0, Y0);
	} else {
		var as = getnumber("acpstep");
		if (cmd == CMD_CNC && firstlayer && (penaway && as > 0) && edis > 0) {
			var D = edis;
			var dx = (X1 - lx) / D;
			var dy = (Y1 - ly) / D;
			gcode0(f1, lx + dx * as, ly + dy * as, 2);
			gcode0(f1, lx + D * 0.15 * dx, ly + D * 0.15 * dy, zretract * 0.6);
			gcode0(f1, lx + D * 0.5 * dx, ly + D * 0.5 * dy, zretract);
			gcode0(f1, lx + D * 0.75 * dx, ly + D * 0.75 * dy, zretract * 0.6);
			gcode0(f1, X1, Y1, zretract * 0.25);

		} else gcode0(f1, X1, Y1);
	}
	lx = X1;
	ly = Y1;
	lz = z;

	div += "G0 F" + f1 + "\n";
	div += "G1 F" + f2 + "\n";
	if (cmd == CMD_LASER && firstlayer && iscanresume) {
		div += pdn.replaceAll("M3 S255", "") + "\nG0 Z0.1 F2000\nG0 Z0\n";
	}

	if (pw2) div = div + "M106 S" + pw2 + "\n";
	if (cmd == CMD_LASER) {
	} else
		if (cmd != CMD_3D) {
			if (fnl) {
				div += pdn.replace("=cncz", mround(z)) + '\n';
			} else {
				var ZF = getchecked("spindleoff") ? 3 : 0;
				if (z < 0 && firstlayer) div = div + "G0 Z" + ZF + " F" + speedretract + "\n";
				if (firstlayer && uselead) {
					div += ";LEAD IN\n"
					if (cmd == CMD_PLASMA) div += pdn;
					div += "\nG1 F" + f2 + " Z" + mround(z) + " X" + mround(X1) + " Y" + mround(Y1) + "\n";
				} else {
					if (getchecked("acpmode")) div += pdn.replace("=cncz", mround(z - 1)) + '\n';
					div += pdn.replace("=cncz", mround(z)) + '\n';
				}
			}
		}
	var incut = 0;
	var iscut = 0;
	var lenctr = 0;
	var fm3 = 1;
	var zlast = 0;
	var pdis = 0;
	var lx2 = 0;
	var ly2 = 0;
	var lenc = 0;
	var tabin = getchecked("tabinside");
	if (cmd == CMD_CNC) {
	}
	ll = lines.length;
	if (shift) ll++;
	var rampcut = 0;
	rampmoves = [];
	for (var ci = -1; ci < ll; ci++) {
		i = getRealIndex(ci < 0 ? 0 : ci, lines.length, climb, shift, closed);

		x = lines[i][1];
		y = lines[i][2];
		if (sc == -1) {
			x = sxmax - x;
		}
		if (ro == -1) {
			xx = x;
			x = y;
			y = sxmax - xx;
		}
		if (ci < 0) {
			lx2 = x;
			ly2 = y;
			continue;
		}

		if (cmd == CMD_3D) {
			nlenctr = (nlenctr + lenctr) / 2;
			extrude = oextrude;
			fm3 = 1;

			if (nlenctr <= 20) {
				fm3 = Math.ceil(100 * (nlenctr + 2) / 32.0) / 100.0;
				extrude *= (1.5 - fm3);
			} else if (len - nlenctr < 10) {
				if (!lastlayer) extrude *= 0.85;
			}
		}

		nlenctr = lenctr;
		pi = i + (climb ? 1 : 0);
		if (pi >= lines.length) pi -= lines.length;
		pdis = ci > 0 ? lines[pi][4] : 0;

		lenctr += pdis;


		zz = z * 1 + lenctr / len * dz;
		if (_ramp) {
			if (zz < z2) {
				if (rampcut == 0) {
					var lencut = (z2 - lz) / (zz - lz);
					var x = lx2 + (x - lx2) * lencut;
					var y = ly2 + (y - ly2) * lencut;
					rampcut = 1;
				}
				zz = z2;
			}
			if (rampcut <= 1) {
				rampmoves.push([x, y, zz]);
			}
		}

		if (cmd == CMD_CNC && rampcut != 1) {
			if (tabin || cll) {
				iscut = 0;
				if ((cuttabz > zz)) {
					if ((slc >= lenc) && (slc <= lenctr)) {
						iscut = 1;
						dx = x - lx2;
						dy = y - ly2;
						llen = lenctr - lenc;

						lcut = slc - lenctr;
						x = x + dx * (lcut / llen);
						y = y + dy * (lcut / llen);
						lenc = slc;

						if ((incut == 1)) {
							incut = 0;
							cutindex++;
							slc = cutpos[cutindex];
						} else {
							incut = 1;
							slc += cuttablen;
						}
					}
				}
			}
		}

		if (ci == 0) {
		}

		totaltime += pdis / (f2 * fm3 * 0.0167);
		if (incut || iscut) gcode1(f2 * fm3, x, y);
		else gcode1(f2 * fm3, x, y, zz);

		if (iscut || rampcut == 1) {
			if (rampcut != 1) {
				if (incut == 1) {
					zz = cuttabz;

					div = div + pdn.replace("=cncz", mround(cuttabz)) + '\nG1 F' + f2 + "\n";
				} else {
					div = div + pdn.replace("=cncz", mround(zz)) + '\nG1 F' + f2 + "\n";
				}
			} else rampcut = 2;
			ci--;
			lenctr -= pdis;
		} else {
			lenc = lenctr;
		}

		lx2 = x;
		ly2 = y;
		lz = zz;
	}
	if (closed) gcode1(f2 * fm3, X1, Y1, zz);
	if (_ramp && lastlayer) {
		for (var i = 0; i < rampmoves.length; i++) {
			var rm = rampmoves[i];
			gcode1(f2 * fm3, rm[0], rm[1], zz);
		}
	}
	if (!lastlayer && (cmd == CMD_3D)) {
		lenctr = 0;
		lenc = 0;
		cutat = overlap;
		var dz = z - lastz;
		div = div + "; move up and overlap " + cutat + "mm\n";
		var oe1 = e1;
		extrude = oextrude * 0.4;
		for (var i = 0; i < lines.length; i++) {
			x = lines[i][1];
			y = lines[i][2];
			if (sc == -1) {
				x = sxmax - x;
			}
			if (ro == -1) {
				xx = x;
				x = y;
				y = xx;
			}
			var iscut = 0;
			if ((cutat >= lenc) && (cutat <= lenctr)) {
				iscut = 1;
				dx = x - lx2;
				dy = y - ly2;
				llen = lenctr - lenc;
				lcut = cutat - lenc;
				x = lx2 + dx * (lcut / llen);
				y = ly2 + dy * (lcut / llen);
				lenc = cutat;

			}
			zz = lastz + dz * (lenc / cutat);
			gcode1(f2 * fm3, x, y, zz);
			lx2 = x;
			ly2 = y;
			if (iscut) break;
			lenc = lenctr;
			if (lenc > cutat) break;
		}
		e1 = oe1;
	}


	if (cmd == CMD_FOAM) {
		gcode0(f1, X1, 0);
	}
	if (uselead && lastlayer && X9 != null) {
		if (flip) gcode1(f2, X0, Y0);
		else gcode1(f2, X9, Y9)
	}
	lastz = z;
	if (!closed) {
		lx = lx2;
		ly = ly2;
	}

	if (cmd == CMD_PLASMA) div += "\n" + getspindleoff() + "\n";
	return div;
}
// ============================================================================
// SECTION: Main Processing Functions - Part B (sortedgcode)
// ============================================================================

// Full Stage B + Stage C pass: sort (gcodes -> sgcodes) then emit G-code text.
// Kept as the single entry point used by all existing callers.
function sortedgcode() {
	sortGcodes();
	emitGcodeOnly("full rebuild Stage A+B");
}

// ------------------------------------------------------------------------
// Stage B: Sorting only (gcodes -> sgcodes).
// Consumes the already-offset geometry in `gcodes` / `gcstyle` and never
// touches ClipperLib. Safe to re-run (see IDEMPOTENCY below), which is what
// makes a sort-only refresh possible.
// ------------------------------------------------------------------------
function sortGcodes() {
	cachedcutpos = [];
	totaltime = 0;
	carvetime = 0;
	gcodecarve = "";
	sgcodes = [];
	// PENTING: sxmax/symax/sxmin/symin TIDAK di-assign di sini. Batas geometri
	// dikunci sekali di Stage A (myFunction, tepat sebelum gcodepushcombined())
	// supaya nilainya identik untuk semua tier. Kalau dihitung ulang di sini,
	// Tier B akan menurunkan sxmax dari sisa nilai xmax milik draw_line (batas
	// jalur offset), berbeda dari full rebuild.
	xmax = -10000;
	ymax = -10000;
	xmin = 100000;
	ymin = 100000;

	// IDEMPOTENCY: the nearest-neighbour scan below destructively marks every
	// consumed shape by negating gcodes[*][6] (its area) and by decrementing
	// sty.subchilds. On a repeated sort-only refresh those marks must be undone
	// first, otherwise the eligibility test `gcodes[i][6] > 0` would reject
	// almost everything and the parent/child guard would cut holes before their
	// outlines. `osubchilds` is captured once per shape in gcodepush().
	for (var _ri = 0; _ri < gcodes.length; _ri++) {
		if (gcodes[_ri][6] < 0) gcodes[_ri][6] = -gcodes[_ri][6];
	}
	for (var _rs = 0; _rs < gcstyle.length; _rs++) {
		var _rsty = gcstyle[_rs];
		if (_rsty && typeof _rsty.osubchilds !== "undefined") _rsty.subchilds = _rsty.osubchilds;
	}
	var sm = -1;
	var lx = 0;
	var ly = 0;
	if (getchecked("usestart")) {
		var ss = getvalue("startat").split(",");
		lx = ss[0] * 1;
		ly = ss[1] * 1;
	}
	e1 = 0;
	sortit = 1;
	var cs = -1;
	var sflip, sshift;
	xs = getnumber('xsort');
	ys = getnumber('ysort');
	szs = getnumber('szsort');
	var csort = getnumber('centersort');
	if (!(csort > 0)) csort = 0;
	var yslowR = getnumber('yslow');
	if (!(yslowR >= 1)) yslowR = 1;
	var gsort = getnumber('greensort');
	if (!(gsort >= 0)) gsort = 0;
	var ufinish = getchecked("usefinish");
	var sepcut = getchecked("separatecut") && !ufinish;

	if (cmd == 4) setvalue("repeat", Math.ceil(getvalue("zdown") / layerheight));
	var re = getvalue("repeat");
	var dogboneMode = typeof getDogboneMode === "function" ? getDogboneMode() : (getchecked("overcut") ? "line" : "none");
	var ov = (dogboneMode !== "none");

	var mustF = 0;
	// function findnearest(closed, lx, ly, pts, sty) {

	// 	var pstep = Math.floor(pts.length / 100) + 1;
	// 	var newx = 0;
	// 	var newy = 0;
	// 	var shift = 0;
	// 	var flip = 0;
	// 	var dis = 100000000;
	// 	if (closed) {
	// 		for (var p = 0; p < pts.length; p += pstep) {
	// 			var dx = pts[p][1] - lx;
	// 			var dy = pts[p][2] - ly;
	// 			var dis2 = (dx * dx + dy * dy);
	// 			if (dis2 < dis) {
	// 				shift = p;
	// 				dis = dis2;
	// 				newx = pts[p][1];
	// 				newy = pts[p][2];
	// 			}
	// 		}
	// 	} else {
	// 		var dx = pts[0][1] - lx;
	// 		var dy = pts[0][2] - ly;
	// 		dis = (dx * dx + dy * dy);
	// 		dx = pts[pts.length - 1][1] - lx;
	// 		dy = pts[pts.length - 1][2] - ly;
	// 		var dis2 = (dx * dx + dy * dy);
	// 		flip = 0;
	// 		if (dis2 < dis) {
	// 			flip = 1;
	// 			dis = dis2;
	// 			newx = pts[pts.length - 1][1];
	// 			newy = pts[pts.length - 1][2];
	// 		}
	// 	}
	// 	dis = sqrt(dis);
	// 	if (sty.greentravel) dis -= 10000;
	// 	if (sty.sortadd)
	// 		dis += sty.sortadd;
	// 	return [newx, newy, dis, shift, flip];
	// }
	function findnearest(closed, lx, ly, pts, sty, shapeIndex) {
		var pstep = Math.floor(pts.length / 100) + 1;
		var newx = 0;
		var newy = 0;
		var shift = 0;
		var flip = 0;
		var dis = 100000000;
		var yslowF = (typeof yslowR !== "undefined" && yslowR >= 1) ? yslowR : 1;

		// Closed hijau = blackhole: tidak pernah dinilai di sini.
		// Sudah di-skip di loop kandidat + ditandai done sebelum sortir.

		if (closed && virtualStartPoints[shapeIndex] && virtualStartPoints[shapeIndex].points.length > 0) {
			var vdata = virtualStartPoints[shapeIndex];

			// Lazy compute cache
			if (vdata.realPointCache === null) {
				console.log("calc start point cache");
				vdata.realPointCache = [];
				for (var v = 0; v < vdata.points.length; v++) {
					var bestIdx = 0;
					var bestDist = 100000000;
					for (var p = 0; p < pts.length; p++) {
						var dx = vdata.points[v][0] - pts[p][1];
						var dy = vdata.points[v][1] - pts[p][2];
						var d2 = dx * dx + dy * dy;
						if (d2 < bestDist) {
							bestDist = d2;
							bestIdx = p;
						}
					}
					vdata.realPointCache.push(bestIdx);
				}
			}

			// Cari virtual point terdekat dari (lx, ly)
			var bestVpIndex = -1;
			var bestVpDist = 100000000;
			for (var v = 0; v < vdata.points.length; v++) {
				var dx = vdata.points[v][0] - lx;
				var dy = (vdata.points[v][1] - ly) * yslowF;
				var d2 = dx * dx + dy * dy;
				if (d2 < bestVpDist) {
					bestVpDist = d2;
					bestVpIndex = v;
				}
			}

			// Ambil real point dari cache
			if (bestVpIndex >= 0) {
				var rpi = vdata.realPointCache[bestVpIndex];
				shift = rpi;
				newx = pts[rpi][1];
				newy = pts[rpi][2];
				var dx = newx - lx;
				var dy = (newy - ly) * yslowF;
				dis = dx * dx + dy * dy;
			}
		}

		// Fallback ke logic lama jika tidak ada virtual point
		if (dis === 100000000) {
			if (closed) {
				for (var p = 0; p < pts.length; p += pstep) {
					var dx = pts[p][1] - lx;
					var dy = (pts[p][2] - ly) * yslowF;
					var dis2 = (dx * dx + dy * dy);
					if (dis2 < dis) {
						shift = p;
						dis = dis2;
						newx = pts[p][1];
						newy = pts[p][2];
					}
				}
			} else {
				var dx = pts[0][1] - lx;
				var dy = (pts[0][2] - ly) * yslowF;
				dis = (dx * dx + dy * dy);
				dx = pts[pts.length - 1][1] - lx;
				dy = (pts[pts.length - 1][2] - ly) * yslowF;
				var dis2 = (dx * dx + dy * dy);
				flip = 0;
				if (dis2 < dis) {
					flip = 1;
					dis = dis2;
					newx = pts[pts.length - 1][1];
					newy = pts[pts.length - 1][2];
				}
			}
		}

		dis = sqrt(dis);
		if (sty.sortadd) dis += sty.sortadd;
		return [newx, newy, dis, shift, flip];
	}
	var lasttarget = 0;
	var dosafesort = getchecked("safesort");

	// Build spatial-hash index over gcodes for the nearest-polygon sort.
	// Keyed on each gcode's first vertex (gcodes[i][4][0]). The query
	// point is the current head (lx, ly). Cell size is the median of the
	// total drawing span, so cells are a sensible fraction of the work
	// envelope regardless of the absolute scale. The inner loop falls
	// back to expanding ring search if the 3x3 query returns fewer
	// items than gcodes.length (safety net for the worst case).
	var srtGrid = null;
	{
		// Compute cell size from the gcode bounding box (not just median
		// span). For a single horizontal line that spans 841 units with
		// both endpoints at the same cell, median span is 0 → cellSize
		// would be 1.0, which is way too small relative to the drawing
		// extent. The sort head can then jump ~841 units away from any
		// gcode cell, forcing the ring query to walk maxR=841000+ rings.
		//
		// Fix: use the gcode bounding box diagonal divided by 32 as a
		// floor for cellSize. This keeps the cell size proportional to
		// the drawing extent so the ring query stays fast.
		var _nG = gcodes.length;
		if (_nG > 0) {
			var _minX = Infinity, _maxX = -Infinity, _minY = Infinity, _maxY = -Infinity;
			for (var _gi = 0; _gi < _nG; _gi++) {
				var _pts = gcodes[_gi][4];
				if (!_pts || _pts.length === 0) continue;
				for (var _vi = 0; _vi < _pts.length; _vi++) {
					var _vx = _pts[_vi][1], _vy = _pts[_vi][2];
					if (_vx < _minX) _minX = _vx;
					if (_vx > _maxX) _maxX = _vx;
					if (_vy < _minY) _minY = _vy;
					if (_vy > _maxY) _maxY = _vy;
				}
			}
			if (!isFinite(_minX)) { _minX = 0; _maxX = 0; _minY = 0; _maxY = 0; }
			var _extent = Math.max(_maxX - _minX, _maxY - _minY, 1);
			// Cell size = drawing extent / 32 (so ~32 cells across the
			// drawing) and at least 1.0. Also respect median for dense
			// layouts where we want smaller cells.
			var _spans = new Array(_nG);
			for (var _gi3 = 0; _gi3 < _nG; _gi3++) {
				var _pts2 = gcodes[_gi3][4];
				if (_pts2 && _pts2.length > 0) {
					_spans[_gi3] = Math.abs(_pts2[0][1]) + Math.abs(_pts2[0][2]);
				} else _spans[_gi3] = 0;
			}
			_spans.sort(function (a, b) { return a - b; });
			var _medSpan = _spans[Math.floor(_nG / 2)] || 0;
			var _srtCell = Math.max(Math.abs(_medSpan) / 8, _extent / 32, 1.0);
			srtGrid = { grid: Object.create(null), cellSize: _srtCell };
			for (var _gi2 = 0; _gi2 < _nG; _gi2++) {
				var _p = gcodes[_gi2][4];
				if (!_p || _p.length === 0) continue;
				var _ccx = Math.floor(_p[0][1] / _srtCell);
				var _ccy = Math.floor(_p[0][2] / _srtCell);
				var _k = _ccx + "," + _ccy;
				if (!srtGrid.grid[_k]) srtGrid.grid[_k] = [];
				srtGrid.grid[_k].push(_gi2);
			}
		}
	}

	// Expanding-ring query: returns up to maxItems indices in increasing
	// distance from (x, y). Stops when the grid extent is fully covered.
	// (Reverted from the 3x3-with-fallback version that was missing
	// gcodes far from the query point.)
	function srtQuery(x, y, maxItems) {
		if (!srtGrid) {
			var _all = new Array(gcodes.length);
			for (var _ai = 0; _ai < gcodes.length; _ai++) _all[_ai] = _ai;
			return _all;
		}
		var _cs = srtGrid.cellSize;
		var _ccx0 = Math.floor(x / _cs);
		var _ccy0 = Math.floor(y / _cs);
		// Compute L-inf max ring needed to cover the grid extent
		var _minCx = Infinity, _maxCx = -Infinity, _minCy = Infinity, _maxCy = -Infinity;
		for (var _gk in srtGrid.grid) {
			var _cma = _gk.indexOf(",");
			var _gcx = +_gk.substring(0, _cma);
			var _gcy = +_gk.substring(_cma + 1);
			if (_gcx < _minCx) _minCx = _gcx;
			if (_gcx > _maxCx) _maxCx = _gcx;
			if (_gcy < _minCy) _minCy = _gcy;
			if (_gcy > _maxCy) _maxCy = _gcy;
		}
		var _maxR = Math.max(_maxCx - _ccx0, _ccx0 - _minCx, _maxCy - _ccy0, _ccy0 - _minCy) + 1;
		if (!isFinite(_maxR) || _maxR < 1) _maxR = 1;
		var _seen = Object.create(null);
		var _out = [];
		// Walk L-infinity rings outward to the grid extent. Do NOT break
		// on empty rings (sparse grids have many empty rings but still
		// hold items far from the query).
		for (var _r = 0; _r <= _maxR; _r++) {
			for (var _dx = -_r; _dx <= _r; _dx++) {
				for (var _dy = -_r; _dy <= _r; _dy++) {
					if (_r > 0 && Math.max(Math.abs(_dx), Math.abs(_dy)) !== _r) continue;
					var _cell = srtGrid.grid[(_ccx0 + _dx) + "," + (_ccy0 + _dy)];
					if (!_cell) continue;
					for (var _ci = 0; _ci < _cell.length; _ci++) {
						var _idx = _cell[_ci];
						if (_seen[_idx]) continue;
						_seen[_idx] = 1;
						_out.push(_idx);
						if (_out.length >= maxItems) return _out;
					}
				}
			}
		}
		return _out;
	}

	for (var kk = 0; kk < 2; kk++) {
		for (var i = 0; i < gcodes.length; i++) {
			var sty = gcstyle[gcodes[i][8]];
			sty.lchilds = sty.childs = sty.ochilds + sty.exchilds;

		}
		if (!sepcut && kk == 1) break;


		var sparent = -1;
		var usefinishpart = getchecked("finishpart");
		var parentCx = null;
		var greenHoles = null;
		if (csort > 0 || gsort > 0) {
			parentCx = new Array(gcstyle.length);
			for (var _pi2 = 0; _pi2 < gcstyle.length; _pi2++) parentCx[_pi2] = null;
			for (var _gi4 = 0; _gi4 < gcodes.length; _gi4++) {
				var _si = gcodes[_gi4][8];
				var _c = gcodes[_gi4][11];
				if (!_c) continue;
				if (csort > 0 && parentCx[_si] === null) parentCx[_si] = [_c[0], _c[1]];
			}
			if (gsort > 0) {
				greenHoles = [];
				for (var _gi5 = 0; _gi5 < gcodes.length; _gi5++) {
					var _gs = gcstyle[gcodes[_gi5][8]];
					// Blackhole hanya dari green CLOSED. Open green tetap
					// jalur travel biasa, bukan titik tarik.
					if (_gs && _gs.greentravel && gcodes[_gi5][7] && gcodes[_gi5][11]) {
						greenHoles.push({ x: gcodes[_gi5][11][0], y: gcodes[_gi5][11][1], top: _gs.topparent, idp: _gs.idp });
					}
				}
				if (greenHoles.length === 0) greenHoles = null;
			}
		}
		for (var j = 0; j < gcodes.length; j++) {
			if (sortit) {
				cs = -1;
				var bg = 10000000;
				sflip = 0;
				sshift = 0;
				var sty = gcstyle[gcodes[j][8]];
				var k1 = sty.doEngrave || sty.domarking || sty.dovcarve || sty.dopocket;
				var skip = (kk == (k1 ? 1 : 0)) && sepcut;
				if (skip) {
					for (var pi in sty.parent) {
						gcstyle[sty.parent[pi]].childs--;
					}

				}
				// Spatial-hash-accelerated nearest-polygon scan. Query the
				// expanding ring around (lx, ly) until we have enough
				// candidates or the grid is exhausted. If exhausted and we
				// still have room, fall back to the remaining gcodes that
				// aren't in the seen set (preserves correctness even when
				// the grid cell size is too small for the workspace).
				var _qResults = srtQuery(lx, ly, gcodes.length);
				for (var _qi = 0; _qi < _qResults.length; _qi++) {
					var i = _qResults[_qi];
					var sty = gcstyle[gcodes[i][8]];
					var subch = gcodes[i][10];
					k1 = sty.doEngrave || sty.domarking || sty.dovcarve || sty.dopocket;
					if (kk == (k1 ? 1 : 0) && sepcut) continue;
					if (!k1) {
						if (subch == 0 && sty.subchilds > 0) continue;
						if (sty.childs > 0) continue;
					}
					var dis = 0;
					if (sparent != -1 && usefinishpart && (sparent == sty.topparent || sparent == sty.idp)) dis = -10000;

					var newx = 0;
					var newy = 0;

					var pts = gcodes[i][4];
					var shift = 0;
					var flip = 0;
					var near = findnearest(gcodes[i][7], lx, ly, pts, sty, gcodes[i][8]);
					newx = near[0];
					newy = near[1];
					dis += near[2];
					shift = near[3];
					flip = near[4];


					dis += gcodes[i][6] * szs;
					var axs = xs;
					var ays = ys;
					if (sty.sortadd > 0) { axs = 0; ays = 0; }

					var _cdx = (gcodes[i][11][0] - lx);
					var _cdy = (gcodes[i][11][1] - ly) * yslowR;
					dis += _cdx * (axs) + _cdy * (ays);

					dis += newx * axs + newy * ays;

					if (csort > 0 && parentCx && sty.topparent >= 0 && parentCx[sty.topparent]) {
						var _pc = parentCx[sty.topparent];
						var _rdx = gcodes[i][11][0] - _pc[0];
						var _rdy = (gcodes[i][11][1] - _pc[1]) * yslowR;
						dis += sqrt(_rdx * _rdx + _rdy * _rdy) * csort;
					}

					// Blackhole: hanya blackhole TERDEKAT yang satu grup
					// (topparent/idp sama) dengan kandidat yang dihitung.
					// Beda compound = tidak saling menarik.
					if (gsort > 0 && greenHoles && !sty.greentravel) {
						var _gd = 100000000;
						for (var _gh = 0; _gh < greenHoles.length; _gh++) {
							var _hb = greenHoles[_gh];
							if (!(_hb.top === sty.topparent || _hb.top === sty.idp || _hb.idp === sty.topparent || _hb.idp === sty.idp)) continue;
							var _hdx = gcodes[i][11][0] - _hb.x;
							var _hdy = (gcodes[i][11][1] - _hb.y) * yslowR;
							var _hd = sqrt(_hdx * _hdx + _hdy * _hdy);
							if (_hd < _gd) _gd = _hd;
						}
						if (_gd < 100000000) dis += _gd * gsort;
					}

					if (gcodes[i][1] == "F") dis += (mustF ? -1000 : 1000);

					if ((gcodes[i][6] > 0) && (dis < bg)) {
						cs = i;
						sshift = shift;
						sflip = flip;
						bg = dis;

					}
				}
			} else cs = j;
			if (cs >= 0) {
				if (gcodes[cs][1] == "F") mustF = 0;
				if (gcodes[cs][1] == "D") mustF = 1;

				sty = gcstyle[gcodes[cs][8]];
				subch = gcodes[cs][10];
				if (subch == 0) { } else {
					sty.subchilds--;
				}
				for (var pi in sty.parent) {
					gcstyle[sty.parent[pi]].childs--;
				}
				if (!(sty.greenskip || sty.greentravel)) sparent = sty.topparent;
				gcodes[cs][6] = -gcodes[cs][6];
				var pts = gcodes[cs][4];
				lx = pts[sshift][1];
				ly = pts[sshift][2];

				var newtarget = [gcodes[cs], cs + 1, sflip, sshift];
				sgcodes.push(newtarget);


				if (dosafesort && (!(sty.greentravel || sty.greenskip))) {
					if (lasttarget) {
						var recheck = findnearest(lasttarget[0][7], lx, ly, lasttarget[0][4], gcstyle[lasttarget[0][8]], lasttarget[0][8]);
						lasttarget[4] = lasttarget[3];
						lasttarget[3] = recheck[3];
					}
					lasttarget = newtarget;
				} else lasttarget = 0;


				if (!gcodes[cs][7]) {
					var rep = re;

					var _rz = (getnumber("carvedp"));
					if (sty.domarking) {
						// 'var' agar tetap lokal di sortGcodes(): di kode asli nama ini
						// ter-hoist dari blok emit (satu fungsi sortedgcode) sehingga
						// tidak pernah menulis global. Tanpa 'var', assignment ini
						// mencemari global zdown.
						var zdown = getnumber("carved")
						rep = Math.ceil(zdown / _rz);
						rep = Math.max(rep, zdown / getnumber("firstd"));
					} else
						if (sty.greenskip || sty.doEngrave || sty.dovcarve || sty.dopocket) {
							rep = 0;
						} else if (sty.greentravel) {
							rep = 1;
						} else {
							if (getchecked("burn1")) rep++;
						}

					if (sflip) rep++;
					if (rep & 1) {
						lx = pts[pts.length - 1][1];
						ly = pts[pts.length - 1][2];
					}
				}
			}
		}
	}
}

// ------------------------------------------------------------------------
// Stage C: Emit G-code text from sgcodes (re-evaluates feed, plunge and pass
// depths). Never runs ClipperLib; whether sorting ran is decided by the caller,
// so `source` is only used for the log line.
// ------------------------------------------------------------------------
function emitGcodeOnly(source) {
	if (!sgcodes || sgcodes.length === 0) return;
	// Reset akumulator waktu potong di sini, bukan hanya di sortGcodes().
	// Tier C (refreshgcodeFast) tidak memanggil sortGcodes(), sementara
	// lines2gcode() di bawah tetap menambah totaltime tiap kali dipanggil —
	// tanpa reset di titik ini harga jasa (CNC Cost) naik terus tiap klik Process.
	totaltime = 0;
	console.log("[Stage C: Emit] " + (source ? source + " — " : "") +
		"menulis teks G-code dari " + sgcodes.length + " cached paths (Clipper tidak dijalankan)");

	// PENTING: pup1/cutpw/s/se sengaja TANPA 'var'. Di kode asli (sortedgcode
	// sebelum dipecah menjadi sortGcodes + emitGcodeOnly) keempatnya adalah
	// variabel GLOBAL, dan getspindleon() membaca global `cutpw` (dideklarasikan
	// di baris 238). Memberi 'var' di sini membuatnya lokal sehingga
	// getspindleon() mengembalikan "M3 Sundefined" di awal kedua editor G-code.
	pup1 = getvalue("pup");
	cutpw = getnumber('cutpw') * 255 * 0.01;
	s = "";
	se = "";

	// Tier B (refreshgcodeSort) dan Tier C (refreshgcodeFast) TIDAK menjalankan
	// myFunction(), padahal myFunction yang mengisi skalar global berikut dari
	// input. Tanpa refresh di sini, lines2gcode() dan gcode_verify() — yang
	// membaca global ini — akan memakai nilai basi saat `trav`/`pup` diubah.
	// Nilainya identik dengan yang di-set myFunction, jadi jalur full rebuild
	// tidak berubah.
	speedtravel = getnumber("trav");
	speedfeed = getnumber("feed");
	speedplunge = getvalue('pdn');
	if (speedplunge.indexOf("F") > 0) speedplunge = speedplunge.split(" F")[1].split(" ")[0];
	speedretract = getvalue("pup");
	if (speedretract.indexOf("F") > 0) {
		zretract = speedretract.split(" Z")[1].split(" ")[0];
		speedretract = speedretract.split(" F")[1].split(" ")[0];
	}

	if (cmd == CMD_LASER) {
		pup1 = "";
		s = getspindleon(0) + "G0 F3000\nG1 F3000\n";
		se = getspindleon();
	} else if (cmd == CMD_PLASMA) {
		s = "G1 F3000\n";
		se = "";
	} else {
		s = getspindleon() + "G1 F3000\n";
		se = getspindleon();
	}

	cncdeep0 = -getvalue("zdown");

	skipz = -getvalue("zdown0");
	if (skipz == undefined) skipz = 0;
	var oskipz = skipz;
	pdn1 = getvalue("pdn").replace("=cncz", mround(cncdeep0)) + '\n';
	cncdeep = cncdeep0;
	var cuttab = 0;
	lastz = 0;
	var tabz = getnumber("tabc");
	cuttab = cncdeep;
	if (cmd == CMD_CNC) {
		lastz = layerheight * 0.7;
		cncz -= lastz;
		cuttab += tabz;
		_rampdown = getchecked("rampdown");
	} else {
		_rampdown = 0;
	}
	var empty = 1;
	var slsmall = getnumber("slowsmall");
	var slsmallv = getnumber("slowsmallval");
	var usesl = getchecked("useslowsmall");
	var dogboneMode = typeof getDogboneMode === "function" ? getDogboneMode() : (getchecked("overcut") ? "line" : "none");
	var ov = (dogboneMode !== "none");
	var ufinish = getchecked("usefinish");
	var sepcut = getchecked("separatecut") && !ufinish;
	var gsort = getnumber('greensort');
	if (!(gsort >= 0)) gsort = 0;
	var re = getvalue("repeat");
	if (cmd == 4) re = Math.ceil(getvalue("zdown") / layerheight);
	// speedtravel TIDAK di-'var' di sini: nilai global-nya sudah di-refresh di
	// awal fungsi supaya lines2gcode() dan gcode_verify() ikut melihat nilai baru.

	cuttabinside = 0;
	for (var j = 0; j < sgcodes.length; j++) {
		vcuttab = cuttab;
		skipz = oskipz;
		if (pause_at.indexOf(sgcodes[j][1] + "") >= 0) {
			s += "\nG0 Z3 F350\n;PAUSE\nG0 Y-100 F500\n";
		}
		if (disable_cut.indexOf(sgcodes[j][1] + "") < 0) {
			srl = sgcodes[j][0][5];
			if ((Math.abs(sgcodes[j][0][6]) < 2) && (cuttabinside)) vcuttab = cncdeep;

			snum = sgcodes[j][0][8];
			hasfnl = sgcodes[j][0][1] == "D";
			fnl = sgcodes[j][0][1] == "F";
			lenmm = sgcodes[j][0][0];
			var sty = gcstyle[snum];
			if (sty == undefined) sty = defaultsty;
			if (!sty.closed) vcuttab = cncdeep;
			var f2 = getvalue('feed') * 60;

			if ((ov > 0) && (cmd == CMD_CNC)) {
				if (OVC_MODE == 1) {
					for (i = 0; i < srl.length - 1; i++) {
						if (srl[i][6] < 0) {
							oc = srl[i][5];
							ocxy = "X" + mround(oc[0]) + " Y" + mround(oc[1]);
							s += "\n" + pup1 + "\nG0 " + ocxy + " F200\n";
							s += pdn1 + pup1 + "\n";
						}
					}
				}
			}
			var _re = re * 1;
			if (usesl && lenmm <= slsmall) {
				if (slsmallv < 1) f2 = f2 * slsmallv;
				else _re += Math.floor(slsmallv);

			}
			var zdown = cncdeep / _re;
			var ismark = marking_cut.indexOf(sgcodes[j][1] + "") >= 0;
			if (ismark) {
				zdown = -1;
				_re = 2;
			}
			var docarve = 0;
			var iscut = 1;
			var iseng = 0;
			var strokedeep = sty.strokedeep;

			var _rz = getnumber("firstd");

			// --- MERAH (DOMARKING) ---
			if (sty.domarking) {
				f2 = getvalue('pltfeed') * 60;
				pw = getvalue('pltpw') * 255 * 0.01;
				pw = sty.markpower ? sty.markpower : pw;
				zdown = strokedeep > 0 ? strokedeep : getvalue("carved");
				if (cmd == CMD_LASER) _re = getnumber("redrep");
				else _re = Math.ceil(zdown / _rz);
				vcuttab = -1 * zdown;
				zdown *= -1 / _re;
				iscut = 0;
				iseng = 1;
				se += M3 + " S" + parseInt(pw) + "\n";
			}
			if (sty.doEngrave || sty.dovcarve) {
				if (getchecked("rasteroutline")) {
					pw = getvalue('rasteroutpw') * 255 * 0.01;
					se += M3 + " S" + parseInt(pw) + "\n";
					if (cmd == CMD_LASER) _re = 1;
					else {
						zdown = strokedeep > 0 ? strokedeep : getvalue("carved");
						_re = Math.ceil(zdown / _rz);
						vcuttab = -1 * zdown;
						zdown *= -1 / _re;
					}
				} else _re = 0;
				f2 = getvalue('rasteroutfeed') * 60;
				iscut = 0;
				iseng = 1;
			}
			if (sty.greenskip) {
				_re = 0;
				iscut = 0;
			}
			if (sty.greentravel) {
				_re = 0;
				iscut = 0;
				skipz = 20;
			}
			if (sty.dopocket) {
				_re = 0;
				iscut = 0;
			}
			if (sty.dovcarve) {
				_re = 1;
				docarve = 1;
				iscut = 0;
			}

			if (fnl) {
				_re = 1;
				var zdown = cncdeep;
			}
			cncz = zdown;
			var cncz2 = 0;
			var len = 0.1;
			var lines = sgcodes[j][0][4];
			for (var ci = 0; ci < lines.length; ci++) {
				len += lines[ci][4];
			}
			sgcodes[j][0][0] = len;
			var shift = sgcodes[j][3];
			var climb = sgcodes[j][2];
			rcutpos = getcutpos(j, shift, climb);
			var isfirst = true;
			if ((_re * iscut > 0) && (cmd == CMD_LASER) && getchecked("burn1")) {
				s += lines2gcode(sgcodes[j][1], sgcodes[j][0], cncz2, cncz2, vcuttab, sgcodes[j][0][5], 1, 1, snum, getvalue("burnfeed") * 60, 0, shift, rcutpos);
				isfirst = false;
			}

			var penaway = getchecked("acpmode") && getchecked("safesort") && (getnumber("acpstep") > 0);
			var ps = pup1 + "\n";
			if (cmd == CMD_CNC && lastz < 0 && penaway && iscut) {
				ps = "G0 Z-1 F3000\n";
			} else penaway = 0;
			if (fnl) ps = "G0 Z3\n";
			var acp = "";
			if ((cmd == CMD_PLASMA || getchecked("spindleoff"))) acp = getspindleoff();
			acp += ps;
			var isacp = 0;


			if (sty.greentravel) {
				f2 = speedtravel * 60;
				zdown = zretract;
				cncz = zdown;
				_re = 1;
				iscut = 1;
				if (gsort > 0 && sty.closed) {
					_re = 0;
					iscut = 0;
				}
			}
			if (_re > 0) {
				empty = 0;
				if (iseng && sepcut) {
					se += acp;
				} else {
					s += acp;
				}
			}

			if (!sty.closed && ((cmd == CMD_CNC && getchecked("burn1")) || getchecked("flipx"))) {
				climb = climb ? 0 : 1;
			}
			var of2 = f2;
			for (var i = 0; i < _re; i++) {
				if (_re > 1 && hasfnl && i == _re - 1) break;
				var fff = 0;
				f2 = of2;
				if ((i == 0) && (cmd == CMD_CNC)) {
					f2 *= getnumber('feed1x');
				}
				if (isacp && (i > 0) && (i < _re - 1)) {
					fff = 1000;
				}
				if ((_re * iscut > 0) && (cmd == CMD_CNC) && getchecked("burn1") && (i == _re - 1)) {
				}
				if (_rampdown) z2 = cncz2;
				else z2 = cncz;
				if (acpengrave && iseng) cncz = z2 = _re * zdown;
				if (iseng && sepcut) {
					laddz = 0;
				} else laddz = getnumber("addz");

				sr = lines2gcode(sgcodes[j][1], sgcodes[j][0], z2, cncz, vcuttab, sgcodes[j][0][5], i == _re - 1, isfirst && (i == 0), snum, f2 + fff, climb, shift, rcutpos, penaway);
				if (sgcodes[j][0][4].length == 1) sr += "\nG0 F3000 Z" + (cncz - zdown) + "\n";
				if (docarve) sr = '';

				if (iseng && sepcut) {
					se += sr;
				} else s += sr;
				if ((!sty.closed) && (_re > 1)) climb = climb ? 0 : 1;
				cncz = cncz + zdown;
				cncz2 = cncz2 + zdown;

			}
		}
	}
	xystart = [0, 0];
	if (getchecked("usestart")) xystart = getvalue("startat").split(",");
	var mz = "G92 X" + xystart[0] + " Y" + xystart[1] + "\n";
	if (isgrbl) mz = machinezero;
	startgcode = "G92 X0 Y0\n";
	if (getchecked("usestart")) startgcode = mz + "\n";
	s = s + getvalue("pup");
	var f1 = speedtravel * 60;
	sc = 1;
	if (getchecked("flipx")) sc = -1;
	if (cmd == CMD_3D) {
		// Pakai sxmax/symax (batas geometri stabil dari Stage B) dan bukan
		// xmax/ymax, karena xmax/ymax di-reset ke sentinel oleh sortGcodes()
		// sebelum emit. Dengan cara ini hasil Tier C identik dengan full rebuild.
		s = "g28\ng0 z0 f350\nm109 s" + filamentTemp + "\nG92 X" + mround(-sc * sxmax / 2) + " Y" + mround(symax / 2) + " E-5\n" + s;
		s += "G92 X" + mround(sc * sxmax / 2) + " Y" + mround(-symax / 2) + "\ng28";
	}
	if (isgrbl) s += machinezero;

	setvalue("gcode", s);
	setvalue("engcode", "");
	cut_eng = se;
}
// ============================================================================
// SECTION: Main Processing Functions - Part C (gcode_verify)
// ============================================================================

function gcode_verify(en = 0) {
	if (cache_ink_img.length == 0 && ink_images.length > 0) {
		cacheloaded = 0;
		for (var i = 0; i < ink_images.length; i++) {
			var image = new Image();
			cache_ink_img.push([image, 0]);
			image.src = 'data:image/png;base64,' + ink_images[i][4];
			image.onload = check_img_cache;
		}
		return;
	}

	veeline = [];
	conline = [];
	cglines = [];
	already = [];
	var c = $("myCanvas1");
	var sc = 1; // Scale variable for canvas operations

	ENGRAVE = 0;
	cmd = getvalue('cmode');
	harga = getvalue('matprice');
	var hargacut = getvalue('cutprice');
	lx = 0;
	ly = 0;
	var mz = "";
	var fz = "";
	var f1 = speedtravel * 60;

	if (getchecked("usestart")) {
		var ss = getvalue("startat").split(",");
		lx = ss[0] * 1;
		ly = ss[1] * 1;
		mz = "G92 X" + mround2(lx) + " Y" + mround2(ly) + "\n";
		fz = "G0 F" + mround(f1) + " X" + mround2(lx) + " Y" + mround2(ly) + "\n";
	}
	firstline = 1;
	jmltravel = 0;

	// Clear stored draw operations in InfiniteCanvas before drawing new G-code
	if (window.myCanvas1 && window.myCanvas1.clearDrawOperations) {
		window.myCanvas1.clearDrawOperations();
	}

	var ctx = c.getContext("2d");
	if (ctx.reset) {
		ctx.reset();
	} else {
		// Fallback for browsers without reset() method
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, c.width, c.height);
	}
	var sfinal = 0;
	$("segm").value = "";
	var theme = typeof window.theme !== 'undefined' ? window.theme : ((typeof appTheme !== 'undefined' && appTheme === 'dark') ? 1 : 0);
	ctx.fillStyle = theme == 0 ? "#ffffff" : "#000000";
	$("myCanvas1div").style.background = ctx.fillStyle;
	ctx.fillRect(-10, -10, c.width + 10, c.height + 10);
	engravetime = 0;
	// carvetime diproduksi DI DALAM fungsi ini (dobtvcarve() -> vcarve(), cnc.js:584).
	// Reset-nya harus di sini; reset di sortGcodes() saja tidak cukup karena
	// Tier C (refreshgcodeFast) melewati sortGcodes().
	carvetime = 0;
	bitmaptime = 0;
	if (en) {
		if (ENGRAVE == 0) engrave = {};
		else {
			engrave1 = [];
		}
	}

	if (ink_images && ink_images.length > 0) {
		for (var i = 0; i < ink_images.length; i++) {
			if (cache_ink_img[i][0].complete) {
				if (cmd == CMD_LASER) imagedither(cache_ink_img[i][0], $("dithercanv"), ink_images[i][0], ink_images[i][1], ink_images[i][2], ink_images[i][3], ink_images[i][5]);
				if (cmd == CMD_CNC) cncengrave(cache_ink_img[i][0], $("engrcanv"), ink_images[i][0], ink_images[i][1], ink_images[i][2], ink_images[i][3], ink_images[i][5]);
			}
		}
	}


	var c1 = getchecked("rasteroutline");
	for (var i = 0; i < sgcodes.length; i++) {
		if (en && (ENGRAVE == 1)) engrave = {};
		col = getRandomColor();
		snum = sgcodes[i][0][8];
		sty = gcstyle[snum];

		if (sty == undefined) sty = defaultsty;
		nocut = sty.greenskip || sty.greentravel;
		if (sty.doEngrave || (sty.dopocket)) nocut = !c1;
		if (nocut) {
			dash = [1, 2];
			col = "#0000CC88";
		} else {
			dash = [];
			sfinal += Math.abs(sgcodes[i][0][0]);
			col = sty["stroke"];
		}
		draw_line(sgcodes[i][1],
			col,
			sgcodes[i][0][4],
			sgcodes[i][0][5],
			dash,
			sgcodes[i][0][0],
			sgcodes[i][0][7],
			snum,
			sgcodes[i][2],
			sgcodes[i][3],
			0,
			getcutpos(i)
		);

		if (en && (ENGRAVE == 1)) doengrave();
	}
	if (en) {
		if (ENGRAVE == 0) doengrave();
	}

	travtime = jmltravel / speedtravel;
	sfinal += jmltravel;
	for (var i = 0; i < oldlines.length; i++) {
		draw_line("", "#CCCCCCCC", oldlines[i][0], [], [1, 2], 0, false, oldlines[i][1], 0, 0, true, []);
	}

	ctx.font = "12px Arial";
	w = mround((xmax - xmin) / 10);
	h = mround((ymax - ymin) / 10);
	text = $("material");
	mat = "-";
	try {
		mat = text.options[text.selectedIndex].innerText;
	} catch (e) {
		sc = 1;
	}
	mat = namamaterial;
	if (getchecked("flipx")) sc = -1;
	pup1 = getvalue("pup") + '\n';
	finishgcode = pup1 + (fz ? fz : ("\nG0 F" + mround(f1) + " X0 Y0\n"));
	finishgcode += getspindleoff();

	if (cmd == CMD_CNC || cmd == CMD_PLASMA) finishgcode += "G0 Z" + getvalue("finalz") + '\nM5\n';
	if (cmd == CMD_LASER) finishgcode += pup1;
	setvalue("pgcode", pup1 + M3 + " S255\nG0 F12000 X" + mround(sc * xmin) + " Y" + mround(ymin) +
		"\nG1 Z1\nG0 Z0\nG0 X" + mround(sc * xmax) +
		"\nG1 Z1\nG0 Z0\nG0 Y" + mround(ymax) +
		"\nG1 Z1\nG0 Z0\nG0 X" + mround(sc * xmin) +
		"\nG1 Z1\nG0 Z0\n\nG0 Y" + mround(ymin) + "\n");
	drawengrave();
	dobtvcarve();
	dopocketengrave();
	drawvcarve();
	draw_leads();
	var menit = mround((pockettime + carvetime + totaltime + engravetime + travtime + bitmaptime) / 60.0);
	if (cmd == CMD_CNC) {
		menit *= 2;
	} else { }
	var re = getvalue("repeat");
	var g = getvalue("engcode") + gcodecarve;

	if (g) setvalue("engcode", g + pup1);
	if (cmd == CMD_PLASMA) setvalue("engcode", "");

	var combinedGcode = startgcode + "\n" + getvalue("engcode") + "\n" + getvalue("gcode") + finishgcode;
	var realtimeEst = "";
	try {
		var plannerResult = CncPlanner.calculateJobTime(combinedGcode, defaultConfig);
		realtimeEst = " Real: " + plannerResult.formatted;
		$("realtimetime").innerHTML = plannerResult.formatted;
	} catch (err) {
		console.error("Error calculating real time:", err);
		realtimeEst = " Real: Error";
		$("realtimetime").innerHTML = "Error";
	}

	ctx.font = "15px Courier";
	ctx.fillStyle = theme == 0 ? "#000000" : "#ffffff";;
	td = getvalue('offset');
	if (getchecked("pltmode")) td = "PLT"
	document.getElementById("gcodeinfo").innerHTML = "Width x Height: " + mround1(w) + " x " + mround1(h) + "cm  DOC: " + mround1(getnumber("zdown") / getnumber('repeat')) + "mm x " + getvalue('repeat') + "<br>" +
		"Feed: " + getvalue("feed") + "mm/s, Tool \u2300: " + td + "mm  Est: " + mround1(menit * (cmd == CMD_LASER ? 1 : 0.7)) + " minute" + realtimeEst + "<br>" +
		"Profile: " + getvalue("profilename") + ", Start: " + getvalue('startat');

	if (cmd == CMD_3D) {
		gram = e1 / 333;

		area_dimension.innerHTML = 'Total filament =' + mround(gram) + "gram Time:" + mround(menit) + " menit <br>Total Cost:" + Math.round(gram * hargacut);
	} else {
		mat2 = mat;
		if (getvalue("wmode") == 1) mat2 = "";
		area_dimension.innerHTML = 'Total Length =' + mround2(sfinal) + "mm Time:" + mround2(menit) + " menit <br>CNC Cost:" + Math.ceil(menit * hargacut) + " | Material " + mat2 + ":" + Math.ceil(w * h * harga) + " | TOTAL:" + Math.ceil(menit * hargacut + w * h * harga);
	}
	area_dimension.innerHTML += "<br><b>Tool offset : " + getoffset() + "mm";
	area_dimension.innerHTML += " &nbsp; Start : " + getvalue("startat");

	// Ensure transform is applied after all drawing is done
	if (window.myCanvas1 && window.myCanvas1._redraw) {
		window.myCanvas1._redraw();
	}
}
// ============================================================================
// SECTION: SVG Path Parsing - Part A (svgPathToCommands)
// ============================================================================

function svgPathToCommands(svg) {
	var getd = /(?<= d=").+?(?=")/g;

	var markerRegEx = /[MmLlSsQqLlHhVvCcSsQqTtAaZz]/g;
	var digitRegEx = /-?[0-9]*\.?\d+/g;
	var match = getd.exec(svg);
	if (match == null) return [];
	var str = match[0];

	var results = [];
	var match;
	while ((match = markerRegEx.exec(str)) !== null) {
		results.push(match);
	};
	return results
		.map(function (match) {
			return {
				marker: str[match.index],
				index: match.index
			};
		})
		.reduceRight(function (all, cur) {
			var chunk = str.substring(cur.index, all.length ? all[all.length - 1].index : str.length);
			return all.concat([{
				marker: cur.marker,
				index: cur.index,
				chunk: (chunk.length > 0) ? chunk.substr(1, chunk.length - 1) : chunk
			}]);
		}, [])
		.reverse()
		.map(function (command) {
			var values = command.chunk.match(digitRegEx);
			return {
				marker: command.marker,
				values: values ? values.map(parseFloat) : []
			};
		})
}

// ============================================================================
// SECTION: SVG Path Parsing - Part B (myFunction)
// ============================================================================

function myFunction(scale1) {
	if (text1 == undefined) return;
	// Diingat agar strictPipelineVerify() bisa membandingkan fast path dengan
	// full rebuild memakai mode skala yang sama (myFunction(0) vs myFunction(1)).
	lastPipelineScale1 = scale1 ? 1 : 0;
	mind = getnumber("minR");
	var join = getchecked("enablejoin");
	if (!join) mind = 0.1;

	segsv = [];
	oldlines = [];
	opx = -1000;
	opy = -1000;
	maxofs = 0;
	shapenum = 0;
	oshapenum = -1;
	combinedpath = [];
	leads = [];

	speedplunge = getvalue('pdn');

	if (speedplunge.indexOf("F") > 0) speedplunge = speedplunge.split(" F")[1].split(" ")[0];
	speedretract = getvalue("pup");
	speedtravel = getnumber("trav");
	speedfeed = getnumber("feed");
	if (speedretract.indexOf("F") > 0) {
		zretract = speedretract.split(" Z")[1].split(" ")[0];
		speedretract = speedretract.split(" F")[1].split(" ")[0];
	}
	shapectr = 0;
	var contor = 0;
	var xincep = 0;
	var yincep = 0;
	var p1x = 0;
	var p1y = 0;
	var p2x = 0;
	var p2y = 0;
	e1 = 0;
	var xsfar = 0;
	var ysfar = 0;
	var n1 = 0;
	lines = [];
	var scale = 25.4 / 96;
	if (scale1) scale = 1;
	var scales = getvalue('scale').split(",");
	if (scales.length == 1 && scales[0] == "96") { scales[0] = 1; setvalue('scale', '1'); }
	if (scales.length == 0) scales = [1, 1];
	if (scales.length == 1) scales.push(scales[0]);
	scalex = scale * scales[0];
	scaley = scale * scales[1];

	theme = (typeof appTheme !== 'undefined' && appTheme === 'dark') ? 1 : 0;
	cuttablen = getnumber("tablen") + getnumber("offset");
	cutevery = getnumber("tabevery");
	cutmax = getnumber("tabmax");
	detail = getnumber("curveseg") * 0.2;

	var pw1 = 1;
	var pw2 = 0;
	var pup = getvalue("pup");
	var pdn = getvalue("pdn");
	var f1 = speedtravel * 60;
	var f2 = speedfeed * 60;
	var det = 50 * detail * getnumber('feed') / (60.0 * getnumber("smooth"));
	var seg = getchecked("segment");
	if (seg) det *= 4;
	if (cmd == CMD_FOAM) {
		pw1 = pw2;
		f1 = f2;
	}

	var X1 = 0;
	var Y1 = 0;

	xarea();

	gcodes = [];
	x1 = 0;
	y1 = 0;
	x2 = 0;
	y2 = 0;
	div = "";
	lenmm = 0;
	lenn = 0;

	var cnts = 0;
	line = [];
	isvg = 0;
	for (var i = 0; i < gcstyle.length; i++) {
		gcstyle[i].exchilds = 0;
	}
	warningpath = 0;

	// FAST PATH: Direct Geometry Pipeline (bypasses SVG string regex parsing)
	if (parsedGeometryData && parsedGeometryData.length > 0) {
		console.log("[Geometry Pipeline] Memakai direct cached geometry (" + parsedGeometryData.length + " kontur) - BYPASS regex SVG parsing");
		var userScaleX = scales[0] * 1;
		var userScaleY = scales[1] * 1;
		lastf = f2;

		for (var shp = 0; shp < parsedGeometryData.length; shp++) {
			var shapeObj = parsedGeometryData[shp];
			var pts = shapeObj.points;
			if (!pts || pts.length === 0) continue;

			cnts++;
			line = [];
			div = "";

			xincep = pts[0][0] * userScaleX;
			yincep = pts[0][1] * userScaleY;
			X1 = xincep;
			Y1 = yincep;
			linepush(f1, X1, Y1, 1);
			lenmm = 0;
			lenn = 0;

			for (var k = 1; k < pts.length; k++) {
				var p2x = pts[k][0] * userScaleX;
				var p2y = pts[k][1] * userScaleY;
				linepush(lastf, p2x, p2y);
				xincep = p2x;
				yincep = p2y;
			}

			var isClosed = mind < 0.1 ? false : (shapeObj.closed || (sqr(xincep - X1) + sqr(yincep - Y1) < mind));
			gcodepush(lenmm, X1, Y1, lenmm, line, isClosed);
		}
	} else {
		// FALLBACK PATH: Parse from raw SVG string
		console.log("[Geometry Pipeline] Memakai fallback SVG parser (svgPathToCommands) untuk raw SVG text");
		svgdata = svgPathToCommands(text1);

		for (var isvg = 0; isvg < svgdata.length; isvg++) {
			var el = svgdata[isvg];
			var cr = el.marker;
			if (cr == 'M') {
				cnts = cnts + 1;
				if (cnts > 1) {
					var closed = mind < 0.1 ? false : (sqr(xincep - X1) + sqr(yincep - Y1)) < mind;
					gcodepush(lenmm, X1, Y1, lenmm, line, closed);
				}
				line = [];
				div = "";

				xincep = el.values[0] * scalex;
				yincep = el.values[1] * scaley;
				X1 = xincep;
				Y1 = yincep;
				linepush(f1, X1, Y1, 1);
				lenmm = 0;
				lenn = 0;

				lastf = f2;
			} else if (cr == 'H') {
				var n2 = el.values[0] * scalex;
				var xy = el.values[1] * scaley;
				p1x = xy * scale;
				linepush(f2, p1x, y1);
			} else if (cr == 'V') {
				var n2 = el.values[0] * scalex;
				var xy = el.values[1] * scaley;
				p1y = xy * scale;
				linepush(f2, y1, p1y);
			} else if (cr == 'C') {
				p1x = el.values[0] * scalex;
				p1y = el.values[1] * scaley;
				p2x = el.values[2] * scalex;
				p2y = el.values[3] * scaley;

				xsfar = el.values[4] * scalex;
				ysfar = el.values[5] * scaley;

				var a = p1x - xincep;
				var b = p1y - yincep;
				var a = sqrt(a * a + b * b);

				var b = p2x - p1x;
				var c = p2y - p1y;
				var b = sqrt(b * b + c * c);

				var c = xsfar - p2x;
				var d = ysfar - p2y;
				var c = sqrt(c * c + d * d);

				g = det / (a + b + c);
				a = a + b + c;

				for (i = 0; i < 1; i += g) {
					var x = bezierx(i, xincep, p1x, p2x, xsfar);
					var y = beziery(i, yincep, p1y, p2y, ysfar);
					linepush(lastf, x, y);
				}

				xincep = xsfar;
				yincep = ysfar;
			} else if (cr == 'L') {
				for (var k = 0; k < el.values.length / 2; k++) {
					p2x = el.values[0 + k * 2] * scalex;
					p2y = el.values[1 + k * 2] * scaley;
					linepush(lastf, p2x, p2y);
					xincep = p2x;
					yincep = p2y;
				}
			}
		}

		if (cnts > 0) {
			var closed = mind < 0.1 ? false : (sqr(xincep - X1) + sqr(yincep - Y1)) < mind;
			gcodepush(lenmm, X1, Y1, lenmm, line, closed);
		}
	}

	// Kunci batas geometri DI SINI (Stage A), bukan di sortGcodes(), supaya
	// Tier B (refreshgcodeSort) dan Tier C (refreshgcodeFast) mewarisi nilai yang
	// persis sama dengan full rebuild terakhir. Nilai xmax/xmin/ymax/ymin di titik
	// ini identik dengan yang dulu dibaca sortGcodes(), karena gcodepushcombined()
	// tidak menyentuhnya.
	sxmax = xmax;
	symax = ymax;
	sxmin = xmin;
	symin = ymin;

	gcodepushcombined();
	sortedgcode();
	gcode_verify(1);
	var gc = getvalue("engcode") + cut_eng;
	setvalue("engcode", gc);

	// Full rebuild selesai: cache geometri (gcodes) dan cache urutan (sgcodes)
	// sekarang konsisten dengan parameter UI saat ini. Dipakai oleh smartProcess()
	// untuk memilih tier termurah pada klik "Process" berikutnya.
	if (typeof markPipelineSnapshots === "function") markPipelineSnapshots();
}
// ============================================================================
// SECTION: Spatial-Hash Helpers
// ============================================================================
//
// Generic 2-D spatial-hash. Items are placed into uniform cells; a query
// (x,y,radius) walks the 3×3 neighbourhood and returns the items whose
// position (read via getX/getY) is within radius. Coordinates and items
// can be in any system (unscaled user units, scaled-1000 pixel units, ...);
// the cell size is supplied by the caller.
//
// buildSpatialGrid(items, getX, getY, cellSize)
//     returns { grid, cellSize, items }
//     grid: Object map  "cx,cy" -> [itemIdx, ...]
//
// gridQueryCells(grid, x, y, cellSize)
//     returns flat list of indices in the 3x3 cells around (x,y)
//
// gridNearestK(grid, x, y, k, getX, getY, maxRadius)
//     returns up to k closest items by squared distance, capped at maxRadius.
//     If maxRadius <= 0 the radius check is skipped (O(per-cell) scan).
//
// All helpers are pure functions of the inputs. They never mutate the
// items array and never read module-level state.

function buildSpatialGrid(items, getX, getY, cellSize) {
	var grid = Object.create(null);
	var cs = cellSize > 0 ? cellSize : 1;
	for (var i = 0; i < items.length; i++) {
		var ix = getX(items[i], i);
		var iy = getY(items[i], i);
		var cx = Math.floor(ix / cs);
		var cy = Math.floor(iy / cs);
		var k = cx + "," + cy;
		if (!grid[k]) grid[k] = [];
		grid[k].push(i);
	}
	return { grid: grid, cellSize: cs, items: items };
}

function gridQueryCells(gridObj, x, y) {
	var cs = gridObj.cellSize;
	var ccx = Math.floor(x / cs);
	var ccy = Math.floor(y / cs);
	var out = [];
	var g = gridObj.grid;
	for (var dx = -1; dx <= 1; dx++) {
		for (var dy = -1; dy <= 1; dy++) {
			var cell = g[(ccx + dx) + "," + (ccy + dy)];
			if (!cell) continue;
			for (var i = 0; i < cell.length; i++) out.push(cell[i]);
		}
	}
	return out;
}

function gridNearestK(gridObj, x, y, k, getX, getY, maxRadius) {
	var cands = gridQueryCells(gridObj, x, y);
	if (cands.length === 0) return [];
	var best = [];
	var bestD2 = [];
	var r2 = maxRadius > 0 ? maxRadius * maxRadius : -1;
	for (var i = 0; i < cands.length; i++) {
		var idx = cands[i];
		var ix = getX(gridObj.items[idx], idx);
		var iy = getY(gridObj.items[idx], idx);
		var dxs = x - ix, dys = y - iy;
		var d2 = dxs * dxs + dys * dys;
		if (r2 > 0 && d2 > r2) continue;
		// Insertion into top-k (smallest distance)
		if (best.length < k) {
			best.push(idx); bestD2.push(d2);
			// bubble up
			for (var j = best.length - 1; j > 0 && bestD2[j - 1] > bestD2[j]; j--) {
				var ti = best[j]; best[j] = best[j - 1]; best[j - 1] = ti;
				var td = bestD2[j]; bestD2[j] = bestD2[j - 1]; bestD2[j - 1] = td;
			}
		} else if (d2 < bestD2[best.length - 1]) {
			best[best.length - 1] = idx; bestD2[best.length - 1] = d2;
			for (var j2 = best.length - 1; j2 > 0 && bestD2[j2 - 1] > bestD2[j2]; j2--) {
				var ti2 = best[j2]; best[j2] = best[j2 - 1]; best[j2 - 1] = ti2;
				var td2 = bestD2[j2]; bestD2[j2] = bestD2[j2 - 1]; bestD2[j2 - 1] = td2;
			}
		}
	}
	return best;
}

function gridQueryAll(gridObj, x, y, getX, getY, maxRadius) {
	var cands = gridQueryCells(gridObj, x, y);
	if (cands.length === 0) return [];
	var r2 = maxRadius > 0 ? maxRadius * maxRadius : -1;
	var out = [];
	for (var i = 0; i < cands.length; i++) {
		var idx = cands[i];
		var ix = getX(gridObj.items[idx], idx);
		var iy = getY(gridObj.items[idx], idx);
		var dxs = x - ix, dys = y - iy;
		if (r2 > 0 && dxs * dxs + dys * dys > r2) continue;
		out.push(idx);
	}
	return out;
}

// Expanding-ring query. Starts with the 3x3 cell neighbourhood; if the
// caller asks for more items than were found, expands the search one cell
// at a time (L-infinity ring of radius r) until either the request is
// satisfied or no new items are found in a full ring. Returns at most
// maxItems unique item indices.
//
// This is the safe replacement for gridQueryCells when the grid cell size
// is not guaranteed to cover the query radius.
function gridQueryRing(gridObj, x, y, maxItems, maxR) {
	if (!gridObj || !gridObj.grid) return [];
	var cs = gridObj.cellSize;
	var ccx0 = Math.floor(x / cs);
	var ccy0 = Math.floor(y / cs);
	var g = gridObj.grid;
	var seen = Object.create(null);
	var out = [];
	if (maxItems <= 0) maxItems = 1e9;
	// If maxR is provided, the caller is bounding the search to a known
	// radius. Otherwise, use the precomputed grid extent (cached on
	// gridObj at build time). Fall back to scanning keys if no cached
	// extent is available.
	if (maxR === undefined || maxR === null || maxR < 0) {
		if (gridObj.minCx !== undefined) {
			maxR = Math.max(gridObj.maxCx - ccx0, ccx0 - gridObj.minCx,
				gridObj.maxCy - ccy0, ccy0 - gridObj.minCy) + 1;
		} else {
			maxR = 0;
			var minCx = Infinity, maxCx = -Infinity, minCy = Infinity, maxCy = -Infinity;
			for (var _k in g) {
				var _comma = _k.indexOf(",");
				var _cx = +_k.substring(0, _comma);
				var _cy = +_k.substring(_comma + 1);
				if (_cx < minCx) minCx = _cx;
				if (_cx > maxCx) maxCx = _cx;
				if (_cy < minCy) minCy = _cy;
				if (_cy > maxCy) maxCy = _cy;
			}
			maxR = Math.max(maxCx - ccx0, ccx0 - minCx, maxCy - ccy0, ccy0 - minCy) + 1;
		}
		if (!isFinite(maxR) || maxR < 1) maxR = 1;
	}
	// Walk the L-infinity ring outward. We do NOT break on empty rings:
	// a sparse grid has many empty rings but still contains items far
	// from the query. The cost of visiting empty cells is one map
	// lookup each, which is far cheaper than running the per-item
	// distance test in a full O(N) scan.
	for (var r = 0; r <= maxR; r++) {
		for (var dx = -r; dx <= r; dx++) {
			for (var dy = -r; dy <= r; dy++) {
				if (r > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
				var cell = g[(ccx0 + dx) + "," + (ccy0 + dy)];
				if (!cell) continue;
				for (var ci = 0; ci < cell.length; ci++) {
					var idx = cell[ci];
					if (seen[idx]) continue;
					seen[idx] = 1;
					out.push(idx);
					if (out.length >= maxItems) return out;
				}
			}
		}
	}
	return out;
}

// ============================================================================
// SECTION: SVG Path Parsing - Part C (pathstoText1)
// ============================================================================

// ============================================================================
// SECTION: Combine segment (enablejoin + minR) helpers
// ============================================================================
// Used only by the `if (join)` block of pathstoText1. `mind` is the UI "R"
// field and is a SQUARED distance threshold, hence every linear tolerance
// below is derived with sqrt(). Geometry is in document units (mm).

// Number of segments at the END of the chain that the join guard inspects.
// A wrong weld happens at the joint, so a window keeps very long chains
// cheap; raise it if a crossing far from the joint ever has to be caught.
var JOIN_GUARD_WINDOW = 400;

// Polyline length.
function jcPolyLen(pts) {
	var l = 0;
	for (var i = 1; i < pts.length; i++) {
		var dx = pts[i][0] - pts[i - 1][0];
		var dy = pts[i][1] - pts[i - 1][1];
		l += Math.sqrt(dx * dx + dy * dy);
	}
	return l;
}

// Axis aligned bounding box of a polyline -> [x1, y1, x2, y2].
function jcBounds(pts) {
	var b = [1e18, 1e18, -1e18, -1e18];
	for (var i = 0; i < pts.length; i++) {
		if (pts[i][0] < b[0]) b[0] = pts[i][0];
		if (pts[i][1] < b[1]) b[1] = pts[i][1];
		if (pts[i][0] > b[2]) b[2] = pts[i][0];
		if (pts[i][1] > b[3]) b[3] = pts[i][1];
	}
	return b;
}

// Bounding box overlap test, `g` = extra margin.
function jcBoxHit(a, b, g) {
	return !(a[0] - g > b[2] || b[0] - g > a[2] || a[1] - g > b[3] || b[1] - g > a[3]);
}

// Squared distance from point p to segment a-b.
function jcPtSegD2(px, py, ax, ay, bx, by) {
	var vx = bx - ax;
	var vy = by - ay;
	var wx = px - ax;
	var wy = py - ay;
	var vv = vx * vx + vy * vy;
	var t = vv > 0 ? (wx * vx + wy * vy) / vv : 0;
	if (t < 0) t = 0;
	else if (t > 1) t = 1;
	var dx = px - ax - t * vx;
	var dy = py - ay - t * vy;
	return dx * dx + dy * dy;
}

// True when polyline `q` lies on polyline `p` within sqrt(tol2), segment by
// segment: for every segment of q the nearest segment of p must be within
// tolerance, and both ends plus the quarter points of that q segment must stay
// on that SAME p segment. Testing vertices only is not enough: a diagonal whose
// two ends touch two different parts of p would otherwise be deleted.
function jcLiesOn(q, p, tol2) {
	if (p.length < 2 || q.length < 2) return false;
	for (var i = 0; i + 1 < q.length; i++) {
		var x0 = q[i][0];
		var y0 = q[i][1];
		var x1 = q[i + 1][0];
		var y1 = q[i + 1][1];
		var mx = (x0 + x1) * 0.5;
		var my = (y0 + y1) * 0.5;
		var best = -1;
		var bd = 1e18;
		for (var j = 0; j + 1 < p.length; j++) {
			var d = jcPtSegD2(mx, my, p[j][0], p[j][1], p[j + 1][0], p[j + 1][1]);
			if (d < bd) {
				bd = d;
				best = j;
			}
		}
		if (best < 0 || bd >= tol2) return false;
		var ax = p[best][0];
		var ay = p[best][1];
		var bx = p[best + 1][0];
		var by = p[best + 1][1];
		if (jcPtSegD2(x0, y0, ax, ay, bx, by) >= tol2) return false;
		if (jcPtSegD2(x1, y1, ax, ay, bx, by) >= tol2) return false;
		if (jcPtSegD2(x0 + (x1 - x0) * 0.25, y0 + (y1 - y0) * 0.25, ax, ay, bx, by) >= tol2) return false;
		if (jcPtSegD2(x0 + (x1 - x0) * 0.75, y0 + (y1 - y0) * 0.75, ax, ay, bx, by) >= tol2) return false;
	}
	return true;
}

// Duplicate test used by PASS 1.
// Vertex by vertex match in either direction (this keeps the previous 2-point
// semantics unchanged), or one polyline lying on top of the other, which is the
// CAD case where an edge is drawn again, fully or partially. The vertex match
// runs first so exact duplicates are never mis-classified.
function jcIsDup(a, b, tol2) {
	if (a.length < 2 || b.length < 2) return 0;
	if (a.length == b.length) {
		var fwd = 1;
		var rev = 1;
		for (var i = 0; i < a.length; i++) {
			var j = a.length - 1 - i;
			if (fwd && (sqr(a[i][0] - b[i][0]) + sqr(a[i][1] - b[i][1])) >= tol2) fwd = 0;
			if (rev && (sqr(a[i][0] - b[j][0]) + sqr(a[i][1] - b[j][1])) >= tol2) rev = 0;
			if (!fwd && !rev) break;
		}
		if (fwd || rev) return 1;
	}
	return (jcLiesOn(a, b, tol2) || jcLiesOn(b, a, tol2)) ? 1 : 0;
}

// First segment of `pts` in the orientation it would be appended with
// (rev = 1 means the polyline gets reversed before the append).
function jcFirstSeg(pts, rev) {
	if (rev) return [pts[pts.length - 1], pts[pts.length - 2]];
	return [pts[0], pts[1]];
}

// Overlap length of two segments that lie on the same line within `eps`
// (0 when they are not collinear). Used to spot a line being cut twice.
function jcOverlapLen(ax, ay, bx, by, cx, cy, dx, dy, eps) {
	var ux = bx - ax;
	var uy = by - ay;
	var ul = Math.sqrt(ux * ux + uy * uy);
	if (ul < 1e-12) return 0;
	var vx = dx - cx;
	var vy = dy - cy;
	var vl = Math.sqrt(vx * vx + vy * vy);
	if (vl < 1e-12) return 0;
	ux /= ul;
	uy /= ul;
	vx /= vl;
	vy /= vl;
	if (Math.abs((cx - ax) * uy - (cy - ay) * ux) > eps) return 0;
	if (Math.abs((dx - ax) * uy - (dy - ay) * ux) > eps) return 0;
	if (Math.abs((ax - cx) * vy - (ay - cy) * vx) > eps) return 0;
	if (Math.abs((bx - cx) * vy - (by - cy) * vx) > eps) return 0;
	var tc = ((cx - ax) * ux + (cy - ay) * uy) / ul;
	var td = ((dx - ax) * ux + (dy - ay) * uy) / ul;
	var lo = tc < td ? tc : td;
	var hi = tc < td ? td : tc;
	if (lo < 0) lo = 0;
	if (hi > 1) hi = 1;
	return (hi - lo) * ul;
}

// Proper (transversal) crossing of segment a-b and c-d. Touching and
// collinear cases return 0; jcOverlapLen() covers those.
function jcCross(ax, ay, bx, by, cx, cy, dx, dy) {
	var o1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
	var o2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
	var o3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
	var o4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
	if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
		((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return 1;
	return 0;
}

// Parameter t of the intersection point of the infinite lines a-b and c-d,
// measured along a-b (NaN when the lines are parallel).
function jcCrossT(ax, ay, bx, by, cx, cy, dx, dy) {
	var ux = bx - ax;
	var uy = by - ay;
	var vx = dx - cx;
	var vy = dy - cy;
	var den = ux * vy - uy * vx;
	if (den === 0) return NaN;
	return ((cx - ax) * vy - (cy - ay) * vx) / den;
}

// Join guard: returns 0 when appending `cand` (already oriented the way it
// would be appended) would cross or retrace a line that is already part of
// `chain`. A crossing that lands within `eps` of the junction is the snap of
// the joint itself and stays allowed; the retrace test always applies, that is
// the join which doubles back and cuts the same line twice.
function jcJoinAllowed(chain, cand, eps, window) {
	var cN = cand.length - 1;
	var pN = chain.length - 1;
	if (cN < 1 || pN < 1) return 1;
	var pxj = chain[pN][0];
	var pyj = chain[pN][1];
	var eps2 = eps * eps;
	var pStart = 0;
	if (window > 0 && pN > window) pStart = pN - window;
	for (var ci = 0; ci < cN; ci++) {
		var ax = cand[ci][0];
		var ay = cand[ci][1];
		var bx = cand[ci + 1][0];
		var by = cand[ci + 1][1];
		if (ax == bx && ay == by) continue;
		for (var pi = pStart; pi < pN; pi++) {
			var cx = chain[pi][0];
			var cy = chain[pi][1];
			var dx = chain[pi + 1][0];
			var dy = chain[pi + 1][1];
			if (cx == dx && cy == dy) continue;
			if (jcOverlapLen(ax, ay, bx, by, cx, cy, dx, dy, eps) > eps) return 0;
			if (!jcCross(ax, ay, bx, by, cx, cy, dx, dy)) continue;
			var t = jcCrossT(ax, ay, bx, by, cx, cy, dx, dy);
			if (isFinite(t)) {
				var ix = ax + t * (bx - ax) - pxj;
				var iy = ay + t * (by - ay) - pyj;
				if (ix * ix + iy * iy <= eps2) continue;
			}
			return 0;
		}
	}
	return 1;
}

function pathstoText1(gx) {
	cache_ink_img = [];
	mind = getnumber("minR");

	// Invalidate spatial-hash indices at the start of every pathstoText1
	// call so stale data from a prior SVG never bleeds through.
	// cuttabGrid = null;
	// starttabGrid = null;

	var join = getchecked("enablejoin");
	gcstyle = [];
	gs = gx.split("\n");
	var scale = 96 / 25.4;
	var cflipx = 1;
	var cflipy = 1;
	ink_images = [];

	var c = 0;
	var sc = 0;
	var t1 = '';
	var tm = "";
	var wd = {
		'g': -1,
		'x': 0,
		'y': 0
	};
	var xy1 = '';
	var xmax = -100000;
	var xmin = 100000;
	var ymax = -100000;
	var ymin = 100000;
	var dangle = 0;
	var sty = {
		"fill": "#000000",
		"stroke": "#000000",
		"stroke-width": 0,
		"deep": undefined,
		"repeat": undefined,
		ratio: 1,
		error: 0,
		flip: false,
		halfDPI: 0,
		cuttab: 0,
		doEngrave: 0,
		domarking: 0,
		dovcarve: 0,
		dopocket: 0,
		greenskip: 0,
		bound: 0,
		greentravel: 0,
		sortadd: 0,
		angle: dangle
	};
	var inimg = 0;
	var inpath = 0;
	var paths = [];
	var path = [];
	var ox = 0;
	var oy = 0;
	var fx = 0;
	var fy = 0;
	var cx, cy;
	var xzero = 0;
	var yzero = 0;
	var czero = 0;
	var sum = 0;
	var ln = 0;
	var yellow, dyellow, outer;
	var flips = [];
	var xmi, xma, ymi, yma;
	imgX = 0;
	imgY = 0;
	var xyscale = 1.0;
	var imgdata = "";
	for (var i in gs) {
		var lns = gs[i];
		if (!inimg) {
			if (lns[0] == "P") {
				var ss = lns.split(":");
				inpath = 0;
				path = [];
				sty["fill"] = ss[1];
				yellow = (ss[1] == "#ffff00") || (ss[2] == "#ffff00")
				dyellow = (ss[1] == "#808000") || (ss[2] == "#808000")
				outer = !yellow
				sty["stroke"] = ss[2];
				sty["stroke-width"] = parseFloat(ss[3]);
				continue;

			} else if (lns[0] == "X") {
				var ss = lns.split(":");
				xyscale = ss[1] * 1;
				continue;

			} else if (lns[0] == "K") {
				var ss = lns.split(",");
				imgX = ss[1] * xyscale;
				imgY = ss[2] * xyscale;
				continue;

			} else if (lns[0] == "I") {
				var ss = lns.split(",");
				inimg = 1;
				if (ss.length > 6) ss[5] = ss[5] + "," + ss[6];
				imagetr = getMatrix(ss[5]);
				var p0 = mx1([ss[1], ss[2]], imagetr);
				imagex = p0[0] - imgX;
				imagey = p0[1] - imgY;

				imagew = ss[3];
				imageh = ss[4];
				imgdata = "";
				continue;
			}
		}

		{
			if (lns == "") {
				if (inimg) {
					ink_images.push([imagex * 1, imagey * 1, imagew * 1, imageh * 1, imgdata, imagetr]);
					inimg = 0;

				} else if (inpath > 1) {
					flip = yellow


					var closed = path.length > 2 && (sqr(ox - fx) + sqr(oy - fy) < mind);
					sty.childs = 0;
					sty.closed = closed;
					paths.push([path, flip, 0, 0, 0, 0, 0, 0, closed, sty]);
					sty.num = gcstyle.length;
					gcstyle.push(sty);
					inpath = 0;
					sty = {
						"fill": "#000000",
						"stroke": "#000000",
						"stroke-width": 0,
						"deep": undefined,
						"repeat": undefined,
						"angle": dangle
					};
				}
			} else {
				if (inimg) {
					imgdata += lns;

				} else {
					inpath++;
					var valid = 1;
					var ss = lns.split(",");
					var x = parseFloat(ss[0]) * xyscale;
					var y = parseFloat(ss[1]) * xyscale;
					if (inpath == 1) {
						fx = x;
						fy = y;
					} else {
						valid = !(sqr(ox - x) + sqr(oy - y) < 0.001);
					}
					if (valid) {
						path.push([x, y]);
						ox = x;
						oy = y;
					}
				}
			}
		}



	}

	if (join) {
		// ------------------------------------------------------------------
		// PASS 1 - duplicate prune.
		// CAD exports routinely draw the same edge twice. A path counts as a
		// duplicate of another one when its vertices match one by one (forward
		// or reversed) within the join tolerance, or when it lies on top of the
		// other one. The LONGER path always survives, the shorter is emptied.
		// Closed paths are left untouched (dedupe only here, no chaining).
		// ------------------------------------------------------------------
		var dupTol = mind;
		var dupLin = Math.sqrt(dupTol);
		if (!isFinite(dupLin) || dupLin < 0) dupLin = 0;
		var np = paths.length;
		var pBox = new Array(np);
		var pLen = new Array(np);
		for (var bi = 0; bi < np; bi++) {
			var bp = paths[bi][0];
			if (bp.length >= 2) {
				pBox[bi] = jcBounds(bp);
				pLen[bi] = jcPolyLen(bp);
			}
		}
		for (var i in paths) {
			var pa = paths[i];
			if (pa[0].length < 2) continue;
			if (pa[8]) continue;
			for (var ii in paths) {
				if (i == ii) continue;
				var p = paths[ii];
				if (p[0].length < 2) continue;
				if (p[8]) continue;
				if (p[9].stroke != pa[9].stroke) continue;
				if (!jcBoxHit(pBox[i], pBox[ii], dupLin)) continue;
				if (!jcIsDup(pa[0], p[0], dupTol)) continue;
				if (pLen[ii] > pLen[i]) {
					pa[0] = [];
					break;
				}
				p[0] = [];
			}
		}

		// ------------------------------------------------------------------
		// PASS 2 - chaining.
		// Acceptance tolerance is unchanged from the original code
		// (squared distance < mind + 0.1). joinEps is the linear joint /
		// degeneracy epsilon used by the two guards below: 1.2x the linear
		// join tolerance, so a joint snap and a redrawn edge are both caught
		// while normal joins are left alone.
		// ------------------------------------------------------------------
		var joinTol = mind + 0.1;
		var joinEps = Math.sqrt(joinTol);
		if (!isFinite(joinEps) || joinEps <= 0) joinEps = 0.5;
		joinEps *= 1.2;
		var joined = 1;
		while (joined) {
			joined = 0;
			for (var i in paths) {
				var pa = paths[i];
				if (pa[0].length <= 1) continue;
				if (pa[8]) continue;
				while (1) {
					var idp = -1;
					var ox = pa[0][pa[0].length - 1][0];
					var oy = pa[0][pa[0].length - 1][1];
					var cands = [];
					for (var ii in paths) {
						if (i == ii) continue;
						var p = paths[ii];
						if (p[0].length == 0) continue;
						if (p[9].stroke != pa[9].stroke) continue;
						if (p[8]) continue;
						var p1 = p[0][0];
						var p2 = p[0][p[0].length - 1];
						var d1 = sqr(p1[0] - ox) + sqr(p1[1] - oy);
						var d2 = sqr(p2[0] - ox) + sqr(p2[1] - oy);
						if (d1 < joinTol) cands.push([d1, ii, 0]);
						if (d2 < joinTol) cands.push([d2, ii, 1]);
					}
					// P2 - two candidates at the same joint that are equally close
					// and overlap each other: keep the longer, delete the shorter.
					for (var ca = 0; ca < cands.length; ca++) {
						if (cands[ca][1] < 0) continue;
						var pa1 = paths[cands[ca][1]][0];
						if (pa1.length < 2) {
							cands[ca][1] = -1;
							continue;
						}
						for (var cb = ca + 1; cb < cands.length; cb++) {
							if (cands[cb][1] < 0) continue;
							if (cands[cb][1] == cands[ca][1]) continue;
							var pb1 = paths[cands[cb][1]][0];
							if (pb1.length < 2) continue;
							var dA = Math.sqrt(cands[ca][0]);
							var dB = Math.sqrt(cands[cb][0]);
							if (Math.abs(dA - dB) > joinEps) continue;
							var segA = jcFirstSeg(pa1, cands[ca][2]);
							var segB = jcFirstSeg(pb1, cands[cb][2]);
							if (jcOverlapLen(segA[0][0], segA[0][1], segA[1][0], segA[1][1],
								segB[0][0], segB[0][1], segB[1][0], segB[1][1], joinEps) <= joinEps) continue;
							var del = (jcPolyLen(pb1) > jcPolyLen(pa1)) ? ca : cb;
							var keep = (del == ca) ? pb1 : pa1;
							var drop = (del == ca) ? pa1 : pb1;
							// only drop the shorter one when the kept one really covers it,
							// otherwise unique geometry would disappear with it
							if (!jcLiesOn(drop, keep, dupTol)) continue;
							paths[cands[del][1]][0] = [];
							cands[del][1] = -1;
							if (del == ca) break;
						}
					}
					// P3 - try the nearest candidate first. A candidate that would
					// cross or retrace a line already joined into this chain is
					// skipped, the next candidate gets a chance.
					cands.sort(function (x, y) { return x[0] - y[0]; });
					for (var cc = 0; cc < cands.length; cc++) {
						var idc = cands[cc][1];
						if (idc < 0) continue;
						var pc = paths[idc];
						if (pc[0].length == 0) continue;
						var app = cands[cc][2] ? pc[0].slice().reverse() : pc[0];
						if (!jcJoinAllowed(pa[0], app, joinEps, JOIN_GUARD_WINDOW)) continue;
						pa[0] = pa[0].concat(app);
						pc[0] = [];
						idp = idc;
						joined++;
						break;
					}
					if (idp < 0) break;
				}
			}
		}
	}
	var npaths = [];
	cuttabs = [];
	starttabs = [];
	xma = -1000000;
	xmi = 1000000;
	yma = -1000000;
	ymi = 1000000;
	engravebounds = [];
	for (var i in paths) {
		var sty = paths[i][9];
		var stro = sty["stroke"];
		var cuttab = (stro == "#800000");
		var starttab = false;//(stro == "#550000");
		var centerpos = (stro == "#008080");
		var engravebound = (stro == "#ffff00");
		var cp = paths[i][0];
		if (centerpos && cp.length == 2) {
			starttab = true;
			centerpos = false;
		}
		if (cuttab) {
			if (cp.length == 2) cuttabs.push([cp[0], cp[cp.length - 1]]);
			continue;
		}
		if (starttab) {
			if (cp.length >= 2) starttabs.push([cp[0], cp[cp.length - 1]]);
			continue;
		}
		if (engravebound) {
			var pa = cp;
			if (pa.length > 2) {
				engravebounds.push(paths[i]);
				paths[i][1] = isClockwise(pa);
			}
			sty["stroke"] = "#00FF00";
			sty.greenskip = 1;
			sty.bound = 1;
		}
		if (centerpos) {
			var ps = cp;
			var xmin = 1000000, xmax = -1000000;
			var ymin = 1000000, ymax = -1000000;

			for (var j = 0; j < ps.length; j++) {
				var p = ps[j];
				xmin = Math.min(xmin, p[0]);
				xmax = Math.max(xmax, p[0]);
				ymin = Math.min(ymin, p[1]);
				ymax = Math.max(ymax, p[1]);
			}

			if (ps.length > 0) {
				xzero += (xmin + xmax) / 2;
				yzero += (ymin + ymax) / 2;
				czero += 1;
			}
			continue;
		}
		if (paths[i][0].length > 0) {
			var pa = paths[i];
			var ps = pa[0];
			bx1 = 10000;
			bx2 = -10000;
			by1 = 10000;
			by2 = -10000;

			for (j in ps) {
				var p = ps[j];
				var x = p[0];
				var y = p[1];
				xmi = Math.min(x, xmi);
				xma = Math.max(x, xma);
				ymi = Math.min(y, ymi);
				yma = Math.max(y, yma);
				bx1 = Math.min(x, bx1);
				bx2 = Math.max(x, bx2);
				by1 = Math.min(y, by1);
				by2 = Math.max(y, by2);
			}
			if (sqr(bx2 - bx1) + sqr(by2 - by1) > mind*0.8) npaths.push(paths[i]);
		}
	}
	paths = npaths;
	var xofs = xmi;
	var yofs = ymi;
	var in_w = xma - xmi;
	var in_h = yma - ymi;

	for (var i in cuttabs) {
		var p = cuttabs[i];
		p[0][0] -= xofs;
		p[0][1] -= yofs;
		p[1][0] -= xofs;
		p[1][1] -= yofs;

	}
	for (var i in starttabs) {
		var p = starttabs[i];
		p[0][0] -= xofs;
		p[0][1] -= yofs;
		p[1][0] -= xofs;
		p[1][1] -= yofs;

	}
	virtualStartPoints = [];
	for (var i in paths) {
		var ps = paths[i][0];
		var closed = paths[i][8];
		var vpoints = [];

		if (closed && starttabs.length > 0) {
			for (var k = 0; k < starttabs.length; k++) {
				var p1 = starttabs[k][0];
				var p2 = starttabs[k][1];

				for (var e = 0; e < ps.length - 1; e++) {
					var si = intersects_p(p1[0], p1[1], p2[0], p2[1],
						ps[e][0], ps[e][1], ps[e + 1][0], ps[e + 1][1]);
					if (si !== null) {
						var ix = ps[e][0] + si * (ps[e + 1][0] - ps[e][0]);
						var iy = ps[e][1] + si * (ps[e + 1][1] - ps[e][1]);
						vpoints.push([ix, iy]);

						// // Insert point ke path setelah index e
						// ps.splice(e + 1, 0, [ix, iy]);
						// e++; // skip inserted point untuk iterasi berikutnya
					}
				}
			}
		}
		virtualStartPoints.push({
			points: vpoints,
			realPointCache: null  // lazy computed
		});
	}
	// Build spatial-hash indices for cuttab and starttab segments so the
	// O(E·T) intersection scan in prepare_line2 becomes O(E·k). Each entry
	// in arr is [p1, p2], indexed by segment midpoint. Cell size = 1.0
	// (matches the typical pathstoText1 "minR" magnitude). The lookup in
	// prepare_line2 uses gridQueryRing which expands the search to cover
	// far-away tabs, preserving the original "test all tabs against all
	// edges" semantic.
	{
		function _buildTabGrid(arr) {
			var _tabCell = 1.0;
			var items = new Array(arr.length);
			var midX = new Float64Array(arr.length);
			var midY = new Float64Array(arr.length);
			for (var _ti = 0; _ti < arr.length; _ti++) {
				items[_ti] = arr[_ti];
				midX[_ti] = (arr[_ti][0][0] + arr[_ti][1][0]) * 0.5;
				midY[_ti] = (arr[_ti][0][1] + arr[_ti][1][1]) * 0.5;
			}
			var _g = Object.create(null);
			for (var _ti2 = 0; _ti2 < arr.length; _ti2++) {
				var _ccx = Math.floor(midX[_ti2] / _tabCell);
				var _ccy = Math.floor(midY[_ti2] / _tabCell);
				var _k = _ccx + "," + _ccy;
				if (!_g[_k]) _g[_k] = [];
				_g[_k].push(_ti2);
			}
			return { grid: _g, cellSize: _tabCell, items: items, midX: midX, midY: midY };
		}
		// if (cuttabs.length > 0) cuttabGrid = _buildTabGrid(cuttabs);
		// if (starttabs.length > 0) starttabGrid = _buildTabGrid(starttabs);
	}

	for (var i in paths) {
		var pa = paths[i];
		var ps = pa[0];
		cx = 0;
		cy = 0;
		sum = 0;
		xma = -1000000;
		xmi = 1000000;
		yma = -1000000;
		ymi = 1000000;
		var ox = ps[ps.length - 1][0];
		var oy = ps[ps.length - 1][1];
		var j = 0;
		for (j in ps) {
			var p = ps[j];
			p[0] -= xofs;
			p[1] -= yofs;
			var x = p[0];
			var y = p[1];
			xmi = Math.min(x, xmi);
			xma = Math.max(x, xma);
			ymi = Math.min(y, ymi);
			yma = Math.max(y, yma);
			if (j > 0) {
				cx += x;
				cy += y;
				sum -= (ox - x) * (oy + y);
			}
			ox = x;
			oy = y;
		}
		ln = sqrt(sqr(xma - xmi) + sqr(yma - ymi));
		if (sum < 0) paths[i][1] = !paths[i][1];
		paths[i][2] = cx / j;
		paths[i][3] = cy / j;
		paths[i][4] = ln;
		paths[i][6] = xma - xmi;
		paths[i][7] = yma - ymi;
	}
	var etime = new Date();
	var ms = etime.getTime();


	// Note: parent/child (inside/outside) detection below uses a brute-
	// force O(n^2) loop on purpose. A 3x3 spatial-hash optimization was
	// tried here but produced wrong results for layouts where a small
	// path sits inside a much larger one (e.g. 1 box with 4 holes): the
	// 3x3 cell window around the small path's centroid could miss the
	// large outer path, leaving the small path's "flip" state unchanged
	// and reporting it as outside. Correctness here is critical — this
	// drives cut direction and tab placement, so a wrong flip can ruin
	// the workpiece. The brute-force loop is O(n^2) but `isInside` and
	// the radius filter keep it fast enough for typical CNC jobs.

	for (i in paths) {
		var path = paths[i][0];
		var sty = paths[i][9];
		var stro = sty["stroke"];
		var fill = sty["fill"];
		if (stro == "#ffff00") {
			stro = "#000000";
			fill = "#ffff00";
			sty["stroke"] = stro;
			sty["fill"] = fill;
		}
	}
	for (i in paths) {
		var path = paths[i][0];
		var sty = paths[i][9];
		var stro = sty["stroke"];
		var fill = sty["fill"];

		if (stro == "#808000") {
			gray = (16 * parseInt(15 - parseInt("0x" + fill.substr(3, 2)) / 17)).toString(16);
			if (gray.length == 1) gray = "0" + gray;
			stro = "#00" + gray + "ff";
			sty["stroke"] = stro;
		}
		sty.closed = mind < 0.1 ? false : sqrt(sqr(path[0][0] - path[path.length - 1][0]) + sqr(path[0][1] - path[path.length - 1][1])) < mind;
		sty.deep = paths[i][5].length;
		sty.doEngrave = (RBcolor(stro) == "00ff") || (RBcolor(stro) == "0080");
		sty.halfDPI = (RBcolor(stro) == "0080");
		if (sty.doEngrave)
			sty.angle = parseInt("0x" + stro.substr(3, 2));
		sty.domarking = (RBcolor(stro) == "ff00");
		sty.isblack = (RBcolor(stro) == "0000");

		sty.markpower = 0;
		if (sty.domarking && (cmd == CMD_LASER))
			sty.markpower = parseInt("0x" + stro.substr(3, 2));
		sty.dovcarve = (stro == "#00ffff");
		sty.dopocket = (RBcolor(stro) == "8080");
		sty.cuttab = (paths[i][0].length == 2) && (stro == "#800000");
		sty.isCuttab = 0;
		sty.flip = paths[i][1];
		sty.sortadd = 0;
		if (RBcolor(stro) == "2b00") { sty.isblack = true; sty.sortadd = 100000; }

		sty.greenskip = sty.greenskip || sty.cuttab || (stro == "#00ff00") || (fill == "#00ff00");
		sty.greentravel = (stro == "#008000") || (fill == "#008000");
		sty.strokedee = 0;
		if ((cmd == CMD_CNC))
			sty.strokedeep = parseInt("0x" + stro.substr(3, 2)) * 0.1;
		sty.ratio = 0;
		sty.error = 0;
		sty.issort = 0;
		var parent = [];
		if (!((sty.greenskip && !sty.bound))) {
			sty.issort = 1;
			var flip = paths[i][1];
			cx = paths[i][2];
			cy = paths[i][3];
			var l1 = paths[i][4];
			pocket1 = sty.dopocket;
			bound1 = sty.bound;
			carve1 = sty.dovcarve;
			for (ii in paths) {
				psty = paths[ii][9];
				if (!psty.closed) continue;
				pocket2 = (RBcolor(psty["stroke"]) == "8080");
				carve2 = (psty["stroke"] == "#00ffff");
				psty.pocket = pocket2;
				bound2 = psty.bound;

				if (pocket1 && !pocket2) continue;
				if (!pocket1 && pocket2) continue;
				if (carve1 && !carve2) continue;
				if (!carve1 && carve2) continue;
				if (bound1 && !bound2) continue;
				if (!bound1 && bound2) continue;

				if (i == ii || paths[ii][4] < l1 || (psty["stroke"] == "#00ff00" && psty["fill"] == "none")) continue;

				var d = sqr(cx - paths[ii][2]) + sqr(cy - paths[ii][3]);
				if (sqrt(d) > paths[ii][4] + l1) continue;
				for (var j = 0; j < path.length; j += 10) {
					var p = path[j];
					if ((paths[ii][4] > l1) && isInside(p[0], p[1], paths[ii][0])) {
						if (paths[i][9].closed && (psty["fill"] != "#ffff00")) flip = !flip;
						parent.push(ii);
						paths[ii][9].childs++;
						break;
					}
				}
			}
			paths[i][1] = flip;
		}
		paths[i][5] = parent;
		sty.parent = parent;
	}
	var etime = new Date();
	ms = etime.getTime() - ms;
	console.log("Process time " + ms);
	gcstyle = [];
	parsedGeometryData = [];
	var pi = 1;
	for (i in paths) {
		var path = paths[i][0];
		sty = paths[i][9];
		sty.ochilds = sty.childs;
		var bc = 0;
		var tp = -1;
		for (var pi in sty.parent) {
			var j = sty.parent[pi];
			var s = paths[j][9];
			if (s.childs > bc) {
				tp = j;
				bc = s.childs;
			}
		}
		sty.topparent = tp;
		sty.idp = i;

		sty.num = gcstyle.length;
		gcstyle.push(sty);
		if (paths[i][1]) path = path.reverse();

		// Cache direct geometry data for fast CAM processing
		parsedGeometryData.push({
			points: path.map(function (pt) { return [pt[0], pt[1]]; }),
			closed: paths[i][8],
			flip: paths[i][1],
			sty: sty
		});

		sc++;
		if (sc > 1) {
			t1 += " ";
		}

		for (j in path) {
			var p = path[j];
			x = p[0] * scale;
			y = p[1] * scale;
			xmax = Math.max(xmax, x);
			ymax = Math.max(ymax, y);
			xmin = Math.min(xmin, x);
			ymin = Math.min(ymin, y);
			xy = mround(x) + " " + mround(y);
			if (j == 0) {
				t1 += "M" + xy;
			} else {
				if (j == 1) t1 += " L";
				t1 += " " + xy;
			}
		}
	}

	if (czero > 0) {
		xzero /= czero;
		yzero /= czero;
	}
	setvalue("startat", mround2(xzero) + "," + mround2(yzero));
	t1 += '" stroke="none" fill="black" fill-rule="evenodd"/></svg>';
	t1 = '<svg id="svg" version="1.1" viewbox="0 0 ' + (in_w * 3.779528) + ' ' + (in_h * 3.779528) + ' " width="' + in_w + 'mm" height="' + in_h + 'mm" xmlns="http://www.w3.org/2000/svg"><path d="' + t1;
	sty = defaultsty;
	sty.num = gcstyle.length;
	gcstyle.push(sty);
	gcstyle.push(sty);
	gcstyle.push(sty);
	gcstyle.push(sty);
	gcstyle.push(sty);
	gcstyle.push(sty);
	console.log("path1totext done.");
	return t1;

}

// Web socket server to allow other karyacnc apps send gcode and task to this software
