function replaceAll(str, find, replace) {
	return str.replace(new RegExp(find, 'g'), replace);
}

function getcncip() {
	var cncip = getvalue("wsip");
	if ($("wsdirect").checked) cncip = "192.168.4.1";
	if (cncip.split(".").length == 2) cncip = "192.168." + cncip;
	return cncip;
}

function urlopen(s, cb_ok = 0, cb_err = 0, wx = 1) {
	url = "http://" + getcncip() + "/" + s;
	window.invoke("proxy_request", { url: url })
		.then(resp => { if (cb_ok) cb_ok(resp); else if (wx) wxAlert("HTTP Response", resp) })
		.catch(err => {
			$("alert1").innerHTML = "ERROR";
			if (cb_err) cb_err(err);
			else if (wx) wxAlert("HTTP ERROR", "Error");
		}
		);
	// var xhr = new XMLHttpRequest();
	// xhr.open("GET", url, true);
	// xhr.onload = function(e) {
	// 	//alert(xhr.response);
	// 	if (cb_ok) cb_ok(xhr.response);
	// 	else if (wx)wxAlert("HTTP Response",xhr.response);
	// };
	// xhr.addEventListener('error', function(e) {
	// 	$("alert1").innerHTML = "ERROR";
	// 	if (cb_err) cb_err(e);
	// 	else if (wx)wxAlert("HTTP ERROR","Error");
	// });
	// xhr.send();
}

//=======================
// to suit your point format, run search/replace for '.x', '.y' and '.z';
// (configurability would draw significant performance overhead)

// square distance between 2 points
function getSquareDistance(p1, p2) {

	var dx = p1.x - p2.x,
		dy = p1.y - p2.y,
		dz = p1.z - p2.z;

	return dx * dx + dy * dy + dz * dz;
}

// square distance from a point to a segment
function getSquareSegmentDistance(p, p1, p2) {

	var x = p1.x,
		y = p1.y,
		z = p1.z,

		dx = p2.x - x,
		dy = p2.y - y,
		dz = p2.z - z;

	if (dx !== 0 || dy !== 0 || dz !== 0) {

		var t = ((p.x - x) * dx + (p.y - y) * dy + (p.z - z) * dz) /
			(dx * dx + dy * dy + dz * dz);

		if (t > 1) {
			x = p2.x;
			y = p2.y;
			z = p2.z;

		} else if (t > 0) {
			x += dx * t;
			y += dy * t;
			z += dz * t;
		}
	}

	dx = p.x - x;
	dy = p.y - y;
	dz = p.z - z;

	return dx * dx + dy * dy + dz * dz;
}
// the rest of the code doesn't care for the point format

// basic distance-based simplification
function simplifyRadialDistance(points, sqTolerance) {

	var prevPoint = points[0],
		newPoints = [prevPoint],
		point;

	for (var i = 1, len = points.length; i < len; i++) {
		point = points[i];

		if (getSquareDistance(point, prevPoint) > sqTolerance) {
			newPoints.push(point);
			prevPoint = point;
		}
	}

	if (prevPoint !== point) {
		newPoints.push(point);
	}

	return newPoints;
}

// simplification using optimized Douglas-Peucker algorithm with recursion elimination
function simplifyDouglasPeucker(points, sqTolerance) {

	var len = points.length,
		MarkerArray = typeof Uint8Array !== 'undefined' ? Uint8Array : Array,
		markers = new MarkerArray(len),

		first = 0,
		last = len - 1,

		stack = [],
		newPoints = [],

		i, maxSqDist, sqDist, index;

	markers[first] = markers[last] = 1;

	while (last) {

		maxSqDist = 0;

		for (i = first + 1; i < last; i++) {
			sqDist = getSquareSegmentDistance(points[i], points[first], points[last]);

			if (sqDist > maxSqDist) {
				index = i;
				maxSqDist = sqDist;
			}
		}

		if (maxSqDist > sqTolerance) {
			markers[index] = 1;
			stack.push(first, index, index, last);
		}

		last = stack.pop();
		first = stack.pop();
	}

	for (i = 0; i < len; i++) {
		if (markers[i]) {
			newPoints.push(points[i]);
		}
	}

	return newPoints;
}

// both algorithms combined for awesome performance
function simplify3d(points, tolerance, highestQuality) {

	var sqTolerance = tolerance !== undefined ? tolerance * tolerance : 1;

	points = highestQuality ? points : simplifyRadialDistance(points, sqTolerance);
	points = simplifyDouglasPeucker(points, sqTolerance);

	return points;
}

// ===============

function startprint() {
	//urlopen("startprint");
	urlopen("startjob?jobname=/" + getvalue("jobname") + ".gcode",
		function () {
			if (wsconnected) {
				hideId("btuploadstart");
				hideId("btuploadresume");
				showId2("btuploadstop");
				showId2("btuploadpause");
				stopinfo = 1;
				etime = new Date();
				console.log("Start " + etime);
				setvalue("applog", getvalue("applog") + "Start " + etime + "\n");
				waitforwait = 1;
			}
		}, null);
}

function pauseprint() {
	urlopen("pauseprint");
	hideId("btuploadpause");
	showId2("btuploadresume");
}

function resumeprint() {
	urlopen("resumeprint");
	hideId("btuploadresume");
	showId2("btuploadpause");
}

function resetflashbutton() {
	hideId("btuploadstop");
	hideId("btuploadpause");
	hideId("btuploadresume");
	showId2("btuploadstart");
}

function stopprint() {
	wxAlert("Confirmation", "Stop running Job ?", "Yes,No", function () {
		urlopen("stopprint");
		resetflashbutton();
	}, null);
}

var mbody = document.getElementById("body");
var gcode = "";

var wemosd1 = 1;
var uploadimage = 1;
var lstnj = 0;
var thistm = 0;
function infome1() {
	if (numjobs - lstnj > 10) {
		sendTlg("KaryaCNC Uploaded " + numjobs + " jobs");
		lstnj = numjobs;
	}
	thistm = 0;
}
function upload(fn) {
	if ($("pltmode") && $("pltmode").checked) {
		$("alert1").innerHTML = "<br>PLT MODE !";
		//return;
	}
	uploadimage = getchecked("upimg");
	function uploadjpg() {
		numjobs++;
		thistm = setTimeout(infome1, 5000);
		if (!uploadimage) return;
		c = $("myCanvas1");
		c.toBlob(function (blob) {
			realupload(blob, fn + ".jpg", uploadpreview);
		}, "image/jpeg", 0.2);
	}
	realupload(new Blob([new Int8Array(compress).buffer], {
		type: "text/plain"
	}), fn, uploadjpg);
}

function uploadpreview() {

}


async function realupload(gcode, fname, callback) {
	if (space[0] - space[1] - gcode.size < 0) {
		wxalert("Not enough space in machine, job size is " + parseInt(gcode.size / 1000) + "Kb !");
		return;
	}
	updatespace(gcode.size);

	var progressBar = $('progress1');
	$("alert1").innerHTML = "Upload file...";

	try {
		let data = await gcode.arrayBuffer();
		let result = await window.invoke('upload_file', {
			ip: getcncip(),
			filename: fname,
			data: Array.from(new Uint8Array(data))
		});
		progressBar.value = 0;
		$("alert1").innerHTML = "Upload OK";
		resetflashbutton();
		if (callback) callback();
	} catch (e) {
		progressBar.value = 100;
		$("alert1").innerHTML = "Upload ERROR: " + e;
	}
}


setclick("btupload", function () {
	if (getchecked("engravecut")) {
		begincompress(startgcode + "\n" + getvalue("engcode") + "\n" + getvalue("gcode") + finishgcode);
	} else {
		begincompress(startgcode + "\n" + getvalue("gcode") + "\n" + getvalue("engcode") + finishgcode);
	}
	upload(getvalue("jobname") + ".gcode");
});
setclick("btjob5", function () {
	begincompress(startgcode + "\n" + jobs.join("\n") + finishgcode);
	upload(getvalue("jobname") + ".gcode");
});
setclick("btcopygc", function () {
	copyStringToClipboard(startgcode + "\n" + jobs.join("\n") + finishgcode);
});

setclick("btuploadstart", startprint);
setclick("btuploadstop", stopprint);
setclick("btuploadpause", pauseprint);
setclick("btuploadresume", resumeprint);

function Canvas2Clipboard(canvas) {
	canvas.toBlob(function (blob) {
		const item = new ClipboardItem({
			"image/png": blob
		});
		navigator.clipboard.write([item]);
	})
}
setclick("btcopycanvas", function () {
	// Create a temporary canvas
	const tempCanvas = document.createElement('canvas');
	const scale = 1 / myCanvas1.transformation.a;
	const width = myCanvas1.width * scale;
	const height = myCanvas1.height * scale;
	const x = myCanvas1.transformation.e * scale;
	const y = myCanvas1.transformation.f * scale;

	tempCanvas.width = width;
	tempCanvas.height = height;
	const tempCtx = tempCanvas.getContext('2d');

	// Draw the desired region onto the temporary canvas
	tempCtx.drawImage(myCanvas1.canvas, x, y, width, height, 0, 0, width, height);
	Canvas2Clipboard(tempCanvas);
});

