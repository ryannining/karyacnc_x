function mround(e) {
    return parseFloat(e).toFixed(3)
}
function mround4(e) {
    return parseFloat(e).toFixed(4)
}
var packages = []
  , compress = [];
function write(e, a) {
    a > 0 && compress.push(255 & e),
    a > 1 && compress.push(e >> 8 & 255),
    a > 2 && compress.push(e >> 16 & 255),
    a > 3 && compress.push(e >> 24 & 255)
}
var cpos = 0;
function read(e) {
    var a = 0;
    if (cpos + e >= compress.length)
        return null;
    for (var t = 0; t < e; t++)
        a += compress[cpos + t] << 8 * t;
    return cpos += e,
    a
}
var holdpos = 0;
function hold() {
    holdpos = compress.length - 1
}
var sendg1 = ""
  , cntg28 = 0
  , totalgcode = 0;
function endcompress() {}
var lx = -10
  , ly = -10
  , lz = -10
  , le = -10
  , lf = 10
  , lF1 = 10
  , lF0 = 10
  , lS = 0
  , lh = 0
  , ole = 0
  , oxmin = 0
  , oxmax = 0
  , oymin = 0
  , oymax = 0
  , ozmin = 0
  , ozmax = 0
  , eE = 0
  , E = 0
  , F0 = 0
  , F1 = 0
  , isRel = 0
  , overtex = []
  , lines = []
  , zdeg = 45
  , xdeg = 35
  , sinz = .707
  , cosz = .707
  , sinx = .707
  , cosx = .707
  , filament = 0
  , printtime = 0
  , eScale = 50
  , xyScale = 500
  , zScale = 10
  , xySize = 2
  , zSize = 1
  , eSize = 1
  , fScale = 2
  , GXVER = 1;
