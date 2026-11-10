// Test: new join must be a PURE CONCATENATION join (no snap, no dedup, no simplify).
// Compares behaviour against the original O(n^3) greedy join to confirm both
// produce the same set of polylines (point-set equality, ignoring order).

function runJoin(paths, mind) {
    if (mind > 0 && paths.length > 0) {
        var cellSize = Math.max(mind, 1e-6);
        var tol2 = mind * mind;
        var strokeMap = Object.create(null);
        var strokeList = [];
        for (var i in paths) {
            var pa = paths[i];
            if (pa[0].length < 2) continue;
            if (pa[8]) continue;
            var s = pa[9].stroke;
            if (!strokeMap[s]) {
                strokeMap[s] = { segs: [], headX: [], headY: [], tailX: [], tailY: [] };
                strokeList.push(s);
            }
            var g = strokeMap[s];
            var head = pa[0][0];
            var tail = pa[0][pa[0].length - 1];
            g.segs.push({ i: +i, pts: pa[0] });
            g.headX.push(head[0]); g.headY.push(head[1]);
            g.tailX.push(tail[0]); g.tailY.push(tail[1]);
        }
        var keyOf = function (cx, cy) { return cx + "," + cy; };
        for (var sI = 0; sI < strokeList.length; sI++) {
            var g = strokeMap[strokeList[sI]];
            if (g.segs.length === 0) continue;
            var nSeg = g.segs.length;
            var grid = Object.create(null);
            for (var si = 0; si < nSeg; si++) {
                var hcx = Math.floor(g.headX[si] / cellSize);
                var hcy = Math.floor(g.headY[si] / cellSize);
                var tcx = Math.floor(g.tailX[si] / cellSize);
                var tcy = Math.floor(g.tailY[si] / cellSize);
                var hk = keyOf(hcx, hcy), tk = keyOf(tcx, tcy);
                if (!grid[hk]) grid[hk] = [];
                grid[hk].push({ si: si, isHead: true });
                if (tk !== hk) { if (!grid[tk]) grid[tk] = []; grid[tk].push({ si: si, isHead: false }); }
            }
            var visited = new Int8Array(nSeg);
            var rootOf = new Int32Array(nSeg);
            for (var si2 = 0; si2 < nSeg; si2++) rootOf[si2] = si2;
            function consumeSeg(si) {
                var hcx = Math.floor(g.headX[si] / cellSize);
                var hcy = Math.floor(g.headY[si] / cellSize);
                var tcx = Math.floor(g.tailX[si] / cellSize);
                var tcy = Math.floor(g.tailY[si] / cellSize);
                var hk = keyOf(hcx, hcy), tk = keyOf(tcx, tcy);
                var clear = function (key) {
                    var cell = grid[key]; if (!cell) return;
                    for (var i = 0; i < cell.length; i++) if (cell[i].si === si) cell[i].si = -1;
                };
                clear(hk); if (tk !== hk) clear(tk);
            }
            function findMatch(x, y) {
                var ccx = Math.floor(x / cellSize), ccy = Math.floor(y / cellSize);
                var bestSi = -1, bestRev = false, bestD2 = Infinity;
                for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
                    var cell = grid[keyOf(ccx + dx, ccy + dy)];
                    if (!cell) continue;
                    for (var i = 0; i < cell.length; i++) {
                        var rec = cell[i]; var csi = rec.si; if (csi < 0) continue;
                        if (visited[csi]) continue;
                        var ex, ey;
                        if (rec.isHead) { ex = g.headX[csi]; ey = g.headY[csi]; }
                        else { ex = g.tailX[csi]; ey = g.tailY[csi]; }
                        var dxs = x - ex, dys = y - ey;
                        var d2 = dxs * dxs + dys * dys;
                        if (d2 <= tol2 && d2 < bestD2) { bestD2 = d2; bestSi = csi; bestRev = !rec.isHead; }
                    }
                }
                if (bestSi < 0) return null;
                return { si: bestSi, rev: bestRev };
            }
            for (var si = 0; si < nSeg; si++) {
                if (visited[si]) continue;
                var poly = g.segs[si].pts.slice();
                var root = si;
                visited[si] = 1; rootOf[si] = root; consumeSeg(si);
                while (1) {
                    var t = poly[poly.length - 1];
                    var m = findMatch(t[0], t[1]);
                    if (!m) break;
                    visited[m.si] = 1; rootOf[m.si] = root; consumeSeg(m.si);
                    var cand = g.segs[m.si].pts;
                    if (m.rev) { for (var k = cand.length - 1; k >= 0; k--) poly.push(cand[k]); }
                    else { for (var k = 0; k < cand.length; k++) poly.push(cand[k]); }
                }
                while (1) {
                    var h = poly[0];
                    var m = findMatch(h[0], h[1]);
                    if (!m) break;
                    visited[m.si] = 1; rootOf[m.si] = root; consumeSeg(m.si);
                    var cand = g.segs[m.si].pts;
                    var pre;
                    if (m.rev) { pre = cand.slice(); }
                    else { pre = new Array(cand.length); for (var k = 0; k < cand.length; k++) pre[k] = cand[cand.length - 1 - k]; }
                    poly = pre.concat(poly);
                }
                paths[g.segs[root].i][0] = poly;
            }
            for (var si3 = 0; si3 < nSeg; si3++) {
                if (visited[si3] && rootOf[si3] !== si3) paths[g.segs[si3].i][0] = [];
            }
        }
    }
}