var segsv = [];
var segsvdraw = [];
var carvetime = 0;
var gcodecarve = "";
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
function vcarve(maxr, angle, step, path, dstep, dstep2) {
	console.time("vcarve_opt");
	segsvdraw = [];
	gcodecarve = "";

	// --- Constants & Setup ---
	const ve = 1 / Math.tan(angle * Math.PI / 360);
	const minz = -(getvalue("vdiamin") / 2 * ve);
	const maxz = -maxr * ve;
	const pw = parseInt(getvalue('vcarvepw') * 255 * 0.01);
	const safez = getnumber("safez");
	const feed = getvalue("vcfeed") * 60;
	const travSpeed = getvalue("trav") * 60;
	const pausedist = Math.max(20, getnumber("carvepausedist")) ** 2;
	const beforecut_p = getchecked("carvepause") && (cmd != CMD_LASER) ? "G0 Z0\nM3 S" + pw + " P10000\n" : "";

	// --- Helper: Smooth Contour ---
	// Smooths the input path to reduce jitter on curves while preserving sharp corners.
	function smoothContour(contour) {
		var newContour = contour.slice();
		var len = contour.length / 2;
		if (len < 3) return newContour;

		for (var i = 0; i < len; i++) {
			var prev = (i - 1 + len) % len;
			var next = (i + 1) % len;

			var x = contour[i * 2];
			var y = contour[i * 2 + 1];
			var xp = contour[prev * 2];
			var yp = contour[prev * 2 + 1];
			var xn = contour[next * 2];
			var yn = contour[next * 2 + 1];

			var v1x = x - xp; var v1y = y - yp;
			var v2x = xn - x; var v2y = yn - y;
			var l1 = Math.sqrt(v1x * v1x + v1y * v1y);
			var l2 = Math.sqrt(v2x * v2x + v2y * v2y);

			if (l1 > 1e-5 && l2 > 1e-5) {
				v1x /= l1; v1y /= l1;
				v2x /= l2; v2y /= l2;
				var dot = v1x * v2x + v1y * v2y;

				// Only smooth if the angle is relatively flat (part of a curve)
				// dot > 0.7 means angle deviation is less than ~45 degrees
				if (dot > 0.5) {
					// Weighted average (Gaussian-ish)
					newContour[i * 2] = 0.25 * xp + 0.5 * x + 0.25 * xn;
					newContour[i * 2 + 1] = 0.25 * yp + 0.5 * y + 0.25 * yn;
				}
			}
		}
		return newContour;
	}

	// --- 1. Segmentation (Legacy Logic + Smoother Miter) ---
	segsv = [];
	var sqrt = Math.sqrt;
	var sqr = function (x) { return x * x; };
	var s = 0;

	var segmentation = function (nd, path, rev) {
		var PL = path.length / 2 - 1;
		var x1, y1, x2, y2, i, dx, dy, L, opx, opy, ovx, ovy, vx, vy, px, py;
		L = 0;
		var firstp;

		for (var p = -1; p <= PL; p++) {
			i = p;
			if (rev) i = PL - i;
			if (i < 0) i = PL - i;
			if (i >= PL) i -= PL;

			x2 = path[i * 2 + 0];
			y2 = path[i * 2 + 1];

			if (p >= 0) {
				L = (sqrt(sqr(x2 - x1) + sqr(y2 - y1)));
				if (L > 0) {
					ovx = vx; ovy = vy;
					vx = (x2 - x1) / L;
					vy = (y2 - y1) / L;
					if (p >= 0) {
						L = Math.floor(L / step) + 1;
						dx = (x2 - x1) / L;
						dy = (y2 - y1) / L;

						for (var j = 0; j < L; j++) {
							px = x1 + (j + .5) * dx;
							py = y1 + (j + .5) * dy;

							// Corner Handling
							if (j == 0 && opx) {
								var dot = (vx * ovx) + (vy * ovy);
								var cross = (vx * ovy) - (ovx * vy);

								if (Math.abs(cross) > 0.01) {
									var dpx = (px - opx);
									var dpy = (py - opy);
									var OL = sqrt(sqr(dpx) + sqr(dpy));

									if (cross > 0.01) {
										var angleDiff = Math.acos(Math.max(-1, Math.min(1, dot)));
										var cornerSteps = Math.ceil(angleDiff / (2 * Math.PI / 180));

										if (cornerSteps > 0) {
											for (var c = 1; c <= cornerSteps; c++) {
												var t = c / (cornerSteps + 1);
												var ix = ovx * (1 - t) + vx * t;
												var iy = ovy * (1 - t) + vy * t;
												var ilen = sqrt(ix * ix + iy * iy);
												ix /= ilen; iy /= ilen;

												segsv.push([x1, y1, s - 1, 0, 0, 0, 0, ix, iy, 0, 0, nd]);
											}
										}
									} else {
										var NL = Math.floor(OL / step) + 1;
										var ndx = (dpx) / NL;
										var ndy = (dpy) / NL;
										dpx /= OL; dpy /= OL;
										var nj = 1;
										segsv.push([px - (nj - 0.5) * ndx, py - (nj - 0.5) * ndy, s - 1, 0, 0, 0, 0, dpx, dpy, 0, 0, nd]);
									}
								}
							}

							if (p > PL) return;
							if (j == 0 && !firstp) firstp = segsv[segsv.length - 1];
							if (p > 0) segsv.push([px, py, s, 0, 0, 0, 0, vx, vy, 0, 0, nd]);
						}
						s++;
					}
					opx = px; opy = py;
				}
			}
			x1 = x2; y1 = y2;
		}
	}

	var flipx = $("flipx").checked;
	var flipve = $("flipve").checked;
	var cutclimb = $("cutclimb").checked;

	for (var i = 0; i < path.length; i++) {
		var sc = path[i][1];
		if (flipx) sc = 0;
		if (flipve) sc = !sc;
		if (cutclimb) sc = !sc;

		// Apply smoothing to the input path before segmentation
		var rawContour = path[i][0];
		var smoothedContour = smoothContour(rawContour);

		segmentation(i, smoothedContour, sc);
	}

	// --- 2. Optimization: Spatial Grid ---
	var gridSize = maxr;
	var grid = {};

	for (var i = 0; i < segsv.length; i++) {
		var p = segsv[i];
		var gx = Math.floor(p[0] / gridSize);
		var gy = Math.floor(p[1] / gridSize);
		var key = gx + "," + gy;
		if (!grid[key]) grid[key] = [];
		grid[key].push(i);
	}

	function checkCollision(seg1, r) {
		var cx = seg1[0] - r * seg1[8];
		var cy = seg1[1] + r * seg1[7];
		var rSq = r * r;
		var searchDist = r * 2.0;
		var minGx = Math.floor((seg1[0] - searchDist) / gridSize);
		var maxGx = Math.floor((seg1[0] + searchDist) / gridSize);
		var minGy = Math.floor((seg1[1] - searchDist) / gridSize);
		var maxGy = Math.floor((seg1[1] + searchDist) / gridSize);

		for (var gx = minGx; gx <= maxGx; gx++) {
			for (var gy = minGy; gy <= maxGy; gy++) {
				var cell = grid[gx + "," + gy];
				if (!cell) continue;
				for (var k = 0; k < cell.length; k++) {
					var idx = cell[k];
					var seg2 = segsv[idx];
					if ((seg1[2] == -1) || (seg1[2] == seg2[2])) continue;

					var distSq = (cx - seg2[0]) * (cx - seg2[0]) + (cy - seg2[1]) * (cy - seg2[1]);
					if (distSq <= rSq) return true;
				}
			}
		}
		return false;
	}

	function markPartner(seg1, r) {
		var cx = seg1[0] - r * seg1[8];
		var cy = seg1[1] + r * seg1[7];
		var rSq = r * r;
		var searchDist = r * 2.0;
		var minGx = Math.floor((seg1[0] - searchDist) / gridSize);
		var maxGx = Math.floor((seg1[0] + searchDist) / gridSize);
		var minGy = Math.floor((seg1[1] - searchDist) / gridSize);
		var maxGy = Math.floor((seg1[1] + searchDist) / gridSize);

		var bestDist = 999999;
		var bestIdx = -1;

		for (var gx = minGx; gx <= maxGx; gx++) {
			for (var gy = minGy; gy <= maxGy; gy++) {
				var cell = grid[gx + "," + gy];
				if (!cell) continue;
				for (var k = 0; k < cell.length; k++) {
					var idx = cell[k];
					var seg2 = segsv[idx];
					if ((seg1[2] == -1) || (seg1[2] == seg2[2])) continue;

					var distSq = (cx - seg2[0]) * (cx - seg2[0]) + (cy - seg2[1]) * (cy - seg2[1]);
					if (distSq < bestDist) {
						bestDist = distSq;
						bestIdx = idx;
					}
				}
			}
		}

		if (bestIdx != -1) {
			segsv[bestIdx][6] = r;
		}
	}

	// --- 3. Depth Calculation (Binary Search) ---
	var points = [];

	for (var i = 0; i < segsv.length; i++) {
		var seg1 = segsv[i];
		if (seg1[2] == -1) continue;
		if (seg1[6] > 0) continue;

		var finalR = 0;

		if (!checkCollision(seg1, maxr)) {
			finalR = maxr;
		} else {
			var low = 0;
			var high = maxr;
			for (var iter = 0; iter < 12; iter++) {
				var mid = (low + high) * 0.5;
				if (checkCollision(seg1, mid)) {
					high = mid;
				} else {
					low = mid;
				}
			}
			finalR = low;
			markPartner(seg1, finalR);
		}

		var cx = seg1[0] - finalR * seg1[8];
		var cy = seg1[1] + finalR * seg1[7];
		var cz = (finalR >= maxr) ? maxz : -finalR * ve;
		var fs = feed;

		seg1[3] = cx;
		seg1[4] = cy;
		seg1[5] = cz;
		seg1[6] = finalR;
		seg1[10] = fs;

		points.push({ 'x': cx, 'y': cy, 'z': cz, 'f': fs, 'i': i });
	}

	// --- 4. Generate G-Code ---
	var gc = "M3 S" + pw + "\nG0 F6000 Z" + safez + "\nG1 F" + feed + "\n";
	var totalmm = 0;
	var oldx = -9999, oldy = -9999, oldz = -9999;
	var oldf = -1;
	var lpx = 0, lpy = 0;

	function flushPoints(pts) {
		if (pts.length === 0) return;
		pts = simplify3d(pts, 0.3 * step, true);

		oldx = -9999; oldy = -9999; oldz = -9999; oldf = -1;

		var start = pts[0];
		var trav = "G0 Z" + safez + "\n";
		trav += "G0 F" + travSpeed + " X" + mround2(start.x) + " Y" + mround2(start.y) + "\n";
		trav += "G0 Z" + mround2(start.z) + "\n";
		gc += trav;

		var distSq = (start.x - lpx) ** 2 + (start.y - lpy) ** 2;
		if (distSq > pausedist) {
			gc += beforecut_p;
			lpx = start.x;
			lpy = start.y;
		}

		var firstGcode = "";

		for (var k = 0; k < pts.length; k++) {
			var p = pts[k];
			var xpart = (p.x === oldx) ? "" : " X" + mround2(p.x);
			var ypart = (p.y === oldy) ? "" : " Y" + mround2(p.y);
			var zpart = (p.z === oldz) ? "" : " Z" + mround2(Math.min(minz, p.z));
			var fpart = (p.f === oldf) ? "" : " F" + parseInt(p.f);

			var g1 = "";
			if (xpart || ypart || zpart || fpart) {
				g1 = "G1" + xpart + ypart + zpart + fpart + "\n";
				gc += g1;
				if (oldx !== -9999) {
					totalmm += Math.sqrt((p.x - oldx) ** 2 + (p.y - oldy) ** 2 + (p.z - oldz) ** 2);
				}
				oldx = p.x; oldy = p.y; oldz = p.z; oldf = p.f;
			}

			if (k === 0) firstGcode = g1;

			segsvdraw.push(segsv[p.i]);
		}

		if (firstGcode) {
			gc += firstGcode;
			segsvdraw.push(segsv[pts[0].i]);
		}
	}

	var currentBatch = [];
	var lastContourId = -1;
	for (var k = 0; k < points.length; k++) {
		var p = points[k];
		var contourId = segsv[p.i][11];

		if (contourId != lastContourId) {
			flushPoints(currentBatch);
			currentBatch = [];
			lastContourId = contourId;
		}
		currentBatch.push(p);
	}
	flushPoints(currentBatch);

	if (totalmm > 0) carvetime += totalmm / (feed / 60.0);
	gc += "G0 Z" + safez + "\n";
	gcodecarve = gc;
	console.timeEnd("vcarve_opt");
}

// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
function vcarve_fast(maxr, angle, step, path, dstep, dstep2) {
	console.time("vcarve_fast");
	segsvdraw = [];
	gcodecarve = "";

	// --- Constants & Setup ---
	const ve = 1 / Math.tan(angle * Math.PI / 360);
	const minz = -(getvalue("vdiamin") / 2 * ve);
	const maxz = -maxr * ve;
	const pw = parseInt(getvalue('vcarvepw') * 255 * 0.01);
	const safez = getnumber("safez");
	const feed = getvalue("vcfeed") * 60;
	const travSpeed = getvalue("trav") * 60;
	const pausedist = Math.max(20, getnumber("carvepausedist")) ** 2;
	const beforecut_p = getchecked("carvepause") && (cmd != CMD_LASER) ? "G0 Z0\nM3 S" + pw + " P10000\n" : "";

	// --- 1. Build Collision Geometry (Spatial Grid) ---
	// We flatten all contours into a list of line segments for fast collision testing.
	let collisionSegments = [];
	const gridSize = maxr * 1.5; // Optimization: Grid cell size
	let grid = new Map();

	function addSegmentToGrid(p1, p2, segIndex) {
		let minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
		let minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
		let startX = Math.floor(minX / gridSize), endX = Math.floor(maxX / gridSize);
		let startY = Math.floor(minY / gridSize), endY = Math.floor(maxY / gridSize);

		for (let x = startX; x <= endX; x++) {
			for (let y = startY; y <= endY; y++) {
				let key = x + "," + y;
				if (!grid.has(key)) grid.set(key, []);
				grid.get(key).push(segIndex);
			}
		}
	}

	// Parse input path
	for (let i = 0; i < path.length; i++) {
		let contour = path[i][0];
		let len = contour.length / 2;
		for (let j = 0; j < len; j++) {
			let j_next = (j + 1) % len;
			let p1 = { x: contour[j * 2], y: contour[j * 2 + 1] };
			let p2 = { x: contour[j_next * 2], y: contour[j_next * 2 + 1] };
			if ((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2 < 1e-6) continue; // Skip tiny segments

			let dx = p2.x - p1.x;
			let dy = p2.y - p1.y;
			let lenSeg = Math.sqrt(dx * dx + dy * dy);

			collisionSegments.push({
				p1, p2,
				dx, dy,
				nx: -dy / lenSeg, ny: dx / lenSeg, // Normal
				lenSq: lenSeg * lenSeg
			});
			addSegmentToGrid(p1, p2, collisionSegments.length - 1);
		}
	}

	// --- 2. Generate Toolpath Points (Resampling) ---
	// Walk the boundary and generate points to calculate depth for.
	let toolpathPoints = [];

	// Global modifiers
	let flipx = $("flipx").checked;
	let flipve = $("flipve").checked;
	let cutclimb = $("cutclimb").checked;

	for (let i = 0; i < path.length; i++) {
		let contour = path[i][0];
		let rev = path[i][1];

		// Apply modifiers to direction
		let sc = rev;
		if (flipx) sc = 0;
		if (flipve) sc = !sc;
		if (cutclimb) sc = !sc;

		let len = contour.length / 2;

		// Iterate segments of the contour
		for (let j = 0; j < len; j++) {
			// Handle direction (CW/CCW)
			let idx = sc ? (len - 1 - j) : j;
			let idx_next = sc ? (len - 1 - ((j + 1) % len)) : ((j + 1) % len);
			// Fix wrap-around for reverse
			if (idx_next < 0) idx_next += len;

			let p1 = { x: contour[idx * 2], y: contour[idx * 2 + 1] };
			let p2 = { x: contour[idx_next * 2], y: contour[idx_next * 2 + 1] };

			let dx = p2.x - p1.x;
			let dy = p2.y - p1.y;
			let dist = Math.sqrt(dx * dx + dy * dy);
			if (dist < 1e-6) continue;

			// Calculate Normal (Left side of vector p1->p2)
			// Vector: (dx, dy). Left Normal: (-dy, dx)
			let nx = -dy / dist;
			let ny = dx / dist;

			// Resample
			let numSteps = Math.ceil(dist / step);
			let stepX = dx / numSteps;
			let stepY = dy / numSteps;

			for (let k = 0; k < numSteps; k++) {
				let px = p1.x + (k + 0.5) * stepX;
				let py = p1.y + (k + 0.5) * stepY;
				toolpathPoints.push({ x: px, y: py, nx: nx, ny: ny, contourId: i });
			}
		}
	}

	// --- 3. Geometric Depth Calculation ---
	// For each point, find the largest circle tangent to it that fits in the shape.
	// Equivalent to finding min_t such that dist(P + t*N, Boundary) = t.
	let resultPoints = [];

	for (let pt of toolpathPoints) {
		let min_t = maxr;
		let found = false;

		// Check grid cells around the point
		let startX = Math.floor((pt.x - maxr) / gridSize);
		let endX = Math.floor((pt.x + maxr) / gridSize);
		let startY = Math.floor((pt.y - maxr) / gridSize);
		let endY = Math.floor((pt.y + maxr) / gridSize);

		let checkedSegs = new Set();

		for (let gx = startX; gx <= endX; gx++) {
			for (let gy = startY; gy <= endY; gy++) {
				let key = gx + "," + gy;
				let cellSegs = grid.get(key);
				if (!cellSegs) continue;

				for (let segIdx of cellSegs) {
					if (checkedSegs.has(segIdx)) continue;
					checkedSegs.add(segIdx);

					let seg = collisionSegments[segIdx];

					// --- Geometric Solver ---
					// We want t > 0 such that dist(P + t*N, Seg) = t.
					// 1. Check against infinite line of segment
					// D = (P - A) dot SegNormal
					// K = N dot SegNormal
					// t = D / (1 - K)  OR  t = -D / (1 + K)

					let vPAx = pt.x - seg.p1.x;
					let vPAy = pt.y - seg.p1.y;
					let D = vPAx * seg.nx + vPAy * seg.ny;
					let K = pt.nx * seg.nx + pt.ny * seg.ny;

					// Check both solutions for line intersection
					let candidates = [];
					if (Math.abs(1 - K) > 1e-4) candidates.push(D / (1 - K));
					if (Math.abs(1 + K) > 1e-4) candidates.push(-D / (1 + K));

					for (let t of candidates) {
						if (t > 1e-4 && t < min_t) {
							// Verify projection falls on segment
							let cx = pt.x + t * pt.nx;
							let cy = pt.y + t * pt.ny;
							let dot = (cx - seg.p1.x) * seg.dx + (cy - seg.p1.y) * seg.dy;
							let u = dot / seg.lenSq;
							if (u >= 0 && u <= 1) {
								min_t = t;
								found = true;
							}
						}
					}

					// 2. Check against endpoints (Corner circles)
					// Solve |P + tN - A| = t
					// t = -|P-A|^2 / (2 * (P-A) dot N)
					let checkEndpoint = (ep) => {
						let vx = pt.x - ep.x;
						let vy = pt.y - ep.y;
						let vSq = vx * vx + vy * vy;
						let vDotN = vx * pt.nx + vy * pt.ny;
						if (Math.abs(vDotN) > 1e-6) {
							let t = -vSq / (2 * vDotN);
							if (t > 1e-4 && t < min_t) {
								min_t = t;
								found = true;
							}
						}
					};
					checkEndpoint(seg.p1);
					checkEndpoint(seg.p2);
				}
			}
		}

		let z = found ? Math.max(minz, -min_t * ve) : maxz;
		// If not found (no collision within maxr), we are in a wide open area -> max depth
		if (!found) z = maxz;

		let radius = found ? min_t : maxr;
		let cx = pt.x + radius * pt.nx;
		let cy = pt.y + radius * pt.ny;

		resultPoints.push({
			x: cx,
			y: cy,
			z: z,
			f: feed, // Feedrate
			contourId: pt.contourId,
			// Visualization info
			ox: pt.x,
			oy: pt.y,
			r: radius
		});
	}

	// --- 4. Generate G-Code ---
	// Simplify and format output
	let gc = "M3 S" + pw + "\nG0 F6000 Z" + safez + "\nG1 F" + feed + "\n";
	let totalmm = 0;
	let oldx = -9999, oldy = -9999, oldz = -9999;
	let lpx = 0, lpy = 0;
	let lastContourId = -1;

	// Split points by contour to handle lifts
	let currentPath = [];

	function flushPath() {
		if (currentPath.length === 0) return;

		// Simplify path (Douglas-Peucker)
		let simplified = simplify3d(currentPath, 0.3 * step, true);

		// Generate G-code for this segment
		// Move to start
		let start = simplified[0];
		gc += "G0 Z" + safez + "\n";
		gc += "G0 F" + travSpeed + " X" + mround2(start.x) + " Y" + mround2(start.y) + "\n";
		gc += "G0 Z" + mround2(start.z) + "\n"; // Plunge to start Z

		// Check distance for pause (heating/spindle dwell)
		let distSq = (start.x - lpx) ** 2 + (start.y - lpy) ** 2;
		if (distSq > pausedist) {
			gc += beforecut_p;
			lpx = start.x;
			lpy = start.y;
		}

		for (let p of simplified) {
			let xpart = (p.x === oldx) ? "" : " X" + mround2(p.x);
			let ypart = (p.y === oldy) ? "" : " Y" + mround2(p.y);
			let zpart = (p.z === oldz) ? "" : " Z" + mround2(p.z);

			if (xpart || ypart || zpart) {
				gc += "G1" + xpart + ypart + zpart + "\n";
				if (oldx !== -9999) {
					totalmm += Math.sqrt((p.x - oldx) ** 2 + (p.y - oldy) ** 2 + (p.z - oldz) ** 2);
				}
				oldx = p.x; oldy = p.y; oldz = p.z;
			}

			// Visualization data
			// segsv format: [ox, oy, id, cx, cy, cz, r, vx, vy, distSq, fs, nd]
			// We map: 0->ox, 1->oy, 3->cx, 4->cy, 5->cz, 6->r, 11->contourId
			segsvdraw.push([p.ox, p.oy, 0, p.x, p.y, p.z, p.r, 0, 0, 0, 0, p.contourId]);
		}
		currentPath = [];
	}

	for (let p of resultPoints) {
		if (p.contourId !== lastContourId) {
			flushPath();
			lastContourId = p.contourId;
		}
		currentPath.push(p);
	}
	flushPath(); // Flush last

	if (totalmm > 0) carvetime += totalmm / (feed / 60.0);
	gc += "G0 Z" + safez + "\n";
	gcodecarve = gc;

	console.timeEnd("vcarve_fast");
}

function vcarve_legacy(maxr, angle, step, path, dstep, dstep2) {
	segsvdraw = [];
	segsv = [];
	if (path.length <= 0) return;
	sqrt = Math.sqrt;
	sqr = function (x) {
		return x * x;
	}
	// segmentation
	var s = 0;
	carvetime = 0;
	gcodecarve = "";
	var pw = parseInt(getvalue('vcarvepw') * 255 * 0.01);
	var beforecut_p = getchecked("carvepause") && (cmd != CMD_LASER) ? "G0 Z0\nM3 S" + pw + " P10000\n" : "";
	var pausedist = getnumber("carvepausedist");
	if (pausedist < 20) pausedist = 20;
	pausedist *= pausedist;

	var pw = parseInt(getvalue('vcarvepw') * 255 * 0.01);
	segmentation = function (nd, path, rev) {
		PL = path.length / 2 - 1; // skip last point is same as first
		var x1, y1, x2, y2, i, dx, dy, L, opx, opy, ovx, ovy, vx, vy, px, py;
		L = 0;
		var firstp;

		for (var p = -1; p <= PL; p++) {
			i = p;
			if (rev) {
				i = PL - i;
			}
			if (i < 0) i = PL - i;
			if (i >= PL) i -= PL;

			x2 = path[i * 2 + 0];
			y2 = path[i * 2 + 1];

			if (p >= 0) {
				L = (sqrt(sqr(x2 - x1) + sqr(y2 - y1)));
				if (L > 0) {
					ovx = vx;
					ovy = vy;
					vx = (x2 - x1) / L;
					vy = (y2 - y1) / L;
					if (p >= 0) {
						L = Math.floor(L / step) + 1;
						dx = (x2 - x1) / L;
						dy = (y2 - y1) / L;

						for (var j = 0; j < L; j++) {
							px = x1 + (j + .5) * dx;
							py = y1 + (j + .5) * dy;
							if (j == 0 && opx) { // if last L ok, interpolate from previous vector, but on same position
								var dot = (vx * ovx) + (vy * ovy);
								cross = (vx * ovy) - (ovx * vy);
								if (Math.abs(cross) > 0.5) {
									dpx = (px - opx);
									dpy = (py - opy);
									OL = sqrt(sqr(dpx) + sqr(dpy));
									NL = Math.floor(OL / step) + 1;
									ndx = (dpx) / NL;
									ndy = (dpy) / NL;
									dpx /= OL;
									dpy /= OL;

									//for (var nj = NL; nj >0; nj--) 
									//{
									nj = 1;
									segsv.push([px - (nj - 0.5) * ndx, py - (nj - 0.5) * ndy, s - 1, 0, 0, 0, 0, dpx, dpy, 0, 0, nd]); //
									//}
								}
							}
							if (p > PL) {
								//segsv.push(firstp);
								return;
							}
							//           x   y  id cx cy cz r             fs
							if (j == 0 && !firstp) firstp = segsv[segsv.length - 1];
							if (p > 0) segsv.push([px, py, s, 0, 0, 0, 0, vx, vy, 0, 0, nd]); // last 3 is to store data
						}
						s++;
					}
					opx = px;
					opy = py;
				}
			}
			x1 = x2;
			y1 = y2;
		}
		//segsv.push(firstp);
	}
	var sc = 1;
	if ($("flipx").checked) sc = 0;
	if ($("flipve").checked) sc = !sc;
	if ($("cutclimb").checked) sc = !sc;

	for (var i = 0; i < path.length; i++) {
		var sc = path[i][1];
		if ($("flipx").checked) sc = 0;
		if ($("flipve").checked) sc = !sc;
		if ($("cutclimb").checked) sc = !sc;
		segmentation(i, path[i][0], sc);
	}
	// create toolpath
	// s= number of line
	var n = 0;
	var gc = "M3 S" + pw + "\nG0 F6000 Z" + getnumber("safez") + "\nG1 F2000\n";
	ve = 1 / Math.tan(angle * Math.PI / 360);

	var minz = -(getvalue("vdiamin") / 2 * ve);
	var jj, seg2, seg1, mr2;
	var maxz = -maxr * ve;
	var ftrav = getvalue("trav") * 60;
	var ffeed = getvalue("vcfeed") * 60;
	var lnd = -1;
	for (var i = 0; i < segsv.length; i++) {
		mr2 = 0; // d squared
		seg1 = segsv[i];
		if (seg1[2] == -1) {
			// move
			continue;
		}
		if (seg1[6] > 0) continue;
		var cx, cy, cz, ox, oy;
		for (var j = 0; j < segsv.length; j++) {
			seg2 = segsv[j];
			if (seg1[2] == seg2[2]) continue; // if on same line dont do it
			seg2[9] = sqr(seg1[0] - seg2[0]) + sqr(seg1[1] - seg2[1]); // store the distance to this segment
		}
		var r = 0;
		for (; r < maxr; r += dstep2) { // iterate from r =0 to maxr
			cx = seg1[0] - r * seg1[8]; // tool position based on the r and segment vector 
			cy = seg1[1] + r * seg1[7];
			k2 = sqr(r);
			k3 = sqr(r * 2);
			for (var j = 0; j < segsv.length; j++) {
				seg2 = segsv[j];
				//  
				if ((seg1[2] == -1) || (seg1[2] == seg2[2]) || (seg2[9] > k3)) continue; // if on same line dont do it
				n++;
				r3 = sqr(cx - seg2[0]) + sqr(cy - seg2[1]);
				if (r3 <= k2) {
					mr2 = r;
					break;
				}
			}
			if (mr2) break;
		}
		var r1 = r;
		var r2 = r;
		var fs = ffeed;
		//if (r > 1) fs = ffeed / (r);
		if (!mr2) {
			cz = maxz;
		} else {
			// recalculate to get more precission
			for (var r = mr2; r > mr2 - dstep2; r -= dstep) {
				cx = seg1[0] - r * seg1[8];
				cy = seg1[1] + r * seg1[7];
				r3 = sqr(cx - seg2[0]) + sqr(cy - seg2[1]);

				if (r3 >= sqr(r)) {
					break;
				}
			}
			r1 = r;
			r2 = r;

			// for other type bit must be different
			cz = -r * ve;


		}
		seg1[3] = cx;
		seg1[4] = cy;
		seg1[5] = cz;
		seg1[6] = r1;
		seg1[10] = fs;

	}

	var rdis;
	var lx = 0;
	var ly = 0;
	var oldz = -100;
	var oldf = -100;
	var oldx = -100;
	var oldy = -100;
	var trav = "";
	var totalmm = 0;


	var points = [];
	function gen_gcode(points) {
		// generate gcode
		if (points.length > 0) {
			points = simplify3d(points, 0.3 * step, true);
			oldx = -1000;
			oldy = -1000;
			oldz = -1000;
			oldf = -1000;
			gfirst = 0;
			for (var i = 0; i < points.length; i++) {
				var p = points[i];
				fpart = "F" + parseInt(p.f);
				xpart = " X" + mround2(p.x);
				ypart = " Y" + mround2(p.y);
				zpart = " Z" + mround2(Math.min(minz, p.z));
				if (oldx == p.x) xpart = "";
				if (oldy == p.y) ypart = "";
				if (oldz == p.z) zpart = "";
				if (oldf == p.f) fpart = "";

				gcur = "G1 " + fpart + xpart + ypart + zpart + "\n";
				gc += gcur;
				totalmm += sqrt(sqr(oldx - p.x) + sqr(oldy - p.y) + sqr(oldz - p.z));
				oldx = p.x;
				oldy = p.y;
				oldz = p.z;
				oldf = p.f;
				segsvdraw.push(segsv[p.i]);
				if (i == 0) gfirst = [segsv[p.i], gcur];
			}
			gc += gfirst[1];
			segsvdraw.push(gfirst[0]);
		}
	}
	var lpx = 0;
	var lpy = 0;
	var cx = 0;
	var cy = 0;
	for (var i = 0; i < segsv.length; i++) {
		seg1 = segsv[i];

		if (lnd != seg1[11]) {
			trav = "G0 Z" + getnumber("safez") + "\n";
			cx = seg1[3];
			cy = seg1[4];
			trav += "G0 F" + ftrav + " X" + mround2(cx) + " Y" + mround2(cy) + "\n";
			trav += "G0 Z0\n";
			lnd = seg1[11];
			continue;
		}

		if (trav) {
			gen_gcode(points);
			points = [];
			gc += trav;
			var dist2 = sqr(lpx - cx) + sqr(lpy - cy);
			if (dist2 > pausedist) {
				gc += beforecut_p;
				lpx = cx;
				lpy = cy;
			}
			trav = "";
		}
		// F is depend on 2*phi*radius
		// 
		var fs = seg1[10];
		points.push({ 'x': seg1[3], 'y': seg1[4], 'z': seg1[5], 'f': fs, 'i': i });

	}
	gen_gcode(points);
	if (fs && totalmm > 0) carvetime += totalmm / (fs / 60.0);
	gc += "G0 Z" + getnumber("safez") + "\n";
	gcodecarve = gc;

}
// Path are in pair of x and y -> [x,y,x,y,x,y,x,y,...]
function vcarve0(maxr, angle, step, path, dstep, dstep2) {
	segsvdraw = [];
	segsv = [];
	if (path.length <= 0) return;
	sqrt = Math.sqrt;
	sqr = function (x) {
		return x * x;
	}
	// segmentation
	var s = 0;
	carvetime = 0;
	gcodecarve = "";
	var pw = parseInt(getvalue('vcarvepw') * 255 * 0.01);
	var beforecut_p = getchecked("carvepause") && (cmd != CMD_LASER) ? "G0 Z0\nM3 S" + pw + " P10000\n" : "";
	var pausedist = getnumber("carvepausedist");
	if (pausedist < 20) pausedist = 20;
	pausedist *= pausedist;

	var pw = parseInt(getvalue('vcarvepw') * 255 * 0.01);
	segmentation = function (nd, path, rev) {
		PL = path.length / 2 - 1; // skip last point is same as first
		var x1, y1, x2, y2, i, dx, dy, L, opx, opy, ovx, ovy, vx, vy, px, py;
		L = 0;
		var firstp;

		for (var p = -1; p <= PL; p++) {
			i = p;
			if (rev) {
				i = PL - i;
			}
			if (i < 0) i = PL - i;
			if (i >= PL) i -= PL;

			x2 = path[i * 2 + 0];
			y2 = path[i * 2 + 1];

			if (p >= 0) {
				L = (sqrt(sqr(x2 - x1) + sqr(y2 - y1)));
				if (L > 0) {
					ovx = vx;
					ovy = vy;
					vx = (x2 - x1) / L;
					vy = (y2 - y1) / L;
					if (p >= 0) {
						L = Math.floor(L / step) + 1;
						dx = (x2 - x1) / L;
						dy = (y2 - y1) / L;

						for (var j = 0; j < L; j++) {
							px = x1 + (j + .5) * dx;
							py = y1 + (j + .5) * dy;
							if (j == 0 && opx) { // if last L ok, interpolate from previous vector, but on same position
								var dot = (vx * ovx) + (vy * ovy);
								cross = (vx * ovy) - (ovx * vy);
								if (Math.abs(cross) > 0.5) {
									dpx = (px - opx);
									dpy = (py - opy);
									OL = sqrt(sqr(dpx) + sqr(dpy));
									NL = Math.floor(OL / step) + 1;
									ndx = (dpx) / NL;
									ndy = (dpy) / NL;
									dpx /= OL;
									dpy /= OL;

									//for (var nj = NL; nj >0; nj--) 
									//{
									nj = 1;
									segsv.push([px - (nj - 0.5) * ndx, py - (nj - 0.5) * ndy, s - 1, 0, 0, 0, 0, dpx, dpy, 0, 0, nd]); //
									//}
								}
							}
							if (p > PL) {
								//segsv.push(firstp);
								return;
							}
							//           x   y  id cx cy cz r             fs
							if (j == 0 && !firstp) firstp = segsv[segsv.length - 1];
							if (p > 0) segsv.push([px, py, s, 0, 0, 0, 0, vx, vy, 0, 0, nd]); // last 3 is to store data
						}
						s++;
					}
					opx = px;
					opy = py;
				}
			}
			x1 = x2;
			y1 = y2;
		}
		//segsv.push(firstp);
	}
	var sc = 1;
	if ($("flipx").checked) sc = 0;
	if ($("flipve").checked) sc = !sc;
	if ($("cutclimb").checked) sc = !sc;

	for (var i = 0; i < path.length; i++) {
		var sc = path[i][1];
		if ($("flipx").checked) sc = 0;
		if ($("flipve").checked) sc = !sc;
		if ($("cutclimb").checked) sc = !sc;
		segmentation(i, path[i][0], sc);
	}
	// create toolpath
	// s= number of line
	var n = 0;
	var gc = "M3 S" + pw + "\nG0 F6000 Z" + getnumber("safez") + "\nG1 F2000\n";
	ve = 1 / Math.tan(angle * Math.PI / 360);

	var minz = -(getvalue("vdiamin") / 2 * ve);
	var jj, seg2, seg1, mr2;
	var maxz = -maxr * ve;
	var ftrav = getvalue("trav") * 60;
	var ffeed = getvalue("vcfeed") * 60;
	var lnd = -1;
	for (var i = 0; i < segsv.length; i++) {
		mr2 = 0; // d squared
		seg1 = segsv[i];
		if (seg1[2] == -1) {
			// move
			continue;
		}
		if (seg1[6] > 0) continue;
		var cx, cy, cz, ox, oy;
		for (var j = 0; j < segsv.length; j++) {
			seg2 = segsv[j];
			if (seg1[2] == seg2[2]) continue; // if on same line dont do it
			seg2[9] = sqr(seg1[0] - seg2[0]) + sqr(seg1[1] - seg2[1]); // store the distance to this segment
		}
		var r = 0;
		for (; r < maxr; r += dstep2) { // iterate from r =0 to maxr
			cx = seg1[0] - r * seg1[8]; // tool position based on the r and segment vector 
			cy = seg1[1] + r * seg1[7];
			k2 = sqr(r);
			k3 = sqr(r * 2);
			for (var j = 0; j < segsv.length; j++) {
				seg2 = segsv[j];
				//  
				if ((seg1[2] == -1) || (seg1[2] == seg2[2]) || (seg2[9] > k3)) continue; // if on same line dont do it
				n++;
				r3 = sqr(cx - seg2[0]) + sqr(cy - seg2[1]);
				if (r3 <= k2) {
					mr2 = r;
					break;
				}
			}
			if (mr2) break;
		}
		var r1 = r;
		var r2 = r;
		var fs = ffeed;
		//if (r > 1) fs = ffeed / (r);
		if (!mr2) {
			cz = maxz;
		} else {
			// recalculate to get more precission
			for (var r = mr2; r > mr2 - dstep2; r -= dstep) {
				cx = seg1[0] - r * seg1[8];
				cy = seg1[1] + r * seg1[7];
				r3 = sqr(cx - seg2[0]) + sqr(cy - seg2[1]);
				//r3=Math.min(r3,sqr(cx-seg2[0]-seg2[7]*step)+sqr(cy-seg2[1]-seg2[8]*step));

				if (r3 >= sqr(r)) {
					break;
				}
			}
			r1 = r;
			r2 = r;

			// for other type bit must be different
			cz = -r * ve;
			//if (r > 3) fs = 3*ffeed / (r);
			/*
			seg2[3] = cx;
			seg2[4] = cy;
			seg2[5] = cz;

			//if (i<jj)r1=r1/2;else r2=r2/2;
			seg2[6] = r;
			seg2[10] = fs;
			//fs=fs*2;
			//*/

		}
		seg1[3] = cx;
		seg1[4] = cy;
		seg1[5] = cz;
		seg1[6] = r1;
		seg1[10] = fs;

	}

	var rdis;
	var lx = 0;
	var ly = 0;
	var oldz = -100;
	var oldf = -100;
	var oldx = -100;
	var oldy = -100;
	var trav = "";
	var totalmm = 0;

	if (1) {
		var points = [];
		function gen_gcode(points) {
			// generate gcode
			if (points.length > 0) {
				points = simplify3d(points, 0.3 * step, true);
				oldx = -1000;
				oldy = -1000;
				oldz = -1000;
				oldf = -1000;
				gfirst = 0;
				for (var i = 0; i < points.length; i++) {
					var p = points[i];
					fpart = "F" + parseInt(p.f);
					xpart = " X" + mround2(p.x);
					ypart = " Y" + mround2(p.y);
					zpart = " Z" + mround2(Math.min(minz, p.z));
					if (oldx == p.x) xpart = "";
					if (oldy == p.y) ypart = "";
					if (oldz == p.z) zpart = "";
					if (oldf == p.f) fpart = "";

					gcur = "G1 " + fpart + xpart + ypart + zpart + "\n";
					gc += gcur;
					totalmm += sqrt(sqr(oldx - p.x) + sqr(oldy - p.y) + sqr(oldz - p.z));
					oldx = p.x;
					oldy = p.y;
					oldz = p.z;
					oldf = p.f;
					segsvdraw.push(segsv[p.i]);
					if (i == 0) gfirst = [segsv[p.i], gcur];
				}
				gc += gfirst[1];
				segsvdraw.push(gfirst[0]);
			}
		}
		var lpx = 0;
		var lpy = 0;
		var cx = 0;
		var cy = 0;
		for (var i = 0; i < segsv.length; i++) {
			seg1 = segsv[i];
			//rdis = sqrt(sqr(lx - seg1[3]) + sqr(ly - seg1[4]));
			/*cx = (seg1[3] + maxofs) * dpm;
			cy = (seg1[4] + maxofs) * dpm;
			lx = seg1[3];
			ly = seg1[4];
			r = seg1[6] * dpm;
			*/
			if (lnd != seg1[11]) {
				trav = "G0 Z" + getnumber("safez") + "\n";
				cx = seg1[3];
				cy = seg1[4];
				trav += "G0 F" + ftrav + " X" + mround2(cx) + " Y" + mround2(cy) + "\n";
				trav += "G0 Z0\n";
				lnd = seg1[11];
				continue;
			}

			if (trav) {
				gen_gcode(points);
				points = [];
				gc += trav;
				var dist2 = sqr(lpx - cx) + sqr(lpy - cy);
				if (dist2 > pausedist) {
					gc += beforecut_p;
					lpx = cx;
					lpy = cy;
				}
				trav = "";
			}
			// F is depend on 2*phi*radius
			// 
			var fs = seg1[10];
			//if (r>1)fs=ffeed/(2*Math.PI*seg1[6]);
			//if (r > dstep) {

			points.push({ 'x': seg1[3], 'y': seg1[4], 'z': seg1[5], 'f': fs, 'i': i });
			//}
			//carvetime += rdis / (fs * 0.0167);
			//r=1;
			//ctx.moveTo(cx+r,cy);
			//ctx.arc(cx,cy,r,0,2*Math.PI);
		}
		gen_gcode(points);
	} else {
		for (var i = 0; i < segsv.length; i++) {
			seg1 = segsv[i];
			rdis = sqrt(sqr(lx - seg1[3]) + sqr(ly - seg1[4]));

			if (lnd != seg1[11]) {
				trav = "G0 Z" + getnumber("safez") + "\n";
				trav += "G0 F" + ftrav + " X" + mround2(seg1[3]) + " Y" + mround2(seg1[4]) + "\n";
				trav += "G0 Z0\n";
				lnd = seg1[11];
				continue;
			}

			if (trav) {
				gc += trav;
				trav = "";
			}
			// F is depend on 2*phi*radius
			// 
			var fs = seg1[10];
			//if (r>1)fs=ffeed/(2*Math.PI*seg1[6]);
			if (r > dstep) {
				fpart = "F" + parseInt(fs);
				xpart = " X" + mround2(seg1[3]);
				ypart = " Y" + mround2(seg1[4]);
				zpart = " Z" + mround2(seg1[5]);
				if (oldx == seg1[3]) xpart = "";
				if (oldy == seg1[4]) ypart = "";
				if (oldz == seg1[5]) zpart = "";
				if (oldf == fs) fpart = "";

				gc += "G1 " + fpart + xpart + ypart + zpart + "\n";
				oldx = seg1[3];
				oldy = seg1[4];
				oldz = seg1[5];
				oldf = fs;
			}
			//r=1;
			//ctx.moveTo(cx+r,cy);
			//ctx.arc(cx,cy,r,0,2*Math.PI);
		}
	}
	if (fs && totalmm > 0) carvetime += totalmm / (fs / 60.0);
	gc += "G0 Z" + getnumber("safez") + "\n";
	gcodecarve = gc;
	//gcode_verify();
}

function drawvcarve() {
	var c = $("myCanvas1");
	var ctx = c.getContext("2d");
	ctx.strokeStyle = "#0000ff";
	ctx.setLineDash([]);
	ctx.beginPath();
	ctx.strokeStyle = "#aaaaaa44";
	var lnd = -1;
	var skip = 0;
	var minr = getvalue("vdiamin") / 2;
	var segsv1 = segsvdraw;
	for (var i = 0; i < segsv1.length; i++) {
		var seg1 = segsv1[i];
		cx = (seg1[3] + maxofs) * dpm;
		cy = (seg1[4] + maxofs) * dpm;
		var r = Math.max(seg1[6], minr) * dpm;
		if (seg1[11] == lnd) {
			lnd = seg1[11];
			continue;
		}
		//r=1;
		ctx.moveTo(cx + r, cy);
		ctx.arc(cx, cy, r, 0, Math.PI * 2);

	}
	ctx.stroke();
	ctx.beginPath();
	ctx.strokeStyle = "#ff0000";
	for (var i = 0; i < segsv1.length; i++) {
		var seg1 = segsv1[i];
		cx = (seg1[3] + maxofs) * dpm;
		cy = (seg1[4] + maxofs) * dpm;
		r = seg1[6] * dpm;
		if (seg1[11] != lnd) {
			ctx.moveTo(cx, cy);
			skip = 0;
			lnd = seg1[11];
			continue;
		}
		if (!skip) ctx.lineTo(cx, cy);
		skip = 0;

	}
	ctx.stroke();
	ctx.beginPath();
	ctx.strokeStyle = "#FFFF0088";
	lnd = -1;
	for (var i = 0; i < segsv1.length; i++) {
		var seg1 = segsv1[i];
		cx = (seg1[0] + maxofs) * dpm;
		cy = (seg1[1] + maxofs) * dpm;
		r = seg1[6] * dpm;
		if (seg1[11] != lnd) {
			ctx.moveTo(cx, cy);
			lnd = seg1[11];
			continue;
		}
		ctx.lineTo(cx, cy);
	}
	ctx.stroke();

}
var cglines = [];
var realofs = 0;

function pocketcarve(tofs, ofs1, clines) {
	realofs = tofs;
	if (cmd == CMD_LASER) tofs = getnumber("clstep");
	if (cmd == CMD_CNC) tofs = Math.min(tofs * 0.8, getnumber("clstep"));
	if (tofs < 0.2) tofs = 0.2;
	if (ofs1 < 0.2) ofs1 = 0.2;
	var paths = [];
	cglines = [];
	var glines = [];
	var scale = 1000;
	var detail = getvalue("curveseg") * scale * 0.5;
	var pathsdeep = {};

	for (var ci in clines) {
		var path = [];
		var lines = clines[ci][0];
		var deep = clines[ci][1]
		if (!pathsdeep[deep]) pathsdeep[deep] = [];

		for (var i = 0; i < lines.length / 2; i++) {
			x = lines[i * 2] * scale;
			y = lines[i * 2 + 1] * scale;
			path.push({
				X: x,
				Y: y
			});
		}
		pathsdeep[deep].push(path);
	} {
		var clk = 1; //isClockwise(path, "X", "Y");
		//}
		//  var paths = [[{X:30,Y:30},{X:130,Y:30},{X:130,Y:130},{X:30,Y:130}],[{X:60,Y:60},{X:60,Y:100},{X:100,Y:100},{X:100,Y:60}]]; 

		for (var kd in pathsdeep) {
			var paths = pathsdeep[kd];
			deep = kd;
			var ofs = realofs / 2 - tofs;// -0.1;
			var last = 0;
			var first = 1;
			var maxx = 150;
			var inum = 0;
			while (maxx-- > 0) {
				// increase tool offset
				ofs += tofs;
				inum++;
				var co = new ClipperLib.ClipperOffset(); // constructor
				var offsetted_paths = new ClipperLib.Paths(); // empty solution		
				co.Clear();

				co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
				co.MiterLimit = 2;
				co.ArcTolerance = 20;
				var delta = ofs * scale;
				//if (!clk)delta=-delta;
				var r = co.Execute(offsetted_paths, -Math.abs(delta));
				// if no more then break
				if (offsetted_paths.length <= 0) {
					break;
					if (last) break;
					last = 1;
					ofs -= tofs * 1.5;
					continue;
				}
				// mask as not last
				for (var k = 0; k < glines.length; k++) {
					//glines[k][6]=0;
				}

				var ox = 0;
				var oy = 0;
				for (var i = 0; i < offsetted_paths.length; i++) {
					var newline = [];
					var path = offsetted_paths[i];
					var path = ClipperLib.JS.Lighten(path, detail);
					var s = 0;
					var ds = 0;
					var cx = 0;
					var cy = 0;
					if (path.length) {
						for (var j = 0; j < path.length; j++) {
							var jj = j;
							if (clk) jj = path.length - 1 - j;
							var l = path[jj];
							x = l.X * 1.0 / scale;
							y = l.Y * 1.0 / scale;
							if (j > 0) {
								ds = sqrt(sqr(x - ox) + sqr(y - oy));
							}
							s += ds;
							cx += x;
							cy += y;
							ox = x;
							oy = y;
							newline.push([x, y, ds]);
						}
						///*

						var l = path[0];
						if (clk) l = path[path.length - 1];
						x = l.X * 1.0 / scale;
						y = l.Y * 1.0 / scale;
						newline.push([x, y, ds]);
						//*/
						glines.push([newline, s, cx / path.length, cy / path.length, deep, delta, first, inum]);
					}
				}
				first = 0;
			}
		}
	}
	cglines = glines;


}
// draw and together convert to gcode
var slowthreshold;

function area_Maxdis(cx, cy, liness2) {
	var mdis = 100000;
	for (var j = 0; j < liness2.length; j++) {
		var olines = liness2[j];
		var mdis2 = 100000;
		for (var ni = 0; ni < olines.length; ni++) {
			var seg2 = olines[ni];
			var d = sqr(cx - seg2[0]);
			d += sqr(cy - seg2[1]);
			mdis2 = Math.min(mdis2, d);
		}
		mdis = Math.min(mdis, mdis2);
	}
	if (mdis > slowthreshold) {
		return 1;
	}
	return 0
}

var pockettime = 0;
var already = [];

function pocketgcode() {
	//return;
	pockettime = 0;
	if (cglines.length == 0) return;
	var carvedeep = getnumber('carved');
	var f2 = getnumber('vcarvefeed') * 60;
	var f3 = f2 * 0.7; //getnumber('vcarvefeed2') * 60;
	var f1 = f2;
	if (cmd == CMD_CNC) {
		f2 = getnumber('vcarvefeed') * 60;
		var f1 = getnumber('trav') * 60;
	}
	var fs = f2 / 60;
	var pdn = getvalue('pdn') + "\n";
	var overs = getvalue('overshoot') * 1;
	if (cmd == CMD_CNC) overs = 0;

	var rz = getnumber("carvedp");
	var rz1 = getnumber("firstd");
	slowthreshold = (realofs * realofs * getvalue('slowth'));
	if (slowthreshold < 0) slowthreshold = 0;
	if (rz <= rz1) slowthreshold = 0;
	var re = Math.ceil(carvedeep / rz);
	var re1 = Math.ceil(carvedeep / rz1);
	if (re1 < re) re1 = Math.ceil(carvedeep / getnumber("clstep")); // try to auto the repeat number
	if (cmd == CMD_LASER) re1 = re = 1;
	//var rz = carvedeep / re;
	//var rz1 = carvedeep / re1;
	var zup = Math.min(getvalue('safez') * 1, zretract);
	var pup = "G0 F" + speedretract + " Z" + zup + "\n";
	var pup2 = "G0 F" + speedretract + " Z0\n";
	if (cmd == CMD_LASER) {
		pup = getvalue('pup') + "\n";
		pup2 = pup;
	}
	var pw = parseInt(getvalue('vcarvepw') * 255 * 0.01);
	var gc = pup + "M3 S" + pw + "\nG0 F" + f1 + "\nG1 F" + f2 + "\n";
	var beforecut = "";
	var beforecut_p = getchecked("carvepause") && (cmd != CMD_LASER) ? "G0 Z0\nM3 S" + pw + " P10000\n" : "";
	var pausedist = getnumber("carvepausedist");
	if (pausedist < 20) pausedist = 20;
	pausedist *= pausedist;
	gc += pup;
	e1 = 0;
	var sortit = 1;
	var lx = 0;
	var ly = 0;
	var clx = 0;
	var cly = 0;
	var sglines = [];
	var mins = [];
	var first = 1;
	var lastlines = [];
	var lastcut = [];
	for (var j = 0; j < cglines.length; j++) {
		var cs = -1;
		var bg = 1000000000;
		var shifti = 0;
		for (var i = 0; i < cglines.length; i++) {

			var isslow = 0;
			if (cglines[i][5] >= 0) {
				var mind = 1000000000;
				var pp = cglines[i][0];
				// find the real minimum distance
				var shift = 0;
				//lastcut.push(lastlines);
				for (var ii = 0; ii < pp.length; ii += 2) {
					cx = pp[ii][0];
					cy = pp[ii][1];
					if (slowthreshold > 0 && !isslow) isslow = area_Maxdis(cx, cy, lastcut);
					var disi = (sqr(cx - lx) + sqr(cy - ly));
					if (disi < mind) {
						mind = disi;
						shift = ii;
						clx = pp[ii][0];
						cly = pp[ii][1];

					}
				}
				//lastcut.pop();

				var dis = mind;// - cglines[i][5] *1; // distance - depth + area size
				if (first) {
					dis -= cglines[i][5] * 5;
					//if (isslow) dis += cglines[i][1] * 10;
				}
				//if (first){
				//    dis-=cglines[i][5]*10;
				//}
				//var dis = sqrt(dx * dx + dy * dy); // distance + if outside, give area number so it will become last

				if ((dis < bg)) {
					slow = isslow;
					cs = i;
					bg = dis;
					shifti = shift;
				}
			}
		}
		// smalles in cs
		if (cs >= 0) {
			//slow=first;
			mins.push([first, cs, lx, ly, bg, shifti]);
			var lines = cglines[cs][0];

			lx = lines[shifti][0];
			ly = lines[shifti][1];


			//if (slow){
			lastcut.push(lines);
			//}
			sglines.push([lines, cglines[cs][1], cglines[cs][4], cglines[cs][6], shifti, first ? f3 : f2, slow, first]);
			first = cglines[cs][6];
			cglines[cs][5] = -1;
			lastlines = lines;
		}
	}

	var ox = -1000;
	var oy = 0;
	var lz = 0;
	var la = 0;
	var lpx = -1000;
	var lpy = -1000;
	var climbcut = $("carveclimb").checked;
	already = [];
	var pup2a;
	for (var j = 0; j < sglines.length; j++) {
		gline = sglines[j][0];
		f2 = sglines[j][5];
		gline = arrayRotate(gline, sglines[j][4]);
		var _re = Math.ceil(sglines[j][2] / (j == 0 ? rz1 : rz));
		if (CMD_CNC) {
			// kentul kentul jare pak adit
			pup2 = re == 1 ? "" : "G0 F" + speedretract + " Z" + mround(-sglines[j][2] / re) + "\n";

		}
		var _rz = sglines[j][2] / (_re);
		var a = sglines[j][1];
		// check if this line if need to thread as slow or fast
		var slow = sglines[j][6];
		//console.log(j+","+i+":"+mdis);
		if (slow) { //sglines[j][3]){
			// recalculate repeat and rz only for last/ inner most
			_re = Math.ceil(sglines[j][2] / rz1);
			_rz = sglines[j][2] / (_re);
			zz = -(r + 1) * _rz;

		}
		var lstF = 0;
		var jump;
		for (var r = 0; r < _re; r++) {
			var zz = -(r + 1) * _rz;
			for (var ni = 0; ni <= gline.length; ni++) {
				var i = gline.length - ni; // flip the path (for smooth)
				if (climbcut) i = ni;
				if (i == gline.length) i = 0;
				var seg1 = gline[i];
				cx = seg1[0];
				cy = seg1[1];

				if (ni == 0) {
					jump = ((r == 0) && ((sqr(ox - cx) + sqr(oy - cy) > sqr(realofs * 2)))); // decide we need to move up z or not
					var dist2 = sqr(lpx - cx) + sqr(lpy - cy);
					var bfc = beforecut;
					if (dist2 > pausedist) {
						bfc = beforecut_p;
						lpx = cx;
						lpy = cy;
					}
					gc += jump ? pup : (r == 0 ? pup2 : "");
					gc += "G0 F" + (jump ? f1 : f2) + " X" + mround(cx) + " Y" + mround(cy) + "\n";
					if (jump) gc += "G0 Z0 F" + speedretract + "\n";
					gc += (jump ? bfc : "") + pdn.replace("=cncz", mround(zz));
					lstF = 0;
				} else {
					gc += (lstF != f2 ? ("G1 F" + f2) : "G1") + " X" + mround(cx) + " Y" + mround(cy) + "\n";
					lstF = f2;
				}

				if (ox != -1000) {
					pockettime += Math.sqrt(sqr(cx - ox) + sqr(cy - oy)) / fs;
				}
				ox = cx;
				oy = cy;
			}
			lz = zz;
		}
		already.push([gline, slow, sglines[j][6]]);

		la = a;
		//gc += pup;

	}



	gc += pup;
	//if (ENGRAVE==1)
	gc = getvalue("engcode") + gc;
	setvalue("engcode", gc);

}


function drawpocket() {
	var fs = getvalue('rasterfeed') * 1;
	var c = $("myCanvas1");
	var ctx = c.getContext("2d");
	for (var j = 0; j < already.length; j++) {
		gline = already[j][0];
		ctx.beginPath();
		ctx.setLineDash([]);
		if (already[j][1]) ctx.setLineDash([]);
		else ctx.setLineDash([]);
		if (already[j][2]) ctx.strokeStyle = "#F000F0";
		else ctx.strokeStyle = "#C080C0";
		var ox, oy;
		for (var ni = -1; ni < gline.length; ni++) {
			var i = ni;
			if (i < 0) i = gline.length - 1;
			var seg1 = gline[i];
			cx = (seg1[0] + maxofs) * dpm;
			cy = (seg1[1] + maxofs) * dpm;
			if (ni >= 0) {
				ctx.moveTo(ox, oy);
				ctx.lineTo(cx, cy);
			}
			ox = cx;
			oy = cy;
		}
		ctx.stroke();
	}
}

function dobtvcarve() {
	var r = Math.max(sxmax, symax) / getvalue("vres");
	vcarve(getvalue("vdia") / 2, getvalue("vangle") * 1, r, veeline, 0.00002 * getvalue("vdia"), 0.01 * getvalue("vdia"));
}
setclick("btvcarve", dobtvcarve);

function dopocketengrave() {
	pocketcarve(getoffset(), 0, conline);
	pocketgcode();
	drawpocket();
}
//setclick("btconengrave", dopocketengrave);

var bitmaptime = 0;


function imagedata_to_image(imagedata) {
	var canvas = document.createElement('canvas');
	var ctx = canvas.getContext('2d');
	canvas.width = imagedata.width;
	canvas.height = imagedata.height;
	ctx.putImageData(imagedata, 0, 0);

	var image = new Image();
	image.src = canvas.toDataURL();
	return image;
}


var bitFiles = [];

function addBit(canvas) {
	// Get canvas context
	const ctx = canvas.getContext('2d');
	const width = canvas.width;
	const height = canvas.height;

	// Create 1-bit bitmap data
	const stride = Math.ceil(width / 8);
	const data = new Uint8Array(4 + height * stride); // 4 bytes for width/height

	// Write dimensions (2 bytes each)
	new DataView(data.buffer).setUint16(0, width, true);
	new DataView(data.buffer).setUint16(2, height, true);

	// Convert pixels to 1-bit
	const imageData = ctx.getImageData(0, 0, width, height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			const pixel = imageData.data[i * 4] > 128 ? 1 : 0; // Simple threshold
			const byteIdx = 4 + y * stride + Math.floor(x / 8);
			const bitPos = 7 - (x % 8);
			data[byteIdx] |= (pixel << bitPos);
		}
	}
	bitFiles.push(data);
}
var USEBITMODE = 1;
function imagedither(imgpic, canv, ofx, ofy, rwidth, rheight, mtx) {
	var sierra2 = [6, 2, 1, 4, 7, 4, 1, 1, 5, 1];
	var sierra2 = [5, 3, 2, 4, 5, 4, 2, 2, 3, 2];
	var floyd1 = [7, 4, 4, 1];
	var c = canv; //document.getElementById("myCanvas");
	var img = imgpic; //document.getElementById("thepic");
	overshot = getvalue("overshoot");
	var maxpoint = getvalue("imgresmax");
	var ydpi = getvalue("rasterdpi");
	mwidth = rwidth / maxpoint;
	mheight = rheight / maxpoint;

	// transform canvas size

	var p1 = mx1([0, 0], mtx);
	var p2 = mx1([mwidth, 0], mtx);
	var p3 = mx1([mwidth, mheight], mtx);
	var p4 = mx1([0, mheight], mtx);
	var pxmin = Math.min(...[p1[0], p2[0], p3[0], p4[0]]);
	var pxmax = Math.max(...[p1[0], p2[0], p3[0], p4[0]]);
	var pymin = Math.min(...[p1[1], p2[1], p3[1], p4[1]]);
	var pymax = Math.max(...[p1[1], p2[1], p3[1], p4[1]]);



	c.width = pxmax - pxmin;
	c.height = pymax - pymin;
	ofx += pxmin * maxpoint;
	ofy += pymin * maxpoint;
	var inv = $("imginvert").checked;
	var ctx = c.getContext("2d", { willReadFrequently: true });
	// fill ctx with white
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, c.width, c.height);

	var rmheight = parseInt(rheight / (25.5 / ydpi));
	var mw = c.width * rwidth / mwidth;
	var mh = c.height * rheight / mheight;
	var dotscale = mw / c.width;

	var ystep2 = rheight / rmheight;//  mh / c.height; // y machine step, each step will be lasered by ystep/0.2 zigzag,   
	var ystep = mh / c.height; // y machine step, each step will be lasered by ystep/0.2 zigzag,   
	var xstep = mw / c.width; // y machine step, each step will be lasered by ystep/0.2 zigzag,   

	// create clipping to the ctx from engravebounds
	if (engravebounds.length) {
		ctx.beginPath();
		for (var b = 0; b < engravebounds.length; b++) {
			var bounds = engravebounds[b][0];
			if (bounds.length > 0) {
				var start = [(bounds[0][0] - ofx) / xstep, (bounds[0][1] - ofy) / ystep];
				ctx.moveTo(start[0], start[1]);
				for (var p = 1; p < bounds.length; p++) {
					var point = [(bounds[p][0] - ofx) / xstep, (bounds[p][1] - ofy) / ystep];
					ctx.lineTo(point[0], point[1]);
				}
				ctx.closePath();
			}
		}
		ctx.clip();
	}

	ctx.transform(mtx[0], mtx[1], mtx[2], mtx[3], -pxmin, -pymin);



	// create temporary context to draw the image and we do grayscale convert, gamma, sharpening
	var c2 = document.createElement('canvas');
	var ctx2 = c2.getContext("2d");
	c2.width = Math.min(1024, img.width);
	c2.height = Math.min(1024, img.height);
	ctx2.drawImage(img, 0, 0, c2.width, c2.height);
	var bm = ctx2.getImageData(0, 0, c2.width, c2.height);

	var i, j;
	var row = c.width * 4;
	var speed1 = getnumber('rasterfeed');
	var speed = speed1 * 60;
	var pw = getnumber('rasterpw') * 0.01 * 255;
	var metode = getvalue("dithermode") * 1;
	var dx, dy;
	dx = 1;
	dy = 1;
	if (metode == 2) {
		dx = 2;
		dy = 2;
	}
	if (metode == 3) {
		dx = 0;
		dy = 0;
	}
	// make it grayscale first
	var waktu = 0;
	var w0 = 0;
	var w1 = 0;

	let gcodess = [];
	gcodess.push(`M3 S${Math.round(pw)}\nG0 F${speed}\nG1 F${speed}\n`);
	bmd = [];
	var minPixel = 255;
	var maxPixel = 0;
	// ====
	// Extract grayscale data
	var grayscaleData = new Float32Array(c2.width * c2.height);
	var minPixel = 1;
	var maxPixel = 0;

	for (var j = 0; j < c2.height; j++) {
		for (var i = 0; i < c2.width; i++) {
			var idx = (j * c2.width + i) * 4;
			var pixelValue = (0.3 * bm.data[idx] + 0.5 * bm.data[idx + 1] + 0.2 * bm.data[idx + 2]);
			grayscaleData[j * c2.width + i] = pixelValue;
			minPixel = Math.min(minPixel, pixelValue);
			maxPixel = Math.max(maxPixel, pixelValue);
		}
	}

	// Apply auto-leveling, gamma correction, and brightness
	var range = maxPixel - minPixel;
	var gamma = getvalue("gamma") * 1.0;
	var bright = getvalue("brightness") * 1.0;

	for (var j = 0; j < c2.height; j++) {
		for (var i = 0; i < c2.width; i++) {
			var idx = j * c2.width + i;
			var normalized = (grayscaleData[idx] - minPixel) / range;
			var gammaCorrect = Math.pow(normalized, 1 / gamma);
			var brightened = gammaCorrect + (bright / 255);
			grayscaleData[idx] = brightened;//Math.round(Math.max(0, Math.min(1, brightened)) * 255);
		}
	}

	// Apply sharpness
	var sharpness = getvalue("sharpness") * 1.0 || 0;
	if (sharpness > 0) {
		var tempData = new Float32Array(grayscaleData.length);
		var amount = sharpness * 5;
		var radius = Math.ceil(getvalue("radius") * 1);
		var threshold = 0;

		for (var j = radius; j < c2.height - radius; j++) {
			for (var i = radius; i < c2.width - radius; i++) {
				var idx = j * c2.width + i;
				var sum = 0;
				var count = 0;
				for (var y = -radius; y <= radius; y++) {
					for (var x = -radius; x <= radius; x++) {
						var curIdx = (j + y) * c2.width + (i + x);
						sum += grayscaleData[curIdx];
						count++;
					}
				}
				var blur = sum / count;
				var diff = grayscaleData[idx] - blur;
				if (Math.abs(diff) > threshold) {
					tempData[idx] = grayscaleData[idx] + diff * amount;
				} else {
					tempData[idx] = grayscaleData[idx];
				}
			}
		}

		for (var i = 0; i < grayscaleData.length; i++) {
			grayscaleData[i] = tempData[i] + bright;
		}
	}

	// Apply processed grayscale data back to the bitmap
	var inv = $("imginvert").checked;
	for (var j = 0; j < c2.height; j++) {
		for (var i = 0; i < c2.width; i++) {
			var idx = j * c2.width + i;
			var oldr = Math.min(255, Math.max(0, Math.round(grayscaleData[idx] * 255)));
			if (inv) oldr = 255 - oldr;
			var a = j * c2.width * 4 + i * 4;
			bmd[a] = oldr;
			bm.data[a] = oldr;
			bm.data[a + 1] = oldr;
			bm.data[a + 2] = oldr;
			bm.data[a + 3] = 255; // Assuming full opacity
		}
	}

	// draw processed image to the canvas ctx using drawimage, so it will be clipped
	ctx2.putImageData(bm, 0, 0);


	ctx.drawImage(c2, 0, 0, mwidth, mheight);
	ctx.resetTransform();
	bm = ctx.getImageData(0, 0, c.width, c.height);


	// dither it
	if (metode < 4) {

		function mround(x) {
			return Math.round(x * 1000) / 1000;
		}

		var num = 3;
		var dv = num / 256.0;
		var mul = (255.0 / (num - 1));
		var shf = 1; //1.0*getvalue("shf");;
		var bp = 10;
		var jk = 0;
		var lj = -1;
		var gc = "";
		var pxstart = c.width;
		var pxstop = 0;
		var skip = 1;
		var row = c.width * 4;
		var dx = 1; // Assuming dx is 1, adjust if necessary
		//var rmheight = c.height; // Assuming rmheight is the height of the canvas
		var lsofs = -getnumber("laserofs") / 2;

		for (var jj = 0; jj < rmheight; jj += 1) {
			var j = parseInt(jj * c.height / rmheight);
			if (j != lj) {
				gc = "";
				pxstart = c.width;
				pxstop = 0;
				skip = 1;

				for (var i = dx; i < c.width - dx; i += 1) {
					var a = j * row + i * 4;
					var oldr = bm.data[a];
					var gr = 0;
					var newr;

					if (metode == 0) {
						newr = Math.max(4, Math.min(250, oldr + gr));
					} else if (metode < 3) {
						gr += 128;
						newr = oldr > gr ? 255 : 0;
					} else if (metode == 3) {
						newr = oldr + gr > 128 ? 255 : 0;
					}

					var err = oldr - newr;
					var cc = String.fromCharCode(Math.floor((255 - newr) / 10) + 97);

					if (cc == 'a') {
						w0++;
					} else {
						skip = 0;
						w1++;
						pxstart = Math.min(pxstart, i);
						pxstop = Math.max(pxstop, i);
					}

					gc += cc;
					bm.data[a + 0] = 128;
					bm.data[a + 1] = 128;
					bm.data[a + 2] = 255;
					bm.data[a + 3] = newr ? 0 : 255;

					if (metode == 0) { // grayscale
						err /= 16;
						bm.data[a + 4] += err * 7;
						bm.data[a + row - 4] += err * 4;
						bm.data[a + row] += err * 4;
						bm.data[a + row + 4] += err * 1;
					} else if (metode == 1) { // with floyd matrix
						err /= 16;
						var em = floyd1;
						bm.data[a + 4] += err * em[0];
						bm.data[a + row - 4] += err * em[1];
						bm.data[a + row] += err * em[2];
						bm.data[a + row + 4] += err * em[3];
					} else if (metode == 2) {// with sierra matrix
						err /= 32;
						var em = sierra2;
						bm.data[a + 4] += err * em[0];
						bm.data[a + 8] += err * em[1];
						bm.data[a + row - 8] += err * em[2];
						bm.data[a + row - 4] += err * em[3];
						bm.data[a + row] += err * em[4];
						bm.data[a + row + 4] += err * em[5];
						bm.data[a + row + 8] += err * em[6];
						bm.data[a + 2 * row - 4] += err * em[7];
						bm.data[a + 2 * row] += err * em[8];
						bm.data[a + 2 * row + 4] += err * em[9];
					}
				}

				lj = j;
				gc += "a";
			}

			if (!skip) {


				var ipxstart = Math.max(0, pxstart - 6);
				var ipxstop = Math.min(gc.length - 1, pxstop + 6);

				var px1 = mround(dotscale * ipxstart + ofx);
				var px2 = mround(dotscale * ipxstop + ofx);
				var dir = jj % 2 == 0 ? -1 : 1;
				var idx = dir == -1 ? ipxstop : ipxstart;
				var xstep = mw / gc.length;
				var zstep = zdown / 25;
				var lv = "a";
				var x = xstep * idx + ofx - dir * overshot;

				//gcode += "G0 X" + mround(x) + " Y" + mround((jj) * ystep2 + ofy) + "\n";
				gcodess.push(`G0 X${mround(x)} Y${mround(jj * ystep2 + ofy)}\n`);
				var gcodes2 = [];
				var gctr = 0;
				var lx = x;

				for (var i = ipxstart; i <= ipxstop; i++) {
					var v = gc[idx];
					x = xstep * idx + ofx + lsofs * dir;
					var brk = Math.abs(lx - x) > 150;

					if (v != lv || brk) {
						gctr++;
						if (lv == 'a') {
							// gcodes += "G0 X" + mround(x) + "\n";
							// if (brk) gcodes += "G1 X" + mround(x) + "\n";
							gcodes2.push(`G0 X${mround(x)}\n`);
							if (brk) gcodes2.push(`G1 X${mround(x)}\n`);
						} else {
							// gcodes += "G1 X" + mround(x) + "\n";
							// if (brk) gcodes += "G0 X" + mround(x) + "\n";
							gcodes2.push(`G1 X${mround(x)}\n`);
							if (brk) gcodes2.push(`G0 X${mround(x)}\n`);
						}
						lv = v;
					}

					idx += dir;
				}

				gcodess.push(`;REP:${gctr}\n${gcodes2.join('')}\n`);
				waktu += 1.32 * (px2 - px1) / speed1;
				jk++;
			}
		}

	}
	pc = 100 * w1 / (w1 + w0);
	bitmaptime += waktu;
	//gcode += "G0 X0 Y0\nM3 S0\n";
	gc = `${getvalue("engcode")}//LOADBIT${bitFiles.length}\n${gcodess.join('')}//UNLOADBIT\n`;
	setvalue("engcode", gc);
	ctx.putImageData(bm, 0, 0);
	// draw the engrave
	var img1 = new Image();
	rwidth = rwidth * (c.width / mwidth);
	rheight = rheight * (c.height / mheight);
	addBit(c);
	img1.src = canv.toDataURL();
	img1.onload = function () {
		var c = $("myCanvas1");
		var ctx = c.getContext("2d");
		ctx.drawImage(img1, (ofx + maxofs) * dpm, (ofy + maxofs) * dpm, rwidth * dpm, rheight * dpm);
	}
};