1 == GXVER && (eScale = 50,
xyScale = 200,
zScale = 10,
xySize = 2,
zSize = 1,
eSize = 1,
fScale = 2);
var yflip = 1;
function datasize(e) {
    return (1 << 8 * e - 1) - 2
}
var rlx, rly, xyLimit = datasize(xySize), zLimit = datasize(zSize), eLimit = datasize(eSize), ln = 0, warnoverflow = 0, isF = 0, repeatsame = 0, xsub = 0, ysub = 0, zsub = 0;
function approx_distance(e, a) {
    return Math.sqrt(e * e + a * a)
}
function writeline(e, a, t, l, i) {
    var r, o, n;
    i > 0 && (e |= 8),
    (r = 0 != a) && (e |= 16),
    (o = 0 != t) && (e |= 32),
    (n = 0 != l) && (e |= 64),
    write(e, 1),
    i > 0 && write(i, 1),
    r && write(a + xyLimit, xySize),
    o && write(t + xyLimit, xySize),
    n && write(l + zLimit, zSize)
}
function gcode_arc(e, a, t, l, i, r, o, n, c, s) {
    var d = Math.sqrt(n * n + c * c)
      , x = t + n
      , m = l + c
      , y = -n
      , h = -c
      , g = i - x
      , S = r - m
      , f = Math.atan2(y * S - h * g, y * g + h * S);
    (!s && f <= 1e-5 || s && f < -1e-6) && (f += 2 * Math.PI),
    s && (f -= 2 * Math.PI);
    var z = Math.abs(f * d);
    if (!(z < 1)) {
        var u = Math.max(1, Math.floor(2 * z / xyScale))
          , p = f / u;
        lx = t,
        ly = l,
        printtime += Math.sqrt(z / (xyScale * xyScale)) / (a * fScale);
        for (var M = 1; M < u; M++) {
            var v = Math.cos(M * p)
              , b = Math.sin(M * p);
            y = -n * v + c * b,
            h = -n * b - c * v;
            var w = Math.floor(x + y)
              , k = Math.floor(m + h);
            writeline(e, w - lx, k - ly, 0, 0),
            lx = w,
            ly = k,
            overtex.push([lx / xyScale, ly / xyScale, o / zScale, 0, 1, a * fScale]),
            oxmax = Math.max(oxmax, lx / xyScale),
            oxmin = Math.min(oxmin, lx / xyScale),
            oymax = Math.max(oymax, ly / xyScale),
            oymin = Math.min(oymin, ly / xyScale)
        }
        writeline(e, i - lx, r - ly, 0, 0),
        lx = i,
        ly = r,
        overtex.push([lx / xyScale, ly / xyScale, o / zScale, 0, 1, a * fScale])
    }
}
function gcodeline(e, a, t, l, i, r, o, n, c, s, d, x) {
    stepx = Math.floor(o / t),
    stepy = Math.floor(n / t),
    stepz = Math.floor(c / t),
    steplx = o - stepx * (t - 1),
    steply = n - stepy * (t - 1),
    steplz = c - stepz * (t - 1),
    0 == a ? (F = F0,
    lf = lF0) : (F = F1,
    lf = lF1);
    var m = F != lf;
    0 == a ? lF0 = F0 : lF1 = F1;
    Math.abs(o),
    Math.abs(n),
    Math.abs(c);
    if (a < 2) {
        for (var y = 1; y <= t; y++)
            y == t ? (wx = steplx,
            wy = steply,
            wz = steplz) : (wx = stepx,
            wy = stepy,
            wz = stepz),
            writeline(e, wx, wy, wz, 1 == y && m ? F : 0),
            m = 0;
        overtex.push([lx / xyScale, ly / xyScale, lz / zScale, 0, a, lf * fScale]),
        printtime += Math.sqrt((o * o + n * n) / (xyScale * xyScale)) / (F * fScale)
    } else
        gcode_arc(e, lf, rlx, rly, l, i, r, s, d, 2 == a);
    rlx = lx,
    rly = ly
}
var lastG = 0;
function addgcode(e) {
    if (ln++,
    totalgcode += e.length,
    gd = {},
    lv = "",
    lk = "",
    gk = "",
    0 != (e = e.toUpperCase()).indexOf(";REP:")) {
        for (var a = 0; a < e.length && (c = e[a],
        ".0123456789-".indexOf(c) >= 0 && (lv += c),
        (" ;MGXYZEFSTRIJKP".indexOf(c) >= 0 || a == e.length - 1) && (lv && (gk += lk,
        gd[lk] = 1 * lv,
        lv = ""),
        "MGXYZEFSTRIJKP".indexOf(c) >= 0 && (lk = c)),
        ";" != c); a++)
            ;
        var t = 0
          , l = 0;
        arccw = 0;
        var i = 0;
        if (gk.indexOf("G") + 1)
            switch (gd.G) {
            case 90:
                isRel = 0;
                break;
            case 91:
                isRel = 1;
                break;
            case 92:
                i = 1;
                break;
            case 2:
                arccw = 1
            }
        if (gk.indexOf("M") + 1) {
            switch (t = 1,
            gd.M) {
            case 3:
                t |= 0;
                break;
            case 5:
                t |= 0,
                gd.S = 0;
                break;
            case 109:
                t |= 2;
                break;
            case 2:
                t |= 4;
                break;
            default:
                return
            }
            null == (l = parseInt(gd.S)) && (l = 255),
            t |= 8;
            var r = gk.indexOf("X") + 1
              , o = gk.indexOf("Y") + 1
              , n = gk.indexOf("P") + 1;
            if (r && (t |= 16),
            o && (t |= 32),
            n && (t |= 128),
            write(t, 1),
            write(l, 1),
            r)
                write(Math.round(.01 * gd.X * xyScale) + xyLimit, xySize);
            if (o)
                write(Math.round(.01 * gd.Y * xyScale) + xyLimit, xySize);
            if (n)
                write(Math.round(.01 * gd.P), eSize);
            console.log(ln + " M" + gd.M + " S" + l)
        } else
            gk.indexOf("G") + 1 || (gk += "G",
            gd.G = lastG);
        if (gk.indexOf("G") + 1) {
            t = 0;
            var s = gd.G;
            switch (lastG = s,
            s) {
            case 2:
                t |= 2,
                1,
                1;
                break;
            case 3:
            case 1:
                t |= 2;
                break;
            case 0:
                t |= 0;
                break;
            case 28:
                t |= 4;
                break;
            case 92:
                break;
            case 192:
                t |= 6,
                ole = 0,
                E = 0,
                eE = 0,
                console.log("W" + E);
                break;
            default:
                return
            }
            var hasF = gk.indexOf("F") + 1
              , d = d || hasF
              , x = (r = gk.indexOf("X") + 1,
            o = gk.indexOf("Y") + 1,
            gk.indexOf("Z") + 1)
              , m = gk.indexOf("I") + 1
              , y = gk.indexOf("J") + 1
              , h = gk.indexOf("R") + 1
              , g = gk.indexOf("E") + 1;
            X = Y = Z = F = S = 0,
            dx = dy = dz = de = 0,
            hasF && !i && (lf = 1 == s ? F1 : F0,
            F = Math.min(Math.round(gd.F / (60 * fScale)), 255),
            1 == s ? F1 = F : F0 = F),
            I = J = R = 0,
            m && (I = gd.I * xyScale),
            y && (J = gd.J * xyScale),
            h && (R = gd.R * xyScale),
            r && (i ? xsub = -lx + gd.X * xyScale : (X = Math.round(gd.X * xyScale - xsub),
            isRel && (X += lx),
            dx = X - lx,
            X != lx ? lx = X : r = 0)),
            o && (i ? ysub = -ly + gd.Y * xyScale : (Y = Math.round(gd.Y * yflip * xyScale - ysub),
            isRel && (Y += ly),
            dy = Y - ly,
            Y != ly ? ly = Y : o = 0)),
            x && (i ? zsub = -lz + gd.Z * zScale : (Z = Math.round(gd.Z * zScale - zsub),
            isRel && (Z += lz),
            dz = Z - lz,
            Z != lz && (lz = Z))),
            i && (r || o || x || hasF || (xsub = 0,
            ysub = 0,
            zsub = 0)),
            g && (E = Math.round(gd.E * eScale),
            isRel && (E += le),
            de = E - le,
            le = E,
            filament = Math.max(le, filament));
            var f = t
              , z = Math.ceil(Math.abs(dx) / xyLimit);
            z = Math.max(Math.ceil(Math.abs(dy) / xyLimit), z),
            z = Math.max(Math.ceil(Math.abs(dz) / zLimit), z),
            z = Math.max(Math.ceil(Math.abs(de) / eLimit), z),
            y || m || h || 0 != z && 28 != s ? gcodeline(f, s, z, X, Y, Z, dx, dy, dz, I, J, R) : (28 == s ? (r && (t |= 16),
            o && (t |= 32),
            x && (t |= 64),
            write(t, 1),
            r && write(Math.round(gd.X * xyScale) + xyLimit, xySize),
            o && write(Math.round(gd.Y * xyScale) + xyLimit, xySize),
            x && write(Math.round(gd.Z * xyScale) + xyLimit, xySize)) : hasF && (t = f,
            write(t |= 8, 1),
            write(F, 1)),
            lh = t),
            oxmax = Math.max(oxmax, lx / xyScale),
            oxmin = Math.min(oxmin, lx / xyScale),
            oymax = Math.max(oymax, ly / xyScale),
            oymin = Math.min(oymin, ly / xyScale),
            ozmax = Math.max(ozmax, lz / zScale),
            ozmin = Math.min(ozmin, lz / zScale)
        }
        cntg28 || (endcompress(),
        cntg28 = 2)
    } else
        repeatsame = parseInt(e.split(":")[1])
}
var decoding = 0
  , rE = (cntg28 = 0,
0)
  , main_r = .5
  , main_g = 1
  , main_b = .2;