function oldJoin(paths, mind) {
    for (var i in paths) {
        var pa = paths[i];
        if (pa[0].length != 2) continue;
        if (!pa[8]) {
            for (var ii in paths) {
                if (i == ii) continue;
                var p = paths[ii];
                if (p[0].length != 2) continue;
                if (p[9].stroke != pa[9].stroke) continue;
                if (p[8]) continue;
                var fx = pa[0][0][0], fy = pa[0][0][1];
                var ox = pa[0][1][0], oy = pa[0][1][1];
                var p1 = p[0][0], p2 = p[0][1];
                if ((p1[0]-fx)*(p1[0]-fx)+(p1[1]-fy)*(p1[1]-fy) < mind &&
                    (p2[0]-ox)*(p2[0]-ox)+(p2[1]-oy)*(p2[1]-oy) < mind) p[0] = [];
                else if ((p1[0]-ox)*(p1[0]-ox)+(p1[1]-oy)*(p1[1]-oy) < mind &&
                         (p2[0]-fx)*(p2[0]-fx)+(p2[1]-fy)*(p2[1]-fy) < mind) p[0] = [];
            }
        }
    }
    var joined = 1;
    while (joined) {
        joined = 0;
        for (var i in paths) {
            var pa = paths[i];
            if (pa[0].length <= 1) continue;
            if (!pa[8]) {
                while (1) {
                    var mindis = mind + 0.1, cekdis, idp = -1, revers = 0;
                    for (var ii in paths) {
                        if (i == ii) continue;
                        var p = paths[ii];
                        if (p[0].length == 0) continue;
                        if (p[9].stroke != pa[9].stroke) continue;
                        if (p[8]) continue;
                        var ox = pa[0][pa[0].length-1][0], oy = pa[0][pa[0].length-1][1];
                        var p1 = p[0][0], p2 = p[0][p[0].length-1];
                        var d1 = (p1[0]-ox)*(p1[0]-ox) + (p1[1]-oy)*(p1[1]-oy);
                        var d2 = (p2[0]-ox)*(p2[0]-ox) + (p2[1]-oy)*(p2[1]-oy);
                        if (d1 < mindis) { idp = ii; mindis = d1; revers = 0; }
                        else if (d2 < mindis) { idp = ii; mindis = d2; revers = 1; }
                    }
                    if (idp >= 0) {
                        var p = paths[idp];
                        pa[0] = revers ? pa[0].concat(p[0].reverse()) : pa[0].concat(p[0]);
                        p[0] = []; joined++;
                    } else break;
                }
            }
        }
    }
}