function cncengrave(imgpic, canv, ofx, ofy, rwidth, rheight, mtx) {
	var maxi = 0;
	var mini = 255;
	var bmd = [];
	var bmdz = [];
	var bmw = 0;
	var bmh = 0;
	var mw = 0;
	var mh = 0;
	var gcodes = [];
	var maxpoint = 1;

	var beforecut_p = getchecked("carvepause") && (cmd != CMD_LASER) ? "G0 Z0\nM3 S" + pw + " P10000\n" : "";
	var pausedist = getnumber("carvepausedist");
	if (pausedist < 20) pausedist = 20;

	var feedmethod = getvalue("egfeedmethod");
	var endmill = getnumber("egendmill");
	var r = getnumber("egdia") * 0.5;
	var toolr = r;
	//ofx+=r;
	//ofy+=r;
	var feed = getnumber("egspeed") * 60;
	var skip = 1;
	var rep1 = getnumber("egrepeat1");
	var rep2 = getnumber("egrepeat2");
	var c = canv;
	var img = imgpic;

	var isclimb = getchecked("egclimb");
	var canreverse = getchecked("egreverse");
	var flip = $("egflip").checked;
	var d = 0; //getvalue("dia")*0.75;
	var dx = 0;
	var dy = 0;

	//if ($("egsharpen").checked)sharpen(ctx,c.width,c.height,0.5);
	var p1 = mx1([0, 0], mtx);
	var p2 = mx1([rwidth, 0], mtx);
	var p3 = mx1([rwidth, rheight], mtx);
	var p4 = mx1([0, rheight], mtx);
	var pxmin = Math.min(...[p1[0], p2[0], p3[0], p4[0]]);
	var pxmax = Math.max(...[p1[0], p2[0], p3[0], p4[0]]);
	var pymin = Math.min(...[p1[1], p2[1], p3[1], p4[1]]);
	var pymax = Math.max(...[p1[1], p2[1], p3[1], p4[1]]);
	var mwidth = getnumber("egwidth");
	var scX = mwidth / rwidth;
	var scY = scX;//mheight/rheight;
	var mheight = rheight * scY;
	c.width = (pxmax - pxmin) * scX;
	c.height = (pymax - pymin) * scY;
	var ctx = c.getContext("2d");
	ctx.fillStyle = getchecked("eginvert") ? "#000000" : "#FFFFFF";
	ctx.fillRect(0, 0, c.width, c.height);
	ctx.transform(mtx[0], mtx[1], mtx[2], mtx[3], -pxmin * scX, -pymin * scY);


	ofx += pxmin;
	ofy += pymin;

	//ctx.transform(1,0,0,1,0,0);
	ctx.drawImage(img, 0, 0, mwidth, mheight);
	//	ctx.drawImage(img, 0, 0, c.width, c.height);
	ctx.resetTransform();
	var bm = ctx.getImageData(0, 0, c.width, c.height);
	// invert colors
	var isinvert = getchecked("eginvert");
	bmw = c.width;
	bmh = c.height;
	var i, j;
	var row = bmw * 4;
	// make it grayscale first
	var gamma = getnumber("eggamma");
	var mw = c.width * rwidth / mwidth;
	var mh = c.height * rheight / mheight;
	var stepx = mw / bmw;
	var stepy = mh / bmh;
	$("vstepx").innerHTML = mround2(stepx) + "mm";
	$("vstepy").innerHTML = mround2(stepy) + "mm";
	//var mh=mw*c.height/c.width;
	var dotscale = mw / bmw;

	var ystep = mh / bmh; // y machine step, each step will be lasered by ystep/0.2 zigzag,  
	bmd = [];
	for (var j = 0; j < bmh; j += 1) {
		for (var i = 0; i < bmw; i += 1) {
			var a = j * row;
			if (flip) a += (row - i * 4);
			else a += i * 4;
			oldr = (0.3 * bm.data[a] + 0.5 * bm.data[a + 1] + 0.2 * bm.data[a + 2]);
			if (isinvert) oldr = 255 - oldr;
			oldr = Math.pow((oldr / 255.0), (1.0 / gamma)) * 254;

			//alp=(bm.data[a+3])/255.0;
			//oldr=(oldr*(alp))+(255*(1-alp));

			var a = j * bmw + i;
			//oldr=255-oldr;
			//if (oldr<254)
			maxi = Math.max(maxi, oldr);
			mini = Math.min(mini, oldr);
			bmd[a] = oldr;
			bmdz[a] = oldr;
		}
	}
	var sc = 254 / (maxi - mini);
	if (!$("egnormal").checked) {
		sc = 1;
		mini = 0;
	}
	for (var j = 0; j < bmh; j += 1) {
		for (var i = 0; i < bmw; i += 1) {
			var a = j * bmw + i;
			oldr = (bmd[a] - mini) * sc;
			bmd[a] = oldr;
			a = j * row + i * 4;
			//oldr=255-oldr;
			//bm.data[a]=oldr;
			//bm.data[a+1]=oldr;
			//bm.data[a+2]=oldr;
			//bm.data[a+3]=255;
		}
	}
	// dither it

	var zdown = getnumber("egzdown");
	var zup = getnumber("egzup");
	var zdelta = zdown + zup;
	var waktu = 0;
	var w0 = 0;
	var w1 = 0;
	var row = bmw;

	var stepx = mw / bmw;
	var stepy = mh / bmh;

	var r2 = sqr(r);
	var rx = r / stepx;
	var ry = r / stepy;
	var rd = [];
	var ri = 0;
	var ve = 1.0 / Math.tan(getnumber("egvangle") * Math.PI / 360);
	var rv = ve * r;
	// generate tool shape for ballnose

	for (var ji = -Math.ceil(ry); ji <= ry; ji++) {
		for (var ii = -Math.ceil(rx); ii <= rx; ii++) {
			// flat bit
			//var addr=Math.floor(ji*row)+Math.floor(ii);
			var addr = ji * row + ii;
			if (endmill == 2) {
				lr = sqr(ii * stepx) + sqr(ji * stepy);
				if (lr <= r2) rd.push([addr, 0, ii, ji]);
			}
			// v bit
			if (endmill == 0) {
				lr = sqr(ii * stepx) + sqr(ji * stepy);
				c2 = sqrt(lr) * ve; //  0  1         2  3  4          5 
				if (lr <= r2) rd.push([addr, c2, ii, ji]);
			}
			// ballnose
			if (endmill == 1) {
				lr = sqr(ii * stepx) + sqr(ji * stepy);
				c2 = r2 - (lr); //  0  1         2  3  4          5 
				if (c2 >= 0) rd.push([addr, r - sqrt(c2), ii, ji]);
			}
		}
	}

	zscale = zdelta / 255.0;
	gcodes = [];
	var n = 0;
	var lx, ly, lz;
	lz = 0;
	var totalz = 0;
	var total = mw * mh / stepy;
	var zmline = [];
	rx = 0;
	ry = 0;
	for (var j = 0; j < bmh; j += 1) {
		var zmax = 0;
		for (var i = 0; i < bmw; i += 1) {
			// lets check surrounding area
			var isin = 1;
			if (engravebounds.length) {
				var xp = i * stepx + ofx;
				var yp = j * stepy + ofy;
				isin = false;
				isin = false;
				for (var b = 0; b < engravebounds.length; b++) {
					isin = isInside(xp, yp, engravebounds[b][0]);
					if (engravebounds[b][9].parent.length) isin = !isin;
					if (!isin) break;
				}
			}
			var cp = j * row + i;
			var zm = 1000;
			if (isin) {
				for (var k = 0; k < rd.length; k++) {
					var rdk = rd[k];
					//skip if outside tool
					if ((j + rdk[3] < 0) || (j + rdk[3] > bmh) ||
						(i + rdk[2] < 0) || (i + rdk[2] > bmw)) continue;
					//
					zp = (255 - bmd[cp + rdk[0]]) * zscale + rdk[1];
					if (zp < zm) zm = zp;

				}
				// if roughing then add up 1mm
			} else zm = -1;
			if (skip > 1) zm -= 1;
			if (zm > zmax) zmax = zm;
			bmdz[cp] = zm;
			totalz += Math.abs(lz - zm);
			lz = zm;
			a = cp * 4;
			oldr = zm / zscale;
			bm.data[a] = 255 - oldr;
			bm.data[a + 1] = 255 - oldr;
			bm.data[a + 2] = 255 - oldr;
			bm.data[a + 3] = oldr < 2 ? 0 : 255;
		}
		zmline.push(zmax);
	}
	getz = function (ix, iy) {
		if (ix < 0 || iy < 0 || ix >= bmw || iy >= bmh) return -1;
		return bmdz[iy * bmw + ix];
	}
	getzi = function (x, y) {
		var ix = Math.floor(x);
		var iy = Math.floor(y);
		var rx = x - ix;
		var ry = y - iy;
		var z1 = getz(ix, iy);
		if (rx < 0.001 && ry < 0.001) return z1;
		var z2 = getz(ix + 1, iy);
		// interpolate
		z1 = z2 * rx + z1 * (1 - rx);

		var z3 = getz(ix, iy + 1);
		var z4 = getz(ix + 1, iy + 1);
		// interpolate
		z3 = z4 * rx + z3 * (1 - rx);
		// interpolate
		z1 = z3 * ry + z1 * (1 - ry);
		return z1;
	}

	// from center rectangular ccw
	var rep1 = getnumber("egrepeat1");
	var rep2 = getnumber("egrepeat2");
	var zm = 0;
	var sx = Math.ceil(bmw / 2);
	var sy = Math.ceil(bmh / 2);
	var w = 0;
	var wmin = Math.min(sx, sy);
	var dy = Math.abs(sy - wmin);
	var dx = Math.abs(sx - wmin);
	var xp, yp;
	var sfzv = getvalue("safez2");
	var sfz = " Z" + sfzv;
	var pwr = " S" + Math.round(2.55 * getvalue("vcarvepw"));
	gcodes.push("M3 " + pwr + "\nG0 F" + mround2(60 * getnumber("trav")) + " " + sfz + "\nG1 F" + feed + "\n");
	var lz, lx, a, sxc, rep, oxp, oyp;
	lz = 0;
	var moves = [];
	var climb = 1;
	var sr = 0;
	storegcode = function (j, i, m, fp, ff, zp = null) {

		xp = i * stepx + ofx;
		yp = j * stepy + ofy;
		// tolerance = 0.05mm 

		zm = zp == null ? Math.round(getzi(i, j) * 40) * 0.025 : zp;

		if (zm == NaN) zm = sfzv;

		if ((lz != zm) || fp) {
			//if (oxp)moves.push([oxp,oyp,zup-lz,sr]);//gcodes.push(lx+" Z"+mround(zup-lz));
			//gcodes.push(g1+" Z"+mround(zup-zm));
			moves.push([xp, yp, zup - zm, sr]);
			lz = zm;
		}
		oxp = xp;
		oyp = yp;
	}
	//zup*=0.8;
	var sortgrup = 1;
	var adap = feedmethod == 3 ? getnumber("egminstep") : 0;

	if (feedmethod == 3 || feedmethod == 4 || feedmethod == 5) {
		// maximum radius to cover the image
		var centers = [];
		if (engravebounds.length) {
			// calculate multiple centers
			for (var cti = 0; cti < engravebounds.length; cti++) {

				var p = engravebounds[cti];
				if (p.length > 2) {
					var tx = 0;
					var ty = 0;
					var xmin = 10000;
					var xmax = -10000;
					var ymin = 10000;
					var ymax = -10000;
					for (var ip = 0; ip < p.length; ip++) {
						xmin = Math.min(p[ip][0], xmin);
						ymin = Math.min(p[ip][1], ymin);
						xmax = Math.max(p[ip][0], xmax);
						ymax = Math.max(p[ip][1], ymax);
						tx += p[ip][0];
						ty += p[ip][1];

					}
					xmax -= xmin;
					ymax -= ymin;
					xmax = Math.max(xmax / stepx, ymax / stepy)
					tx = (tx / p.length - ofx) / stepx;
					ty = (ty / p.length - ofy) / stepy;
					ctr = [tx, ty, xmax];
					for (var ctix = 0; ctix < engravebounds.length; ctix++) {
						var px = engravebounds[ctix];
						if (px.length == 2) {
							if (isInside(px[0], px[1], p)) {
								ctr[0] = (px[0] - ofx) / stepx;
								ctr[1] = (px[1] - ofy) / stepy;
							}
						}
					}
					centers.push(ctr);
				}
			}
		} else centers.push([sx, sy, sqrt(sqr(sx) + sqr(sy))]);
		w = 0;
		var tx1 = 0.1 * bmw;
		var ty1 = 0.1 * bmh;
		var tx2 = 0.9 * bmw;
		var ty2 = 0.9 * bmh;
		var lastring;
		var lastsc = 0;
		var rings = [];
		for (var cti = 0; cti < centers.length; cti++) {
			var wmax = centers[cti][2];
			var csx = centers[cti][0];
			var csy = centers[cti][1];
			var zc = getzi(csx, csy);
			moves.push([ofx, ofy, sfzv]);
			x1 = ofx + csx * stepx;
			y1 = ofy + csy * stepy;
			moves.push([x1, y1, sfzv, 0]);
			moves.push([x1, y1, -zc / 2, 0]);
			moves.push([x1, y1, 0, 0]);
			moves.push([x1, y1, -zc, 0]);
			var stepmin = Math.min(stepx, stepy);
			var steps = 3 * wmax + 1;

			for (var ri = 1; ri < steps; ri++) {
				// keliling dengan jari2 dari ri-1 ke ri
				stepde = 2 * Math.PI;
				stepsc = Math.ceil(1 * ri * stepde);
				stepde /= stepsc;
				deg = 0;
				if (isclimb) stepde = -stepde;
				var nowring = [];
				// first pass is get the radius from center
				var radi = [];
				var isin = 0;
				for (var j = 0; j < stepsc; j++) {
					zsc = 1;
					var lr;
					if (ri < 3 || adap == 0)
						r = (ri - 1) + j / stepsc;
					else {
						lr = lastring[Math.floor(lastsc * j / stepsc)]
						r = lr[3] + 1;
					}
					// check first R
					xp = (csx + r * Math.cos(deg)); //if (xp>=bmw)xp=bmw-1;
					yp = (csy + r * Math.sin(deg)); //if (yp<0)yp=0;
					zp = Math.round(getzi(xp, yp) * 40) * 0.025;


					if (ri > 2 && adap > 0 && (xp > tx1 && xp < tx2 && yp > ty1 && yp < ty2)) {
						// compare with previous ring if to deep reduce
						var dz = Math.abs(lr[2] - zp);
						if (zp < -zup) r = 1;
						else {
							if (dz > 0.8) {
								r = 0;
							} else {
								r = sqrt(1 - sqr(dz));
							}
						}
						r = Math.max(r, adap) + lr[3];
						//r=r*1.2;
					}
					radi.push(r);
					deg += stepde;

				}
				// smooth the radius

				getr = function (n, rs, df) {
					if (n >= stepsc) n -= stepsc;
					if (n < 0) n += stepsc;
					return radi[n] * rs;
				}
				deg = 0;
				for (var j = 0; j < stepsc; j++) {
					var r1 = radi[j];
					if (adap > 0) {
						var r = r1 + getr(j - 1, 0.5, r1) + getr(j - 2, 0.3, r1) + getr(j - 3, 0.15, r1) +
							getr(j + 1, 0.5, r1) + getr(j + 2, 0.3, r1) + getr(j + 3, 0.15, r1);
						r /= 2.9;
					}
					xp = (csx + r * Math.cos(deg)); //if (xp>=bmw)xp=bmw-1;
					yp = (csy + r * Math.sin(deg)); //if (yp<0)yp=0;
					zp = Math.round(getzi(xp, yp) * 40) * 0.025;
					//if (xp>=0 && xp<bmw  && yp>=0 && yp<bmh)
					if (-zp < zup) isin = 1;
					deg += stepde;
					nowring.push([xp, yp, zp, r, zp]);
					sr = w;
					storegcode(yp, xp, 1, 1, 0);
				}
				rings[w] = nowring;
				lastring = nowring;
				lastsc = stepsc;
				if (!isin) break;
				w++;
			}
		}
	} // generate gcode
	if (feedmethod == 2) {
		sortgrup = 0;
		while (w <= wmin) {

			//make rectangular by P = w
			rep = rep2;
			if (w == 0) rep = rep1;
			for (var r = 0; r < rep; r++) {
				zsc = (r + 1) / rep;
				// climb mill
				xp = (sx + (climb ? +w + dx : -w - dx)); //if (xp>=bmw)xp=bmw-1;
				yp = (sy - w - dy); //if (yp<0)yp=0; 
				if (w == 0 && r == 0) gcodes.push("G0 " + sfz + "\nG0 X" + mround(xp * stepx + ofx) + " Y" + mround(yp * stepy + ofy));
				if (climb) {
					// top right to left top
					lx = 0;
					for (var i = sx + w + dx; i >= sx - w - dx; i--) storegcode(sy - w - dy, i, 0, Math.abs(sx - i) == w + dx, i == (sx + w + dx));
					// top left to bottom left 
					lx = 0;
					for (var j = sy - w - dy; j <= sy + w + dy; j++) storegcode(j, sx - w - dx, 1, Math.abs(sy - j) == w + dy, 0);
					// botton left bottom right
					lx = 0;
					for (var i = sx - w - dx; i <= sx + w + dx; i++) storegcode(sy + w + dy, i, 0, Math.abs(sx - i) == w + dx, 0);
					// bottom right to top right
					lx = 0;
					for (var j = sy + w + dy; j >= sy - w - dy; j--) storegcode(j, sx + w + dx, 1, Math.abs(sy - j) == w + dy, 0);
				} else {
					// top left to right top
					lx = 0;
					for (var i = sx - w - dx; i <= sx + w + dx; i++) storegcode(sy - w - dy, i, 0, Math.abs(sx - i) == w + dx, i == (sx - w - dx));
					// top right to bottom left 
					lx = 0;
					for (var j = sy - w - dy; j <= sy + w + dy; j++) storegcode(j, sx + w + dx, 1, Math.abs(sy - j) == w + dy, 0);
					// botton right bottom left
					lx = 0;
					for (var i = sx + w + dx; i >= sx - w - dx; i--) storegcode(sy + w + dy, i, 0, Math.abs(sx - i) == w + dx, 0);
					// bottom left to top left
					lx = 0;
					for (var j = sy + w + dy; j >= sy - w - dy; j--) storegcode(j, sx - w - dx, 1, Math.abs(sy - j) == w + dy, 0);
				}
			}
			w++;
		}
	} // generate gcode
	ox = -100;
	oy = -100;
	oz = 3;
	var onair = 0;
	var lonair = 0;
	// collect grup of moves separated by travel
	var grups = [];
	var grup = [];
	var start = 0;
	var lasti = 0;
	zup = zup * 0.9;
	for (var i = 0; i < moves.length - 1; i++) {
		var m = moves[i];
		var gx = "";
		var gy = "";
		var gz = "";
		if (ox != m[0]) gx = " X" + mround(m[0]);
		if (oy != m[1]) gy = " Y" + mround(m[1]);
		if (oz != m[2]) gz = " Z" + mround(m[2]);
		if (gx + gy + gz != "") {
			onair = m[2] > zup;
			if (!onair || (onair != lonair)) {
				if (onair != lonair) {
					if (grup.length > 4) {
						grups.push([start, lasti, 0, grup]);
					}
					grup = ["G0 " + gx + gy + " Z" + mround(oz)];
					start = i;
				}
				grup.push("G1 " + gx + gy + gz);
				ox = m[0];
				oy = m[1];
				oz = m[2];
				lasti = i;
			}
			lonair = onair;
		}

	}
	var lastx, lasty, lastr;
	var donerings = [];
	execgrup = function (ig, flip) {
		var g = grups[ig];
		g[2] = 1; // mark as done
		var st = flip ? moves[g[1]] : moves[g[0]];
		var en = flip ? moves[g[0]] : moves[g[1]];
		lastx = en[0];
		lasty = en[1];

		gcodes.push("G0 " + sfz);
		gcodes.push("G0 X" + mround(st[0]) + " Y" + mround(st[1]));
		if (flip) g[3].reverse();
		gcodes.push(g[3].join("\n"));
		for (var i = g[0]; i <= g[1]; i++) {
			var r = moves[i][3];
			if (donerings[r] == undefined) donerings[r] = [];
			donerings[r].push(moves[i]);
		}
	}
	checkdis = function (ig) {
		var g = grups[ig];
		var r1 = moves[g[0]][3] - 1;
		//var r2=moves[g[1]][3]-1;
		var maxdis = 0;
		var checkrings = donerings[r1];
		if (checkrings == undefined) return 1000000;
		for (var i = g[0]; i <= g[1]; i += 2) {
			var m = moves[i];
			var mindis = 1000000;
			for (var j = checkrings.length - 1; j > 0; j -= 3) {
				var d = checkrings[j];
				var dis = sqr(m[0] - d[0]) + sqr(m[1] - d[1]);
				mindis = Math.min(dis, mindis);
			}
			maxdis = Math.max(maxdis, mindis);
		}
		return sqrt(maxdis);
	}
	if (grups.length > 0) {
		execgrup(0);

		if (sortgrup) {
			// start from 1, grup no 0, always execute first
			var cnt = grups.length - 1;
			while (cnt > 0) {
				var dis = null;
				var sel = -1;
				var flip = 0;
				for (var j = 1; j < grups.length; j++) {
					var g = grups[j];
					var m0 = moves[g[0]];
					var m1 = moves[g[1]];
					var m1 = moves[g[1]];

					if (g[2] == 1) continue; // already run
					var isflip = 0;
					var cdis = sqrt(sqr(lastx - m0[0]) + sqr(lasty - m0[1]));
					if (canreverse) {
						var cdis1 = sqrt(sqr(lastx - m1[0]) + sqr(lasty - m1[1]));
						if (cdis1 < cdis) isflip = 1;
					};
					// check if this ok
					cdis += (isflip ? 2 : 10) * checkdis(j);
					if (dis == null || cdis < dis) {
						sel = j;
						flip = isflip;
						dis = cdis;
					}
				}
				if (sel > 0) {
					execgrup(sel, flip);
					cnt--;
				}
			}
		} else {
			for (var i = 1; i < grups.length; i++) execgrup(i);
		}
	}


	ctx.putImageData(bm, 0, 0);
	gcodes.push("G0 " + sfz + "\nM3 S0\n");
	t = (total + totalz) / (feed / 60);
	var s = beforecut_p + "\n" + gcodes.join("\n");
	if (skip == 1) {
		bitmaptime += t;
		gc = getvalue("engcode") + s;
		setvalue("engcode", gc);

		var img1 = new Image();
		rwidth = rwidth * (c.width / mwidth);
		rheight = rheight * (c.height / mheight);
		img1.src = canv.toDataURL();
		img1.onload = function () {
			var c = $("myCanvas1");
			var ctx = c.getContext("2d");
			ctx.drawImage(img1, (ofx + maxofs) * dpm, (ofy + maxofs) * dpm, rwidth * dpm, rheight * dpm);
		}

	}
}

getAddress();

//urlopen("https://ryannining.goatcounter.com/count");
//data-goatcounter="https://ryannining.goatcounter.com/count";
//if(!sessionStorage.getItem("_swa")&&document.referrer.indexOf(location.protocol+"//"+location.host)!== 0){fetch("https://counter.dev/track?"+new URLSearchParams({referrer:document.referrer,screen:screen.width+"x"+screen.height,user:"ryannining",utcoffset:"7"}))};sessionStorage.setItem("_swa","1");