function randomcolor() {
    main_r = mround(Math.random()),
    main_g = mround(Math.random()),
    main_b = mround(Math.random());
    var e = Math.max(main_b, Math.max(main_r, main_g));
    main_r /= e,
    main_g /= e,
    main_b /= e
}
randomcolor();
var letters = "0123456789ABCDEF";
function tohex(e) {
    return e > 255 && (e = 255),
    e = Math.floor(e),
    letters[e >> 4 & 15] + letters[15 & e]
}
function getColor(e) {
    return e < 0 && (e = 0),
    "#" + tohex(main_r * e) + tohex(main_g * e) + tohex(main_b * e)
}
var sp = 0
  , pv = 0;
function showProgress() {}
function begincompress(e, a, t) {
    oxmax = -1e5,
    oxmin = 1e5,
    oymax = -1e5,
    oymin = 1e5,
    ozmax = -1e5,
    ozmin = 1e5,
    xsub = 0,
    ysub = 0,
    zsub = 0,
    filament = 0,
    eE = ole = lx = ly = lz = le = 0,
    lf = 0,
    F1 = 50,
    F0 = 50,
    lF1 = 0,
    lF0 = 0,
    printtime = 0,
    overtex = [],
    lines = [],
    compress = [],
    packages = [],
    isRel = 0,
    totalgcode = 0,
    write(71, 1),
    write(88, 1),
    write(GXVER, 1),
    texts = e ? e.split("\n") : getvalue("gcode").split("\n"),
    cntg28 = 2,
    ln = 0,
    a && setTimeout(a, 200);
    for (var l = 0; l < texts.length; l++)
        addgcode(texts[l]),
        !1 & l && (pv = 100 * l / texts.length);
    h = 1,
    h |= 4,
    write(h, 1),
    console.log("From " + totalgcode + " to " + compress.length),
    console.log("Ratio " + mround(compress.length / totalgcode)),
    t && t()
}
var AX, AY, AZ, AE, decodes = "", Shapes = (decoding = 0,
[]), shapes_ctr = 0, PZ = 0;
function decodealine() {
    var e = 0
      , a = 0
      , t = 0
      , l = 0
      , i = 0
      , r = 0
      , o = read(1);
    if (null != o) {
        var n = 0;
        if (1 & o) {
            switch (1,
            o >> 1 & 3) {
            case 0:
                t = 3;
                break;
            case 1:
                t = 109;
                break;
            case 2:
                return void (decoding = 0)
            }
            8 & o && (e = 1,
            i = n = read(1)),
            16 & o && (1,
            n = read(xySize)),
            32 & o && (1,
            n = read(xySize)),
            128 & o && (a = 1,
            r = 100 * (n = read(eSize))),
            decodes += "M" + t,
            e && (decodes += " S" + i),
            a && (decodes += " P" + r),
            decodes += "\n"
        } else {
            switch (1,
            o >> 1 & 3) {
            case 0:
                l = 0;
                break;
            case 1:
                l = 1;
                break;
            case 2:
                l = 28;
                break;
            case 3:
                l = 92,
                rE = 0
            }
            var c = 0;
            decodes += "G" + l;
            var s = [];
            l <= 1 && AZ > 0 && (s = [AX, AY, AZ],
            PZ = AZ),
            8 & o && (n = read(1),
            1,
            decodes += " F" + 60 * (n * fScale)),
            16 & o && (c = read(xySize),
            1,
            decodes += " X" + mround(AX += (c - xyLimit) / xyScale)),
            32 & o && (c = read(xySize),
            1,
            decodes += " Y" + mround(AY += (c - xyLimit) / xyScale)),
            64 & o && (28 == l ? (c = read(xySize),
            1,
            aZ = (c - xyLimit) / xyScale,
            decodes += " Z" + mround(aZ),
            AZ = 0) : (c = read(zSize),
            1,
            decodes += " Z" + mround(AZ += (c - zLimit) / zScale),
            AZ <= 0 && PZ > 0 && (PZ = AZ,
            Shapes.push(s),
            shapes_ctr++))),
            128 & o && (c = read(eSize),
            1,
            decodes += " E" + mround(AE += (c - eLimit) / eScale)),
            decodes += "\n"
        }
        0 == cntg28 && (decoding = 0)
    } else
        decoding = 0
}
function decode() {
    for (cpos = 3,
    cntg28 = 2,
    decoding = 1,
    decodes = "",
    rE = 0,
    AX = 0,
    AY = 0,
    AZ = 0,
    AE = 0,
    Shapes = [],
    shapes_ctr = 0,
    PZ = 0; decoding; )
        decodealine();
    return decodes
}

// Wrapper functions for gcode.html compatibility
function encodeGCode(gcodeText) {
    var result = null;
    compress = [];
    begincompress(gcodeText, null, function() {
        result = new Uint8Array(compress);
    });
    return result;
}

function decodeGX(uint8Array) {
    compress = Array.from(uint8Array);
    cpos = 0;
    return decode();
}