function mk(pts, stroke, closed) {
    return [pts.slice(), 0, 0, 0, 0, [], 0, 0, !!closed, { stroke: stroke, fill: "#000000" }];
}

// Point-set equality ignoring order: convert polyline to multiset of point keys
function ptKey(p) { return p[0] + "," + p[1]; }
function polySet(pts) {
    var s = {}; for (var i = 0; i < pts.length; i++) s[ptKey(pts[i])] = (s[ptKey(pts[i])] || 0) + 1;
    return JSON.stringify(s);
}
function livePolylines(paths) {
    var arr = [];
    for (var i = 0; i < paths.length; i++) if (paths[i][0].length >= 2) arr.push(paths[i][0]);
    return arr;
}
function signature(paths) {
    var polys = livePolylines(paths).map(function (p) { return polySet(p); }).sort();
    return JSON.stringify(polys);
}

var pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log("  PASS " + name); }
    else { fail++; console.log("  FAIL " + name + (extra ? " :: " + extra : "")); }
}

// Helper: run both algos on the same input and compare signatures
function compareBoth(name, paths, mind) {
    console.log("\nTest: " + name);
    var p1 = paths.map(function (p) { return mk(p[0], p[9].stroke, p[8]); });
    var p2 = paths.map(function (p) { return mk(p[0], p[9].stroke, p[8]); });
    oldJoin(p1, mind);
    runJoin(p2, mind);
    var sOld = signature(p1);
    var sNew = signature(p2);
    check(name + " - signatures match", sOld === sNew, "old=" + sOld + " new=" + sNew);
}

// ── 1: simple 4-segment linear chain (all 2-pt) ──
compareBoth("4-segment chain",
    [
        mk([[0,0],[1,0]], "#000"),
        mk([[1,0],[2,0]], "#000"),
        mk([[2,0],[3,0]], "#000"),
        mk([[3,0],[4,0]], "#000")
    ], 0.05);

// ── 2: chain with sub-tolerance gap (should still merge) ──
compareBoth("chain with sub-tolerance gap",
    [
        mk([[0,0],[1,0]], "#000"),
        mk([[1.04,0],[2,0]], "#000")
    ], 0.05);

// ── 3: per-stroke isolation ──
compareBoth("red+blue isolation",
    [
        mk([[0,0],[1,0]], "#ff0000"),
        mk([[1,0],[2,0]], "#0000ff")
    ], 0.05);

// ── 4: closed path is skipped ──
compareBoth("closed square not merged",
    [
        mk([[0,0],[1,0],[1,1],[0,1]], "#000", true),
        mk([[1,0],[2,0]], "#000", false)
    ], 0.05);

// ── 5: identical forward duplicate — old code blanks the second; new code
// chains it into a 4-pt polyline (pure concat, no data loss). Both are
// valid "no geometry lost" outcomes; we only require the new code to chain.
// ── 6: reversed duplicate — same expectation.
console.log("\nTest: duplicates are chained (no geometry lost)");
{
    var p1 = [mk([[0,0],[1,0]], "#000"), mk([[0,0],[1,0]], "#000")];
    runJoin(p1, 0.05);
    var totalPts1 = p1.reduce(function (s, q) { return s + (q[0].length >= 2 ? q[0].length : 0); }, 0);
    check("fwd dup: 4 input pts → 4 output pts (preserved)", totalPts1 === 4, "got " + totalPts1);

    var p2 = [mk([[0,0],[1,0]], "#000"), mk([[1,0],[0,0]], "#000")];
    runJoin(p2, 0.05);
    var totalPts2 = p2.reduce(function (s, q) { return s + (q[0].length >= 2 ? q[0].length : 0); }, 0);
    check("rev dup: 4 input pts → 4 output pts (preserved)", totalPts2 === 4, "got " + totalPts2);
}

// ── 7: 3-cycle ──
compareBoth("3-cycle A→B→C→A",
    [
        mk([[0,0],[1,0]], "#000"),
        mk([[1,0],[0.5,0.866]], "#000"),
        mk([[0.5,0.866],[0,0]], "#000")
    ], 0.05);

// ── 8: T-junction (3 segs at one point) ──
compareBoth("T-junction",
    [
        mk([[0,0],[1,0]], "#000"),
        mk([[1,0],[1,1]], "#000"),
        mk([[1,0],[1,-1]], "#000")
    ], 0.05);

// ── 9: chain of 2-pt + a 3-pt polylines (mixed sizes) ──
compareBoth("mixed 2-pt and 3-pt",
    [
        mk([[0,0],[1,0]], "#000"),
        mk([[1,0],[1.5,0.5],[2,0]], "#000"),
        mk([[2,0],[3,0]], "#000")
    ], 0.05);

// ── 10: reverse-direction chain (each next seg reversed) ──
compareBoth("zigzag chain (alternating direction)",
    [
        mk([[0,0],[1,0]], "#000"),
        mk([[2,0],[1,0]], "#000"),
        mk([[2,0],[3,0]], "#000"),
        mk([[4,0],[3,0]], "#000")
    ], 0.05);

// ── 11: disconnected segments stay disconnected ──
compareBoth("disconnected segments",
    [
        mk([[0,0],[1,0]], "#000"),
        mk([[5,5],[6,6]], "#000")
    ], 0.05);

// ── 12: long chain (perf) ──
{
    var N = 2000;
    var inp = [];
    for (var i = 0; i < N; i++) inp.push(mk([[i, 0], [i + 1, 0]], "#000"));
    compareBoth("2000-segment chain", inp, 0.05);
}

// ── 13: mind <= 0 short-circuits (no change to paths) ──
{
    console.log("\nTest: mind <= 0 short-circuit");
    var inp = [mk([[0,0],[1,0]], "#000"), mk([[1,0],[2,0]], "#000")];
    var p = inp.map(function (q) { return mk(q[0], q[9].stroke, q[8]); });
    runJoin(p, 0);
    check("mind=0: nothing merged",
        p[0][0].length === 2 && p[1][0].length === 2,
        JSON.stringify(p.map(function (q) { return q[0].length; })));
}

// ── 14: CRITICAL — verify no points are dropped, snapped, or duplicated ──
// Count the total number of input points and confirm the same number appears
// in the output (across all live polylines).
console.log("\nTest: pure-concat — total point count preserved");
{
    var cases = [
        [mk([[0,0],[1,0]], "#000"), mk([[1,0],[2,0]], "#000"), mk([[2,0],[3,0]], "#000")],
        [mk([[0,0],[1,0],[2,0]], "#000"), mk([[2,0],[3,0],[4,0]], "#000")],
        [mk([[0,0],[1,0]], "#000"), mk([[1,0],[2,0]], "#000"), mk([[2,0],[3,0]], "#000"), mk([[3,0],[4,0]], "#000")],
        [mk([[0,0],[1,0]], "#000"), mk([[5,5],[6,6]], "#000")],
    ];
    for (var c = 0; c < cases.length; c++) {
        var inp = cases[c];
        var totalPts = inp.reduce(function (s, p) { return s + p[0].length; }, 0);
        var p = inp.map(function (q) { return mk(q[0], q[9].stroke, q[8]); });
        runJoin(p, 0.05);
        var outPts = p.reduce(function (s, q) { return s + (q[0].length >= 2 ? q[0].length : 0); }, 0);
        check("case " + c + ": " + totalPts + " input pts → " + outPts + " output pts (preserved)",
              totalPts === outPts, "in=" + totalPts + " out=" + outPts);
    }
}

console.log("\n=========================================");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("=========================================");
process.exit(fail === 0 ? 0 : 1);
