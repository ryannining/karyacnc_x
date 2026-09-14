// ============================================================
// KaryaCNC Main Application Module
// ============================================================
// Merged: serial.js + main.js + constants
// Separate: cnc.js (G-code algorithms)
// ============================================================

// ============================================================
// CONSTANTS
// ============================================================

// Machine types
const CMD_LASER = 1;
const CMD_FOAM = 2;
const CMD_CNC = 3;
const CMD_3D = 4;
const CMD_PLASMA = 5;

// Operation modes (ENGRAVE is reassigned in costy-x.js, so use var)
var ENGRAVE = 0;
const OVC_MODE = 0; // 1 drill 0 path

// Default values
const DEFAULT_STY = {
    "stroke": "#000000",
    "stroke-width": 0,
    "deep": undefined,
    "repeat": undefined
};

// V-carve styles
const CARVE_STY_IN = {
    "stroke": "#0000ff",
    "fill": "#ff00ff",
    "stroke-width": 0,
    "deep": undefined,
    "dovcarve": true,
    "flip": false,
    "repeat": undefined
};

const CARVE_STY_OUT = {
    "stroke": "#0000ff",
    "fill": "#ff00ff",
    "stroke-width": 0,
    "deep": undefined,
    "dovcarve": true,
    "flip": true,
    "repeat": undefined
};

// ============================================================
// GLOBAL VARIABLES
// ============================================================

var cmd = CMD_CNC;
var finishgcode = "";
var startgcode = "";
var lstnj = 0;
var machinezero = "G92";
var machinepos = "M114";
var wsconnected = 0;
var lastw = "";
var oktosend = 1;
var connectionId = null;
var eline = 0;
var okwait = 0;
var running = 0;
var px = 0;
var py = 0;
var pz = 0;
var pe = 0;
var etime = new Date();
var checktemp = 0;
var isgrbl = 0;
var gcstyle = [];
var preview = 0;
var waitok = 0;
var waitokH = 0;
var karya_ready = 0;
var hasCOM = 0;
var engravebounds = [];

var comtype = 0; // 0 serial, 1 websocket
var egcodes = [];
var debugs = 0;

var shapefinish = '';
var currentshape = 0;
var waitforwait = 0;

var pushedgcodes = [];
var buffsize = 128;

var ss = "";
var eeprom = {};
var eepromgcode = "";
var ineeprom = 0;
var eppos = 0;
var resp1 = "";
var totalwork = 0;
var stopinfo = 0;

var pausing = 0;

var baud = 115200;

var namamaterial = "";

var hidd = true;
var hidd5 = true;
var space = [2500000, 0];
var hidd6 = true;
var hidd2 = true;
var hidd3 = true;

var storage = localStorage;

var jobsettings = {};
var masterProfiles = null;        // objek {nama: settings} yang diambil dari master (atau null)
var showLocalProf = true;         // tampilkan profil lokal di dropdown
var showMasterProf = true;        // tampilkan profil master di dropdown
var currentProfileSource = 'local'; // 'local' | 'master' dari pilihan terakhir
var text1_history = [];
var current_history_index = -1;
var text1 = '';
var jobcnt = 0;
var jobs = [];
var ink_images = [];
var cuttabs = [];

var numjobs = 0;
var tgtoken = '5069763317:AAHa9nRGslJYI2u073P_vebfexIMgTfUJhY';
var tgtoken1 = '';
var tg_id = "447996950";
var tg_id1 = '';
var address = null;
var beat = new Audio('done.mp3');
var lst = 0;

// WebSocket server globals
window.port = 8888;
let greetInputEl;
let greetMsgEl;
let wsServerStatusEl;
let wsClientsEl;
let wsReceivedDataEl;
const clients = new Set();
let isServer = false;
let reports = [];

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function stopit() {
    stopinfo = 1;
    var bt = document.getElementById('btpause');
    if (bt) bt.innerHTML = "PAUSE";
    running = 0;
    okwait = 0;
    egcodes = [];
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
}

function Canvas2Clipboard(canvas) {
    canvas.toBlob(function (blob) {
        const item = new ClipboardItem({ "image/png": blob });
        navigator.clipboard.write([item]);
    });
}

function replaceAll(str, find, replace) {
    return str.replace(new RegExp(find, 'g'), replace);
}

// ============================================================
// DOM HELPERS
// ============================================================

function $(id) {
    if (id == "myCanvas1" && typeof myCanvas1 !== 'undefined') return myCanvas1;
    return document.getElementById(id);
}

const sqrt = Math.sqrt;

function log(text) {
    $('log').value += text + '\n';
}

function getvalue(el) {
    if (el == "gcode") return document.getElementById('gcodeEditor') ? document.getElementById('gcodeEditor').value : "";
    else if (el == "engcode") return document.getElementById('engcodeEditor') ? document.getElementById('engcodeEditor').value : "";
    var el = $(el);
    if (!el) return "";
    var v = el.value;
    if (cmd == CMD_PLASMA) {
        if (el == "repeat") return "1";
        if (el == "tabc") return "0";
        if (el == "spindleoffval") return "0";
        if (el == "cutpw") return "100";
        if (el == "zdown") {
            v = Math.abs(v);
            return ((v > 3) ? 3 : v);
        }
    }

    if (el == "leadin") return v.split(",");
    else if (el == "pup") {
        v = v.toUpperCase().trim();
        if (cmd == CMD_CNC) {
            if (v == "") {
                v = "G0 F4000 Z10";
            } else if (v[0] == "Z") {
                v = "G0 F4000 " + v;
            }
        } else if (cmd == CMD_LASER) {
        }
        return v.replaceAll(";", "\n");
    } else if (el == "pdn") {
        v = v.trim();
        if (v == "") {
            if (cmd == CMD_CNC) v = "G1 F2500 Z=cncz";
        }
        if (cmd == CMD_LASER) {
        }
        return v.replaceAll(";", "\n");
    } else return v;
}

var speedvals = [];

function getnumber(el) {
    var v = getvalue(el);
    if (v == 'undefined') v = '0';
    if (el == "smooth") {
        return 1;
    }
    if (el == "sharp") {
        if (v * 1 < 5) return v * 1;
        return Math.cos(v * Math.PI / 180);
    }
    v = v.split(",");
    if (v.length == 1) return parseFloat(v[0]);

    if (el == "speed") {
        speedvals = v;
    }

    return parseFloat(v[v.length - 1]);
}

function getinteger(el) {
    return parseInt(getvalue(el));
}

function setvalue(el, val) {
    if (el == "gcode") {
        const ed = document.getElementById('gcodeEditor');
        if (ed) { ed.value = val; ed.dispatchEvent(new Event('input')); }
    }
    else if (el == "engcode") {
        const ed = document.getElementById('engcodeEditor');
        if (ed) { ed.value = val; ed.dispatchEvent(new Event('input')); }
    }
    else $(el).value = val;
}

function mround(x) {
    return parseFloat(x).toFixed(3);
}

function mround2(x) {
    return parseFloat(x).toFixed(2);
}

function mround1(x) {
    return parseFloat(x).toFixed(1);
}

function sqr(x) {
    return x * x;
}

function getchecked(el) {
    if (el == "burn1" && cmd != CMD_LASER) return false;
    if (el == "usefinish" && cmd != CMD_CNC) return false;
    return $(el).checked;
}

function setclick(id, handler) {
    var el = $(id);
    if (el) el.addEventListener('click', handler);
}

function setevent(event, id, handler) {
    var el = $(id);
    if (el) el.addEventListener(event, handler);
}

function mixColor(rgb1, rgb2, ratio) {
    return [ratio * rgb1[0] + (1 - ratio) * rgb2[0],
    ratio * rgb1[1] + (1 - ratio) * rgb2[1],
    ratio * rgb1[2] + (1 - ratio) * rgb2[2]];
}

function rgbToHex(rgb) {
    if (rgb[0] > 1) rgb[0] = 1;
    if (rgb[1] > 1) rgb[1] = 1;
    if (rgb[2] > 1) rgb[2] = 1;
    return "#" + parseInt(rgb[0] * 255).toString(16).padStart(2, "0") +
        parseInt(rgb[1] * 255).toString(16).padStart(2, "0") +
        parseInt(rgb[2] * 255).toString(16).padStart(2, "0");
}

function bestFontColor(el) {
    if (typeof (el) == "string") {
        var bcolor = getComputedStyle($(el)).background;
        var srgb = bcolor.match(/\d+/g);
        var rgb = [parseInt(srgb[0]) / 255.0,
        parseInt(srgb[1]) / 255.0,
        parseInt(srgb[2]) / 255.0];
    } else rgb = el;
    var a = 1 - (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
    return [a, (a > 0.5) ? [1, 1, 1] : [0, 0, 0], rgb];
}

// ============================================================
// UI MODAL FUNCTIONS
// ============================================================

var wxcb1 = null;
var wxcb2 = null;
var wxTimer = null;

var wxKeyHandler = null;
var wxOverlayHandler = null;

function wxAlert(title, text, bts, click1, click2) {
    $("overlay").style.display = 'block'
    $("wxtitle").innerHTML = title;
    $("wxcontent").innerHTML = text;
    $("wxbt1").style.display = "";
    $("wxbt2").style.display = "none";
    if (typeof (bts) == 'undefined') bts = "Ok";
    wxcb1 = click1;
    wxcb2 = click2;
    var bt = bts.split(",");
    $("wxbt1").innerHTML = bt[0];
    if (bt.length == 2) {
        $("wxbt2").style.display = "";
        $("wxbt2").innerHTML = bt[1];
    }
    var popup = document.querySelector('#overlay .popup');
    if (popup) {
        popup.addEventListener('click', function (e) { e.stopPropagation(); });
    }
    if (wxOverlayHandler) $("overlay").removeEventListener('click', wxOverlayHandler);
    wxOverlayHandler = function () { CloseModal(); };
    $("overlay").addEventListener('click', wxOverlayHandler);
    if (wxKeyHandler) document.removeEventListener('keydown', wxKeyHandler);
    wxKeyHandler = function (e) {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            CloseModal();
        }
    };
    document.addEventListener('keydown', wxKeyHandler);
}

function OpenModal(e = 0) {
    let element = document.getElementById('overlay')
    element.style.display = 'block'
}

function CloseModal(e = 0) {
    if (wxTimer) { clearTimeout(wxTimer); wxTimer = null; }
    if (wxKeyHandler) { document.removeEventListener('keydown', wxKeyHandler); wxKeyHandler = null; }
    if (wxOverlayHandler) { $("overlay").removeEventListener('click', wxOverlayHandler); wxOverlayHandler = null; }
    let element = document.getElementById('overlay')
    element.style.display = 'none'
}

function wxClick1(e) {
    if (wxTimer) { clearTimeout(wxTimer); wxTimer = null; }
    if (wxcb1) wxcb1(e);
    CloseModal(0);
}

function wxClick2(e) {
    if (wxTimer) { clearTimeout(wxTimer); wxTimer = null; }
    if (wxcb2) wxcb2(e);
    CloseModal(0);
}

// ============================================================
// COLOR & THEME
// ============================================================

function getFontColor(el, el2, el3) {
    var f1 = bestFontColor(el);
    var fh2 = mixColor(f1[2], (f1[0] > 0.5) ? [1, 1, 1] : [0, 0, 0], 0.6);
    var f2 = bestFontColor(fh2);

    var fh3 = mixColor(f1[2], [0.7, 0.4, 0.2], 0.3);
    var f3 = bestFontColor(fh3);

    hdr1CSS.style.background = rgbToHex(fh2);
    hdr1CSS.style.color = rgbToHex(f2[1]);
    hdr2CSS.style.background = rgbToHex(fh3);
    hdr2CSS.style.color = rgbToHex(f3[1]);
    $(el2).style.color = rgbToHex(f1[1]);

    $(el3).style.background = "lightblue";
    f4 = bestFontColor(el3);
    var f42 = mixColor(f4[2], [1, 0.8, 0.5], 0.6);
    f4 = bestFontColor(f42);

    smallWCSS.style.color = rgbToHex(f4[1]);
    smallWCSS.style.background = rgbToHex(f42);

    $(el3).style.color = rgbToHex(f1[1]);
    $(el3).style.background = rgbToHex(f1[2]);
    el3 = "title2_c";
    $(el3).style.color = rgbToHex(f1[1]);
    $(el3).style.background = rgbToHex(f1[2]);

    document.bgColor = rgbToHex(fh2);

    var fh5 = mixColor(fh2, (f2[0] > 0.5) ? [1, 1, 1] : [0, 0, 0], 0.5);
    var f5 = bestFontColor(fh5);

    buttonCSS.style.borderColor = rgbToHex(fh5);
    buttonCSS.style.background = rgbToHex(fh5);
    buttonCSS.style.color = rgbToHex(f5[1]);
}

function updatestyle(k, va) {
    if (k == 'wtitle') {
        $("title0").innerHTML = va;
    }
    if (k == 'wcolor') {
        $("title1").style.background = va;
        $("title2").style.background = va;
        color = getComputedStyle($("title1")).background;
        getFontColor("title2", "title2_a", "title2_b");
    }
}

function updatewmode() {
    dm = getvalue("wmode");
    if (dm == 1) {
        notsimpleCSS.style.display = "none";
        $("vars3").style.marginLeft = "200px";
    }
    if (dm == 2) {
        notsimpleCSS.style.display = "";
        $("vars3").style.marginLeft = "230px";
    }
}

// ============================================================
// CANVAS FUNCTIONS
// ============================================================

function resizedisplay(reload = 1) {
    // No longer needed - GCode editor toggles instantly without affecting canvas
    // With pan/zoom, canvas size remains constant
}

window.onresize = function () {
    // No-op - InfiniteCanvas handles pan/zoom independently
};

// ============================================================
// SETTINGS & PROFILES
// ============================================================

function changematerial() {
    val = getvalue("material");
    text = $("material");
    namamaterial = text.options[text.selectedIndex].innerText;
    val = val.split(",");
    setvalue("feed", val[0]);
    setvalue("repeat", val[1]);
    setvalue("matprice", val[2]);
    setvalue("cutprice", val[3]);
    harga = val[2];
    if (val.length == 5) {
        document.getElementById("cmode").value = 3;
        setvalue("zdown", val[4]);
        setvalue("tabc", 1.5);
    }
    if (val.length == 4) {
        document.getElementById("cmode").value = 1;
        setvalue("zdown", 0);
        setvalue("tabc", 0);

    }
    modechange();
}

function modechange(f = 0) {
    var oldmode = f ? -1 : cmd;
    cmd = getvalue("cmode");
    if (oldmode == cmd) return;

    notlaserCSS.style.display = "";
    notcncCSS.style.display = "";
    notplasmaCSS.style.display = "";

    if (cmd == CMD_LASER) {
        notlaserCSS.style.display = "none";
        setvalue("pup", "");
        setvalue("pdn", "M3 S255");
    }
    if (cmd == CMD_FOAM) {
        setvalue("pup", "");
        setvalue("pdn", "M3 S255");
    }
    if (cmd == CMD_CNC) {
        notcncCSS.style.display = "none";
        if ($("pup").value == "") {
            setvalue("pup", "G1 F3000 Z15");
            setvalue("pdn", "G1 F1800 Z=cncz");
        }
    }
    if (cmd == CMD_PLASMA) {
        notplasmaCSS.style.display = "none";
        if ($("pup").value == "") {
            setvalue("pup", "G1 F3000 Z15");
            setvalue("pdn", "G1 F1800 Z=cncz");
        }
    }
    if (cmd == 4) {
        setvalue("pup", "");
        setvalue("pdn", "");
    }
}

function updateweb(sett, nm) {
    var kl = document.getElementsByClassName("saveit");
    for (var i = 0; i < kl.length; i++) {
        var a = kl[i];
        var k = a.id;
        var v = sett[k];
        if (typeof (v) != 'undefined' && v != 'undefined') {
            if (nm != "" && (k == "startat" || k == "wsport")) {
                v = getvalue(k);
            }
            {
                if (a.type == 'checkbox')
                    a.checked = v;
                else
                    setvalue(k, v);
                updatestyle(k, v);
            }
        }
    }
    modechange();
    updatewmode();
}

function updateprofile(newdata = null) {
    if (newdata != null) {
        for (var k in newdata) {
            if (typeof (jobsettings[k]) == 'undefined') jobsettings[k] = newdata[k]; else
                jobsettings[k + "_1"] = newdata[k];
        }
    }
    var p = "";
    // Profil lokal (jobsettings)
    if (showLocalProf) {
        for (var k in jobsettings) {
            p += "<option value='" + k + "' data-src='L'>[L] " + k + "</option>";
        }
    }
    // Profil master (masterProfiles) — read-only dari master
    if (showMasterProf && masterProfiles) {
        for (var k in masterProfiles) {
            p += "<option value='" + k + "' data-src='M'>[M] " + k + "</option>";
        }
    }
    $("profile").innerHTML = p;
}

// Baca pilihan dropdown #profile → { name, src } ('L' lokal, 'M' master)
function profileSelected() {
    var sel = $("profile");
    var name = sel ? sel.value : "";
    var src = "L";
    if (sel && sel.selectedOptions && sel.selectedOptions[0] && sel.selectedOptions[0].dataset) {
        src = sel.selectedOptions[0].dataset.src || "L";
    }
    return { name: name, src: src };
}

// Muat setting profil sebuah profil dari lokasi yang sesuai (lokal / master) ke form
function loadProfileIntoForm(name, src) {
    var data = null;
    if (src === 'M' && masterProfiles && masterProfiles[name]) {
        currentProfileSource = 'M';
        data = masterProfiles[name];
    } else {
        currentProfileSource = 'L';
        data = jobsettings[name];
    }
    if (data) {
        updateweb(data, name);
        namamaterial = "(Profile)";
    } else {
        loadsettings(name);
    }
    // Auto proses ulang G-code supaya harga tidak salah hitung
    refreshgcode();
    saveProcessToHistory();
}

// Ambil daftar profil dari PC master (GET /api/profiles) lalu tampilkan.
// Dipicu tombol "Load profiles" — TIDAK dibuka otomatis saat boot.
function loadMasterProfiles() {
    var ip = getvalue("masterip").trim();
    if (!ip) { wxAlert("Info", "Isi IP PC master (KaryCNC) di Connection Settings dulu."); return; }
    if (ip.split(".").length == 2) ip = "192.168." + ip;
    var url = "http://" + ip + ":3000/api/profiles";
    window.invoke("proxy_request", { url: url })
        .then(function (resp) {
            try {
                masterProfiles = JSON.parse(resp);
            } catch (e) { masterProfiles = null; }
            if (!masterProfiles || typeof masterProfiles != 'object') masterProfiles = null;
            try { storage.setItem("masterProfiles", JSON.stringify(masterProfiles)); } catch (e) { }
            markMasterOnline(true);
            updateprofile();
        })
        .catch(function (err) {
            // Master tidak terjangkau → pakai cache terakhir (kalau ada)
            try {
                var c = storage["masterProfiles"];
                masterProfiles = c ? JSON.parse(c) : null;
            } catch (e) { masterProfiles = null; }
            markMasterOnline(false);
            if (masterProfiles) updateprofile();
        });
}

// Toggle visibility alias dari checkbox (di Connection Settings)
function toggleProfileSource() {
    var l = $("chklocal"), m = $("chkmaster");
    showLocalProf = l ? l.checked : true;
    showMasterProf = m ? m.checked : true;
    updateprofile();
}

// PC MASTER: publikasikan jobsettings lokal ke backend Go agar dapat diserve
// lewat GET /api/profiles untuk PC slave. Dipanggil saat save/load profil.
function pushProfilesToMaster() {
    try {
        window.invoke("set_profiles", { data: JSON.stringify(jobsettings) });
    } catch (e) { }
}

// Tandai status koneksi master (strip kecil di list profil)
function markMasterOnline(ok) {
    var strip = $("masterStrip");
    if (!strip) return;
    if (ok) {
        strip.innerHTML = "✓ Profil master dimuat";
        strip.style.color = "#2e7d32";
    } else {
        strip.innerHTML = "⚠ Master tidak terjangkau" + (masterProfiles ? " — pakai cache" : "");
        strip.style.color = "#c62828";
    }
}

function loadsettings(name) {
    if (name == undefined) name = "";
    if (name) {
        updateweb(jobsettings[name], name);
        return;
    }
    jobsettings = defaultProfile;

    try {
        var text1 = storage["text1"];
        if (text1 != undefined) text1 = JSON.parse(text1); else text1 = ""
    } catch (e) { text1 = ""; }
    try {
        var h = storage["history"];
        if (h == undefined) text1_history = []; else text1_history = JSON.parse(h);
        current_history_index = text1_history.length - 1;
        window.activeHistoryId = current_history_index;
        updatehistory();
        // Langsung muat data kerja dari history terbaru agar bisa diproses
    } catch (e) { text1_history = []; }
    try {
        gcstyle = storage["gcstyle"];
        if (gcstyle == undefined) gcstyle = {}; else gcstyle = JSON.parse(gcstyle);
    } catch (e) { gcstyle = {}; }
    // ink_images tidak disimpan di localStorage karena ukuran besar,
    // hanya disimpan di memory saja
    try {
        cuttabs = storage["cuttabs"];
        if (cuttabs == undefined) cuttabs = []; else cuttabs = JSON.parse(cuttabs);
    } catch (e) { cuttabs = []; }
    try {
        engravebounds = storage["ebounds"];
        if (engravebounds == undefined) engravebounds = []; else engravebounds = JSON.parse(engravebounds);
    } catch (e) { engravebounds = []; }
    try {
        var settings = storage["settings"];
        if (settings == undefined) settings = {}; else settings = JSON.parse(settings);
        updateweb(settings, "");
    } catch (e) { }
    try {
        jobsettings = storage["jobsettings"];
        if (jobsettings == undefined) jobsettings = {}; else jobsettings = JSON.parse(jobsettings);
        if (jobsettings == undefined || Object.keys(jobsettings).length == 0) {
            jobsettings = defaultProfile;
            setvalue("profilename", "part_acp");
            loadprofile();
        }
        updateprofile();
    } catch (e) { jobsettings = defaultProfile; }
    // PC master: publish profile lokal saat boot agar slave bisa menariknya.
    try { pushProfilesToMaster(); } catch (e) { }

}

function loadprofile() {
    // Muat pengaturan profil (bisa dari lokal [L] atau master [M]).
    var sel = profileSelected();
    var name = getvalue("profilename");
    if (name == "") name = sel.name;
    setvalue("profilename", name);
    loadProfileIntoForm(name, sel.src);
}

function saveprofile() {
    // Simpan selalu ke lokal. Jika yang dipilih profil master, hasil edit
    // disimpan sebagai profil lokal dengan nama sama (master tidak ditimpa).
    var name = getvalue("profilename");
    if (name == "") {
        var sel = profileSelected();
        name = sel.name;
    }
    setvalue("profilename", name);
    currentProfileSource = "L"; // setelah save jadi milik lokal
    savesetting(name);
    updateprofile();
}

function delprofile() {
    name = getvalue("profilename");
    if (name == "***") {
        wxAlert("Confirmation", "Do you really want to clear profile data ?", "Yes,No", function () {
            jobsettings = {};
            savesetting("");
            updateprofile();
        }, null);
    } else {
        if (name == "") name = getvalue("profile");
        wxAlert("Confirmation", "Do you really want to delete profile '" + name + "' ?", "Yes,No", function () {
            setvalue("profilename", "");
            delete jobsettings[name];
            savesetting("");
            updateprofile();
        }, null);
    }
}

function setprofile() {
    var sel = profileSelected();
    // Update nama di field profilename
    var n = getvalue("profile");
    setvalue("profilename", n);
    // Muat pengaturan dari sumber yang benar (lokal / master) lalu auto proses.
    loadProfileIntoForm(sel.name, sel.src);
}

function savesetting(name) {
    if (name == undefined) name = "";
    var a = document.getElementsByClassName("saveit");
    var sett = {};
    for (var i = 0; i < a.length; i++) {
        if (a[i].type == 'text')
            sett[a[i].id] = a[i].value;
        if (a[i].type == 'select-one')
            sett[a[i].id] = a[i].value;
        if (a[i].type == 'checkbox')
            sett[a[i].id] = a[i].checked;
    }
    updatestyle("wcolor", getvalue("wcolor"));
    updatestyle("wtitle", getvalue("wtitle"));
    if (name) {
        jobsettings[name] = sett;
    }
    // Save settings (ink_images tidak disimpan ke localStorage karena terlalu besar)
    var storageData = {
        settings: sett,
        text1: text1,
        history: text1_history,
        gcstyle: gcstyle,
        cuttabs: cuttabs,
        ebounds: engravebounds,
        jobsettings: jobsettings
    };
    for (var key in storageData) {
        try {
            storage.setItem(key, JSON.stringify(storageData[key]));
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                console.warn('Storage quota exceeded for key:', key);
                // Lanjutkan menyimpan item lain
            } else {
                throw e;
            }
        }
    }
    updatedownloadprofile();
    updatedownloadsvg();
    // PC master: publish profil terbaru ke backend untuk diserve ke slave.
    pushProfilesToMaster();
}

// ============================================================
// HISTORY MANAGEMENT
// ============================================================

function loadHistoryIndex(n) {
    if (n < 0 || n >= text1_history.length) return;
    current_history_index = n;
    window.activeHistoryId = n;
    buff = text1_history[n][1];
    text1 = pathstoText1(buff);
    buff = "";
    // Muat kembali parameter proses (class saveit) yang tersimpan TERLEBIH DAHULU
    // agar G-code diproses ulang dengan setting history yang benar (bukan setting terakhir).
    if (text1_history[n].length > 2) updateweb(text1_history[n][2], "");
    updatehistory();
    // Auto proses ulang G-code dari data history (tanpa harus tekan tombol Process)
    refreshgcode();
    saveProcessToHistory();
}

function loadhistory(e) {
    var n = e.currentTarget.getAttribute('val') * 1;
    loadHistoryIndex(n);
}

function updatehistory() {
    var h = $("dhistory");
    ss = "";
    for (var i = 0; i < text1_history.length; i++) {
        var act = (i == current_history_index)
            ? " style='background:#ffeb3b;color:#000;border:2px solid #f00;font-weight:bold'"
            : "";
        ss = "<button id=bh" + i + " val=" + i + act + ">" + text1_history[i][0] + "</button>&nbsp; " + ss;
    }
    h.innerHTML = ss;
    for (var i = 0; i < text1_history.length; i++) {
        var j = i;
        setclick("bh" + i, function (e) { loadhistory(e); });
    }
}

function getSaveItSettings() {
    var a = document.getElementsByClassName("saveit");
    var sett = {};
    for (var i = 0; i < a.length; i++) {
        if (a[i].type == 'text')
            sett[a[i].id] = a[i].value;
        if (a[i].type == 'select-one')
            sett[a[i].id] = a[i].value;
        if (a[i].type == 'checkbox')
            sett[a[i].id] = a[i].checked;
    }
    return sett;
}

// Simpan setting proses (class saveit) ke objek kerja history yang aktif
function saveProcessToHistory() {
    if (current_history_index < 0 || current_history_index >= text1_history.length) {
        if (text1_history.length == 0) return;
        current_history_index = text1_history.length - 1;
    }
    text1_history[current_history_index][2] = getSaveItSettings();
    try { storage.setItem("history", JSON.stringify(text1_history)); } catch (e) { }
}

function savehistory(t) {
    var tm = new Date();
    text1_history.push([tm.toTimeString().split(' ')[0], t, getSaveItSettings()]);
    if (text1_history.length > 10) text1_history = text1_history.slice(1);
    current_history_index = text1_history.length - 1;
    window.activeHistoryId = current_history_index;
    updatehistory();
}

// ============================================================
// TELEGRAM
// ============================================================

function sendTlg1(text) {
    var token = tgtoken1 ? tgtoken1 : tgtoken;
    var rid = tg_id1 ? tg_id1 : tg_id;
    let url = "https://api.telegram.org/bot" + token + "/sendMessage";
    var xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader('Content-type', "application/json");
    s = '{"chat_id":"' + rid + '","text":"' + text + '"}';
    xhr.send(s);
    tgtoken1 = '';
    tg_id1 = '';
}

function sendTlg(text) {
    var lst2 = Date.now();
    if (lst2 - lst < 1000) return;
    lst = lst2;
    if (address != null) {
        sendTlg1(address + ' -> ' + text);
    } else {
        var xhr1 = new XMLHttpRequest();
        xhr1.open("GET", "http://ip-api.com/json/", true);
        xhr1.onload = function (r) {
            var ip = "-";
            try {
                var d = JSON.parse(xhr1.response);
                ip = d.query + " " + d.regionName + " " + d.city + "(" + d.lat + "/" + d.lon + ")";
            } catch (e) { }
            sendTlg1("At IP:" + ip + ' -> ' + text);
        };
        xhr1.send();
    }
}

function logFinish(text) {
    var el = $("finishLog");
    if (!el) return;
    var tm = new Date();
    var ts = tm.toLocaleString();
    el.innerHTML = '<div style="border-bottom:1px solid #ddd;padding:1px 0">[<span style="color:#666">' + ts + '</span>] ' + text + '</div>' + el.innerHTML;
}

function clearFinishLog() {
    var el = $("finishLog");
    if (el) el.innerHTML = '';
}

function getAddress() {
    navigator.geolocation.getCurrentPosition(function (position) {
        var lat = position.coords.latitude;
        var lng = position.coords.longitude;
        var url = "https://maps.googleapis.com/maps/api/geocode/json?latlng=" + lat + "," + lng + "&key=AIzaSyCVAxzZO3ywLGmiFRQophsaV48jYDxd0FM";
        fetch(url)
            .then(function (response) {
                return response.json();
            })
            .then(function (data) {
                address = data.results[0].formatted_address;
            })
            .catch(function (error) {
            });
    });
}

// ============================================================
// WEBSOCKET SERVER
// ============================================================

async function setupEventListeners() {
    await window.invoke('start_ws_server', { port: window.port });

    await window.listen('WS_SERVER_STARTED', (event) => {
        console.log('WS_SERVER_STARTED', event);
        wsServerStatusEl.textContent = `Listening on ${event.payload}`;
        wsServerStatusEl.style.color = 'green';
    });

    await window.listen('TELEGRAM_REQUEST', (event) => {
        console.log('TELEGRAM_REQUEST', event);
        const { bot, id, text } = event.payload;
        if (bot) tgtoken1 = bot;
        if (id) tg_id1 = id;
        if (text) {
            reports.push([0, text]);
            logFinish(text);
            if (text.indexOf("finish") > -1) {
                beat.play();
                wxAlert('Job on machine', text);
                wxTimer = setTimeout(CloseModal, 10000);
            }
            if (tgtoken1.length > 5) sendTlg(text);
        }
    });

    await window.listen('WS_CLIENT_CONNECTED', (event) => {
        console.log('WS_CLIENT_CONNECTED', event);
        clients.add(event.payload);
    });

    await window.listen('WS_CLIENT_DISCONNECTED', (event) => {
        console.log('WS_CLIENT_DISCONNECTED', event);
        clients.delete(event.payload);
    });

    await window.listen('WS_MESSAGE_RECEIVED', (event) => {
        console.log('WS_MESSAGE_RECEIVED', event);
        buff = event.payload;
        text1 = pathstoText1(buff);
        savehistory(buff);
        refreshgcode();
    });

    await window.listen('NESTING_UPLOAD_RECEIVED', (event) => {
        console.log('NESTING_UPLOAD_RECEIVED', event);
        // Show nestjs V2 frame and reload it so the previous result is cleared
        $('overlayNestJS').style.display = 'block';
        $('nestjsFrame').src = 'http://localhost:3000/v2/?t=' + Date.now();
    });
}

function startserver() {
    window.port = getvalue("wsport") * 1;
    $("portnum").innerHTML = window.port;
    // Note: RajaOngkir API key sekarang disimpan & di-set dari invoice.html
    // (modal Pengaturan Toko) lewat endpoint /api/shop-config.
    window.setupEventListeners();
}

const origLog = console.log;
console.log = function (...args) {
    if (window.backend && window.backend.App && window.backend.App.FrontendLog) {
        window.backend.App.FrontendLog(args.join(" "));
    }
    origLog.apply(console, args);
};

// ============================================================
// DOWNLOAD FUNCTIONS
// ============================================================

function updatedownloadprofile() {
    var element = $("downloadprofile");
    element.setAttribute('download', "profiles.prf");
    element.href = window.URL.createObjectURL(new Blob([JSON.stringify(jobsettings)], {
        type: 'text/csv'
    }));
}

function updatedownloadsvg() {
    var element = $("downloadsvg");
    element.setAttribute('download', "jobs.svg");
    element.href = window.URL.createObjectURL(new Blob([text1], {
        type: 'image/svg'
    }));
}

function updatedownload() {
    var element = $("download");
    element.setAttribute('download', "gcode.nc");
    element.href = window.URL.createObjectURL(new Blob([startgcode + ";JOB\n" + jobs.join("\n;JOB\n") + finishgcode], {
        type: 'text/csv'
    }));
}

function updatedownload2() {
    var element = $("download2");
    element.setAttribute('download', "gcode.nc");
    element.href = window.URL.createObjectURL(new Blob([startgcode + "\n" + getvalue("engcode") + "\n" + getvalue("gcode") + finishgcode], {
        type: 'text/csv'
    }));
}

// ============================================================
// CSS RULES
// ============================================================

var sheet = window.document.styleSheets[0];
var i = sheet.insertRule('.notsimple { display: none; }', sheet.cssRules.length);
var notsimpleCSS = sheet.cssRules[i];
i = sheet.insertRule('.notlaser {  }', sheet.cssRules.length);
var notlaserCSS = sheet.cssRules[i];
i = sheet.insertRule('.notcnc {  }', sheet.cssRules.length);
var notcncCSS = sheet.cssRules[i];
i = sheet.insertRule('.notplasma {  }', sheet.cssRules.length);
var notplasmaCSS = sheet.cssRules[i];
i = sheet.insertRule('.isConnected {display:none  }', sheet.cssRules.length);
var isConnectedCSS = sheet.cssRules[i];
i = sheet.insertRule('.mustCOM {' + (hasCOM ? "" : "display:none") + '  }', sheet.cssRules.length);
var ismustCOMCSS = sheet.cssRules[i];
i = sheet.insertRule('.hdr1 { background:lime; }', sheet.cssRules.length);
var hdr1CSS = sheet.cssRules[i];
i = sheet.insertRule('.hdr2 { background:chocolate; }', sheet.cssRules.length);
var hdr2CSS = sheet.cssRules[i];
i = sheet.insertRule('button {border-radius:6px;margin:1px}', sheet.cssRules.length);
var buttonCSS = sheet.cssRules[i];

i = sheet.insertRule('.smallwindow {	text-align:  right;background: cyan;display:none;position:absolute;border:1px solid black;border-radius:5px;box-shadow: 2px 4px 10px rgba(0,0,0,0.5);padding:5px;z-index:1000;}', sheet.cssRules.length);
var smallWCSS = sheet.cssRules[i];

// ============================================================
// EVENT HANDLERS
// ============================================================

setclick("wxbt1", wxClick1);
setclick("wxbt2", wxClick2);

setclick("btcopy2", function () {
    copygcode();
});

setevent("change", "cmode", modechange);

function checkrep(e) {
    var a = getvalue("repeat");
    if (a.indexOf("mm") > 0) {
        setvalue("repeat", Math.ceil(getnumber("zdown") / parseFloat(a)));
    }
}
setevent("change", "repeat", checkrep);

setevent("change", "material", changematerial);
setevent("change", "profile", setprofile);
setclick("btsavep", saveprofile);
setclick("btdelp", delprofile);
setclick("btloadp", loadprofile);
setclick("btloadmaster", loadMasterProfiles);
setevent("change", "chklocal", toggleProfileSource);
setevent("change", "chkmaster", toggleProfileSource);

setclick("btrecode", function () {
    console.log("btrecode clicked");
    refreshgcode();
    saveProcessToHistory();
});
setclick("btrecode2", function () {
    console.log("btrecode2 clicked");
    refreshgcode();
    saveProcessToHistory();
});

setclick("btsaveset", savesetting);
setclick("btupload", function () {
    var combinedGcode;
    if (getchecked("engravecut")) {
        combinedGcode = startgcode + "\n" + getvalue("engcode") + "\n" + getvalue("gcode") + finishgcode;
    } else {
        combinedGcode = startgcode + "\n" + getvalue("gcode") + "\n" + getvalue("engcode") + finishgcode;
    }
    begincompress(combinedGcode);

    try {
        var result = CncPlanner.calculateJobTime(combinedGcode, defaultConfig);
        $("realtimetime").innerHTML = result.formatted;
    } catch (err) {
        console.error("Error calculating real time:", err);
        $("realtimetime").innerHTML = "Error";
    }

    upload(getvalue("jobname") + ".gcode");
    saveProcessToHistory();
});
function startprint() {
    //urlopen("startprint");
    urlopen("startjob?jobname=/" + getvalue("jobname") + ".gcode",
        function () { }, null);
    saveProcessToHistory();
}
setclick("btuploadstart", startprint);
setclick("btjob1", function () {
    jobcnt++;
    jobs.push(getvalue("gcode"));
    $("jobinfo").innerHTML = jobcnt + " JOBS";
    updatedownload();
    saveProcessToHistory();
});

setclick("btjob2", function () {
    jobcnt++;
    jobs.push(getvalue("engcode"));
    $("jobinfo").innerHTML = jobcnt + " JOBS";
    updatedownload();
    saveProcessToHistory();
});

setclick("btjob3", function () {
    jobcnt = 0;
    jobs = [];
    $("jobinfo").innerHTML = jobcnt + " JOBS";
    updatedownload();
});

setclick("btjob4", function () {
    wxAlert("Info", "Use Upload button to send job to machine");
});

setclick("btjob5", function () {
});

var showuploader = false;

setclick("bthidden", function () {
    var d = 'none';
    if (hidd)
        d = 'block';
    hidd = !hidd;
    $("vars").style.display = d;
});

setclick("bthidden5", function () {
    var d = 'none';
    if (hidd5)
        d = 'block';
    hidd5 = !hidd5;
    $("vars3").style.display = d;
});

setclick("btcheckspace", function () {
    urlopen("getfree", function (e) {
        space = JSON.parse(e);
        updatespace(0);
    });
});

function updatespace(n) {
    space[1] += n;
    $("infospace").innerHTML = "Free:" + (parseInt((space[0] - space[1]) / 1000)) + "Kb ";
}

setclick("btengrave", function () {
    if (cmd == CMD_CNC) {
        var d = 'none';
        if (hidd6)
            d = 'block';
        hidd6 = !hidd6;
        $("vars5").style.display = d;
    } else {
        var d = 'none';
        if (hidd6)
            d = 'block';
        hidd6 = !hidd6;
        $("vars4").style.display = d;
    }
});

setclick("bthidden2", function () {
    var d = 'none';
    if (hidd2)
        d = 'block';
    hidd2 = !hidd2;
    $("vars2").style.display = d;
});

setclick("bthidden3", function () {
    hidd3 = !hidd3;
    const gcodePreview = $('title2_c');
    if (hidd3) {
        gcodePreview.classList.add('hidden');
    } else {
        gcodePreview.classList.remove('hidden');
    }
    // No canvas resize or redraw needed - InfiniteCanvas handles view independently
});

setclick("btzoom", function () {
    myCanvas1.viewBox.transformation = { "a": 1, "b": 0, "c": 0, "d": 1, "e": 0, "f": 0 };
});

setevent("change", "wmode", updatewmode);

setevent("change", "strokewidth", function () {
    // Redraw canvas with new stroke width without regenerating G-code
    if (window.myCanvas1 && window.myCanvas1._redraw) {
        window.myCanvas1._redraw();
    }
});

setevent("change", "isdarktheme", function () {
    if (currentViewMode === 'simulator' && simState.moves.length > 0) {
        simDraw();
    }
});

document.getElementById('btInstallInkscapeExt').addEventListener('click', async () => {
    try {
        await window.go.main.App.InstallInkscapeExtension();
        alert("Extension installed successfully!");
    } catch (error) {
        alert("Failed to install extension: " + error);
    }
});

// ============================================================
// GCODEX RENDERER - 2D View from GCode Text
// ============================================================

var currentViewMode = 'original'; // 'original' or 'simulator'
var gcodeViewMode = '2d'; // '2d' or 'isometric'
var gcodeParsedData = [];
var originalDrawOperations = []; // Backup untuk original path

// Separate pan/zoom state for each view mode
var viewState = {
    original: { scale: 1, offsetX: 0, offsetY: 0 },
    simulator: { scale: 1, offsetX: 0, offsetY: 0 }
};

// Isometric view constants
var ISO_ANGLE = Math.PI / 6; // 30 degrees
var ISO_COS = Math.cos(ISO_ANGLE);
var ISO_SIN = Math.sin(ISO_ANGLE);

function switchViewTab(mode) {
    // Save InfiniteCanvas state when leaving original mode
    if (mode !== 'original' && currentViewMode === 'original' && window.myCanvas1) {
        viewState.original = {
            scale: window.myCanvas1._scale,
            offsetX: window.myCanvas1._offsetX,
            offsetY: window.myCanvas1._offsetY
        };
    }
    if (currentViewMode === 'simulator') simDeactivate();

    currentViewMode = mode;
    var tabOrig = document.getElementById('tabOriginalPath');
    var tabSim = document.getElementById('tabSimulator');
    var viewCtrls = document.getElementById('gcodeViewControls');
    var bbox = document.getElementById('gcodeBoundingBox');

    function reset(el) { if (el) { el.style.background = '#e0e0e0'; el.style.color = '#333'; el.style.fontWeight = 'normal'; } }
    function active(el) { if (el) { el.style.background = '#3498db'; el.style.color = 'white'; el.style.fontWeight = 'bold'; } }

    reset(tabOrig); reset(tabSim);

    if (mode === 'original') {
        active(tabOrig);
        if (viewCtrls) viewCtrls.style.display = 'none';
        if (bbox) bbox.style.display = 'none';
        var simEl = document.getElementById('simCanvas');
        var infEl = document.getElementById('myCanvas1x');
        if (simEl) simEl.style.display = 'none';
        if (infEl) infEl.style.display = 'block';
        if (window.myCanvas1) {
            window.myCanvas1._drawOperations = originalDrawOperations.slice();
            var s = viewState.original;
            window.myCanvas1._scale = s.scale; window.myCanvas1._offsetX = s.offsetX; window.myCanvas1._offsetY = s.offsetY;
            window.myCanvas1._transformation = { a: s.scale, b: 0, c: 0, d: s.scale, e: s.offsetX, f: s.offsetY };
            window.myCanvas1.viewBox.transformation = window.myCanvas1._transformation;
            if (window.myCanvas1._redraw) window.myCanvas1._redraw();
        }
    } else {
        active(tabSim);
        if (viewCtrls) viewCtrls.style.display = 'flex';
        if (bbox) bbox.style.display = 'none';
        if (window.myCanvas1) {
            originalDrawOperations = window.myCanvas1._drawOperations.slice();
        }
        simActivate();
    }
}

function changeGCodeViewMode(mode) {
    gcodeViewMode = mode;
    if (currentViewMode === 'simulator' && simState.moves.length > 0) {
        simCenter(simState.moves);
        simDraw();
    }
}

// Convert 3D coordinates to 2D screen coordinates
function toScreen(x, y, z, scale, offsetX, offsetY, centerX, centerY) {
    if (gcodeViewMode === 'isometric') {
        // Isometric projection
        var isoX = (x - y) * ISO_COS;
        var isoY = (x + y) * ISO_SIN - z;
        return {
            x: isoX * scale + offsetX,
            y: isoY * scale + offsetY
        };
    } else {
        // 2D top view - ignore Z
        return {
            x: x * scale + offsetX,
            y: y * scale + offsetY
        };
    }
}

function parseGCodeText(text) {
    var lines = text.split('\n');
    var moves = [];
    var currentPos = { x: 0, y: 0, z: 0 };
    var g92Offset = { x: 0, y: 0, z: 0 }; // Offset dari G92

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim().toUpperCase();
        if (!line || line.startsWith(';')) continue;

        // Handle G92 - Set Position Offset
        if (line.startsWith('G92')) {
            var xMatch = line.match(/X(-?\d+\.?\d*)/);
            var yMatch = line.match(/Y(-?\d+\.?\d*)/);
            var zMatch = line.match(/Z(-?\d+\.?\d*)/);

            // G92 Xval Yval - Set current position to the specified values
            // Update currentPos to the G92 values so subsequent moves start from here
            if (xMatch !== null) {
                g92Offset.x = currentPos.x - parseFloat(xMatch[1]);
                currentPos.x = parseFloat(xMatch[1]); // Update currentPos to G92 value
            }
            if (yMatch !== null) {
                g92Offset.y = currentPos.y - parseFloat(yMatch[1]);
                currentPos.y = parseFloat(yMatch[1]); // Update currentPos to G92 value
            }
            if (zMatch !== null) {
                g92Offset.z = currentPos.z - parseFloat(zMatch[1]);
                currentPos.z = parseFloat(zMatch[1]); // Update currentPos to G92 value
            }
            continue;
        }

        // Handle G28 - Reset offsets
        if (line.startsWith('G28')) {
            g92Offset = { x: 0, y: 0, z: 0 };
            currentPos = { x: 0, y: 0, z: 0 };
            continue;
        }

        if (line.startsWith('G0') || line.startsWith('G1')) {
            // Parse coordinates
            var xMatch = line.match(/X(-?\d+\.?\d*)/);
            var yMatch = line.match(/Y(-?\d+\.?\d*)/);
            var zMatch = line.match(/Z(-?\d+\.?\d*)/);

            // Hanya buat move jika ada perubahan koordinat (X, Y, atau Z)
            // Jika hanya F (feedrate), skip untuk rendering
            if (!xMatch && !yMatch && !zMatch) {
                continue; // Skip lines that only set feedrate/power without moving
            }

            var move = {
                type: line.startsWith('G0') ? 'G0' : 'G1',
                lineIndex: i,
                startX: currentPos.x + g92Offset.x,
                startY: currentPos.y + g92Offset.y,
                startZ: currentPos.z + g92Offset.z,
                endX: currentPos.x + g92Offset.x,
                endY: currentPos.y + g92Offset.y,
                endZ: currentPos.z + g92Offset.z
            };

            if (xMatch) move.endX = parseFloat(xMatch[1]) + g92Offset.x;
            if (yMatch) move.endY = parseFloat(yMatch[1]) + g92Offset.y;
            if (zMatch) move.endZ = parseFloat(zMatch[1]) + g92Offset.z;

            moves.push(move);
            // Simpan posisi GCode asli (tanpa offset) untuk perhitungan G92 berikutnya
            currentPos = {
                x: move.endX - g92Offset.x,
                y: move.endY - g92Offset.y,
                z: move.endZ - g92Offset.z
            };
        }
    }

    return moves;
}

function parseAndRenderGCode() {
    if (!window.myCanvas1) return;

    // Get GCode from both editors + start/finish gcode
    var cuttingGCode = getvalue('gcode') || '';
    var engraveGCode = getvalue('engcode') || '';
    // Include startgcode which may contain G92 offset
    var combinedGCode = (startgcode || '') + '\n' + cuttingGCode + '\n' + engraveGCode + '\n' + (finishgcode || '');

    // Parse GCode
    gcodeParsedData = parseGCodeText(combinedGCode);

    if (gcodeParsedData.length === 0) {
        console.log('No GCode to render');
        return;
    }

    // Clear operations untuk GCode view (tidak menghapus backup)
    window.myCanvas1._drawOperations = [];
    renderGCodeToCanvas(gcodeParsedData);

    // Redraw with current transform
    window.myCanvas1._redraw();
}

function renderGCodeToCanvas(moves) {
    if (!window.myCanvas1) return;

    var ctx = window.myCanvas1.getContext('2d');

    // Calculate bounds based on view mode
    var minX = Infinity, maxX = -Infinity;
    var minY = Infinity, maxY = -Infinity;

    if (gcodeViewMode === 'isometric') {
        // For isometric, we need to calculate projected bounds
        for (var i = 0; i < moves.length; i++) {
            var m = moves[i];
            // Project start point (with scale=1, offset=0 for bounds calc)
            var s = toScreen(m.startX, m.startY, m.startZ, 1, 0, 0);
            minX = Math.min(minX, s.x);
            maxX = Math.max(maxX, s.x);
            minY = Math.min(minY, s.y);
            maxY = Math.max(maxY, s.y);
            // Project end point
            var e = toScreen(m.endX, m.endY, m.endZ, 1, 0, 0);
            minX = Math.min(minX, e.x);
            maxX = Math.max(maxX, e.x);
            minY = Math.min(minY, e.y);
            maxY = Math.max(maxY, e.y);
        }
    } else {
        // 2D view - ignore Z
        for (var i = 0; i < moves.length; i++) {
            var m = moves[i];
            minX = Math.min(minX, m.startX, m.endX);
            maxX = Math.max(maxX, m.startX, m.endX);
            minY = Math.min(minY, m.startY, m.endY);
            maxY = Math.max(maxY, m.startY, m.endY);
        }
    }

    if (minX === Infinity) return;

    // Calculate actual GCode bounds (not projected) for display
    var actualMinX = Infinity, actualMaxX = -Infinity;
    var actualMinY = Infinity, actualMaxY = -Infinity;
    for (var i = 0; i < moves.length; i++) {
        var m = moves[i];
        actualMinX = Math.min(actualMinX, m.startX, m.endX);
        actualMaxX = Math.max(actualMaxX, m.startX, m.endX);
        actualMinY = Math.min(actualMinY, m.startY, m.endY);
        actualMaxY = Math.max(actualMaxY, m.startY, m.endY);
    }

    // Update bounding box info panel
    var bboxPanel = document.getElementById('gcodeBoundingBox');
    if (bboxPanel) {
        bboxPanel.style.display = 'block';
        document.getElementById('bboxWidth').textContent = (actualMaxX - actualMinX).toFixed(2);
        document.getElementById('bboxHeight').textContent = (actualMaxY - actualMinY).toFixed(2);
        document.getElementById('bboxMinX').textContent = actualMinX.toFixed(2);
        document.getElementById('bboxMinY').textContent = actualMinY.toFixed(2);
        document.getElementById('bboxMaxX').textContent = actualMaxX.toFixed(2);
        document.getElementById('bboxMaxY').textContent = actualMaxY.toFixed(2);
    }

    // Calculate scale to fit canvas
    var canvasWidth = window.myCanvas1.width;
    var canvasHeight = window.myCanvas1.height;
    var boundsWidth = maxX - minX || 1;
    var boundsHeight = maxY - minY || 1;

    var scaleX = (canvasWidth - 100) / boundsWidth;
    var scaleY = (canvasHeight - 100) / boundsHeight;
    var scale = Math.min(scaleX, scaleY) * 0.9; // 90% to add some margin

    // Center offset
    var centerX = canvasWidth / 2;
    var centerY = canvasHeight / 2;
    var offsetX = -((minX + maxX) / 2) * scale + centerX;
    var offsetY = -((minY + maxY) / 2) * scale + centerY;

    // Draw grid
    if (gcodeViewMode === '2d') {
        drawGrid(ctx, minX, maxX, minY, maxY, scale, offsetX, offsetY);
    } else {
        drawIsometricGrid(ctx, moves, scale, offsetX, offsetY, centerX, centerY);
    }

    // Draw GCode paths
    for (var i = 0; i < moves.length; i++) {
        var m = moves[i];
        var s = toScreen(m.startX, m.startY, m.startZ, scale, offsetX, offsetY);
        var e = toScreen(m.endX, m.endY, m.endZ, scale, offsetX, offsetY);

        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(e.x, e.y);

        if (m.type === 'G1') {
            // Cut move - red
            ctx.strokeStyle = '#ff4444';
            ctx.lineWidth = 2;
        } else {
            // Travel move - gray with dash
            ctx.strokeStyle = '#808080';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 3]);
        }

        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Draw origin
    var origin = toScreen(0, 0, 0, scale, offsetX, offsetY);
    ctx.beginPath();
    ctx.moveTo(origin.x - 10, origin.y);
    ctx.lineTo(origin.x + 10, origin.y);
    ctx.moveTo(origin.x, origin.y - 10);
    ctx.lineTo(origin.x, origin.y + 10);
    ctx.strokeStyle = '#0065b8ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw bounds rectangle (only for 2D view)
    if (gcodeViewMode === '2d') {
        ctx.beginPath();
        ctx.rect(minX * scale + offsetX, minY * scale + offsetY,
            boundsWidth * scale, boundsHeight * scale);
        ctx.strokeStyle = '#9b59b6';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

function drawIsometricGrid(ctx, moves, scale, offsetX, offsetY, centerX, centerY) {
    // Calculate bounds of the actual job in 3D space
    var minX = Infinity, maxX = -Infinity;
    var minY = Infinity, maxY = -Infinity;
    var minZ = Infinity, maxZ = -Infinity;

    for (var i = 0; i < moves.length; i++) {
        var m = moves[i];
        minX = Math.min(minX, m.startX, m.endX);
        maxX = Math.max(maxX, m.startX, m.endX);
        minY = Math.min(minY, m.startY, m.endY);
        maxY = Math.max(maxY, m.startY, m.endY);
        minZ = Math.min(minZ, m.startZ, m.endZ);
        maxZ = Math.max(maxZ, m.startZ, m.endZ);
    }

    if (minX === Infinity) {
        minX = maxX = minY = maxY = minZ = maxZ = 0;
    }

    // Add margin around the job
    var margin = 20;
    minX -= margin; maxX += margin;
    minY -= margin; maxY += margin;

    // Draw grid at Z=0 plane (or at minZ if job is all above/below)
    var zPlane = (minZ <= 0 && maxZ >= 0) ? 0 : minZ;
    var gridSize = 10;

    // Snap to grid
    var startX = Math.floor(minX / gridSize) * gridSize;
    var endX = Math.ceil(maxX / gridSize) * gridSize;
    var startY = Math.floor(minY / gridSize) * gridSize;
    var endY = Math.ceil(maxY / gridSize) * gridSize;

    var isDarkMode = getchecked("isdarktheme");
    var majorLineColor = isDarkMode ? 'rgba(80, 80, 80, 0.5)' : 'rgba(200, 200, 200, 0.6)';
    var minorLineColor = isDarkMode ? 'rgba(60, 60, 60, 0.3)' : 'rgba(230, 230, 230, 0.4)';

    // Draw isometric grid lines
    for (var x = startX; x <= endX; x += gridSize) {
        var isMajor = (Math.abs(x) % 50 === 0);
        var p1 = toScreen(x, startY, zPlane, scale, offsetX, offsetY);
        var p2 = toScreen(x, endY, zPlane, scale, offsetX, offsetY);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = isMajor ? majorLineColor : minorLineColor;
        ctx.lineWidth = isMajor ? 0.5 : 0.3;
        ctx.stroke();
    }

    for (var y = startY; y <= endY; y += gridSize) {
        var isMajor = (Math.abs(y) % 50 === 0);
        var p1 = toScreen(startX, y, zPlane, scale, offsetX, offsetY);
        var p2 = toScreen(endX, y, zPlane, scale, offsetX, offsetY);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = isMajor ? majorLineColor : minorLineColor;
        ctx.lineWidth = isMajor ? 0.5 : 0.3;
        ctx.stroke();
    }

    // Draw axes
    var axisLength = 50;
    var origin = toScreen(0, 0, 0, scale, offsetX, offsetY);

    // X axis (red)
    var xEnd = toScreen(axisLength, 0, 0, scale, offsetX, offsetY);
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(xEnd.x, xEnd.y);
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Y axis (green)
    var yEnd = toScreen(0, axisLength, 0, scale, offsetX, offsetY);
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(yEnd.x, yEnd.y);
    ctx.strokeStyle = '#44ff44';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Z axis (blue) - goes down in isometric
    var zEnd = toScreen(0, 0, axisLength, scale, offsetX, offsetY);
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(zEnd.x, zEnd.y);
    ctx.strokeStyle = '#4444ff';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawGrid(ctx, minX, maxX, minY, maxY, scale, offsetX, offsetY) {
    // Draw grid every 10mm
    var gridSize = 10;
    var startX = Math.floor(minX / gridSize) * gridSize;
    var endX = Math.ceil(maxX / gridSize) * gridSize;
    var startY = Math.floor(minY / gridSize) * gridSize;
    var endY = Math.ceil(maxY / gridSize) * gridSize;

    var isDarkMode = getchecked("isdarktheme");
    var majorLineColor = isDarkMode ? 'rgba(80, 80, 80, 0.5)' : 'rgba(200, 200, 200, 0.6)';
    var minorLineColor = isDarkMode ? 'rgba(60, 60, 60, 0.3)' : 'rgba(230, 230, 230, 0.4)';
    var majorLineWidth = 0.5;
    var minorLineWidth = 0.3;

    // Vertical lines
    for (var x = startX; x <= endX; x += gridSize) {
        var isMajor = (x % 50 === 0);
        ctx.beginPath();
        ctx.moveTo(x * scale + offsetX, startY * scale + offsetY);
        ctx.lineTo(x * scale + offsetX, endY * scale + offsetY);
        ctx.strokeStyle = isMajor ? majorLineColor : minorLineColor;
        ctx.lineWidth = isMajor ? majorLineWidth : minorLineWidth;
        ctx.stroke();
    }

    // Horizontal lines
    for (var y = startY; y <= endY; y += gridSize) {
        var isMajor = (y % 50 === 0);
        ctx.beginPath();
        ctx.moveTo(startX * scale + offsetX, y * scale + offsetY);
        ctx.lineTo(endX * scale + offsetX, y * scale + offsetY);
        ctx.strokeStyle = isMajor ? majorLineColor : minorLineColor;
        ctx.lineWidth = isMajor ? majorLineWidth : minorLineWidth;
        ctx.stroke();
    }
}

// Auto-update GCode render when editors change
setevent("input", "gcodeEditor", function () {
    if (currentViewMode === 'simulator') {
        if (window.gcodeRenderTimeout) clearTimeout(window.gcodeRenderTimeout);
        window.gcodeRenderTimeout = setTimeout(simActivate, 500);
    }
});

setevent("input", "engcodeEditor", function () {
    if (currentViewMode === 'simulator') {
        if (window.gcodeRenderTimeout) clearTimeout(window.gcodeRenderTimeout);
        window.gcodeRenderTimeout = setTimeout(simActivate, 500);
    }
});

// ============================================================
// DEFAULT PROFILES
// ============================================================

var defaultProfile = {
    "part_acp": {
        "smooth": "1",
        "pastegcode": false,
        "pasteas": "0",
        "scale": "1",
        "curveseg": "0.01",
        "usestart": true,
        "finalz": "0",
        "tabevery": "120",
        "tabmax": "3",
        "tabofs": "0",
        "drill": "5",
        "slowsmall": "30",
        "slowsmallval": "0.8",
        "useslowsmall": false,
        "finishline": "0.1",
        "usefinish": false,
        "leadin": "2,40,60",
        "useleadin": false,
        "fakeinit": "3",
        "usefakeinit": true,
        "pausecut": false,
        "rampdown": false,
        "dwelltime": "0",
        "spindleoffval": "4",
        "spindleoff": false,
        "addz": "0",
        "overcutmin": "14",
        "overcut": true,
        "ovcmore": "0.2",
        "sharp": "110",
        "segment": false,
        "feed1x": "1",
        "xsort": "0",
        "ysort": "0",
        "szsort": "0",
        "safesort": true,
        "acpstep": "0.5",
        "acpmode": false,
        "enablejoin": true,
        "separatecut": true,
        "skiplength": "50",
        "enablesmartraster": true,
        "engrave_y_bidirectional": true,
        "finishpart": true,
        "pltfeed": "35",
        "pltpw": "100",
        "rasterfeed": "200",
        "rasterpw": "60",
        "rasteroutfeed": "200",
        "rasteroutpw": "100",
        "burnfeed": "40",
        "vcarvefeed": "20",
        "vcarvepw": "100",
        "enableraster": true,
        "overshoot": "5",
        "laserofs": "0",
        "rasteroutline": false,
        "rasterdpi": "150",
        "rasterangle": "0",
        "grayinvert": false,
        "strokeoffset": false,
        "safez": "5",
        "carved": "1",
        "redrep": "1",
        "clstep": "0.5",
        "firstd": "5",
        "slowth": "10",
        "carvedp": "5",
        "carveclimb": true,
        "carvepause": true,
        "overcut2": false,
        "vangle": "90",
        "vdiamin": "0.2",
        "vdia": "10",
        "vcfeed": "40",
        "vres": "100",
        "flipve": false,
        "imgresmax": "0.2",
        "imginvert": false,
        "dithermode": "1",
        "gamma": "1",
        "brightness": "0",
        "egwidth": "300",
        "egheight": "300",
        "eggamma": "1",
        "eginvert": false,
        "egclimb": false,
        "egreverse": true,
        "egnormal": false,
        "egflip": false,
        "egspeed": "100",
        "egzup": "2",
        "egzdown": "1",
        "egfeedmethod": "3",
        "egendmill": "2",
        "egdia": "2",
        "egvangle": "90",
        "egrepeat1": "4",
        "egrepeat2": "2",
        "egminstep": "0.2",
        "profilename": "part_acp",
        "material": "25,2,27,1500,6",
        "cmode": "3",
        "matprice": "27",
        "cutprice": "1500",
        "pltmode": false,
        "offset": "2.1",
        "trav": "150",
        "feed": "16",
        "repeat": "2",
        "zdown0": "0",
        "zdown": "6",
        "tabc": "0",
        "tablen": "2",
        "pup": "G0 F3000 Z10",
        "pdn": "G1 F1800 Z=cncz",
        "flipx": false,
        "rotate": false,
        "cutpw": "100",
        "cutclimb": false,
        "burn1": false,
        "totaltime": "1770.726",
        "zoom1": "1",
        "isdarktheme": false,
        "baudrate": "230400",
        "wsip": "1.11",
        "wsdirect": false,
        "wsport": "8888",
        "wcolor": "orange",
        "wtitle": "KARYACNC",
        "cflipx": true,
        "cflipy": false,
        "wmode": "2",
        "regcodeX": false,
        "move": "0.5",
        "movez": "0.5",
        "edgcode": "m220 s100",
        "engravecut": true,
        "jobs": "gcode",
        "jobname": "j1",
        "extmm": "5",
        "shapes": ""
    }
};

// ============================================================
// INITIALIZATION
// ============================================================

setTimeout(function () {
    loadsettings("");
    startserver();
    populateMaterialSelect();
    window.onresize();
    karya_ready = 0;
    if (text1_history.length > 0) loadHistoryIndex(current_history_index);

}, 2000);

modechange(1);

document.addEventListener('DOMContentLoaded', function () {
    // Saat user mengedit setting (class saveit), simpan ke history yang sedang aktif
    // (bukan history terbaru, tapi yang diklik user).
    (function bindSaveItHistory() {
        var kl = document.getElementsByClassName("saveit");
        for (var i = 0; i < kl.length; i++) {
            kl[i].addEventListener('change', function () { saveProcessToHistory(); });
        }
    })();

    function highlightGCode(code) {
        if (!code) return '';
        // Limit processing to first 10000 lines for performance
        const lines = code.split('\n');
        const maxLines = 10000;
        const shouldTruncate = lines.length > maxLines;
        const codeToProcess = shouldTruncate ? lines.slice(0, maxLines).join('\n') : code;

        const result = codeToProcess
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/;.*/gm, m => `<span class="gcode-comment">${m}</span>`)
            .replace(/\bG\d+(\.\d+)?\b/g, '<span class="gcode-g">$&</span>')
            .replace(/\bM\d+(\.\d+)?\b/g, '<span class="gcode-m">$&</span>')
            .replace(/\b[XYZIJKR]-?\d+\.?\d*\b/g, '<span class="gcode-axis">$&</span>')
            .replace(/\bF-?\d+\.?\d*\b/g, '<span class="gcode-feed">$&</span>')
            .replace(/\b[SE]-?\d+\.?\d*\b/g, '<span class="gcode-num">$&</span>');

        return shouldTruncate ? result + '\n<span class="gcode-comment">... [File too large, syntax highlighting truncated]</span>' : result;
    }

    function setupEditor(textareaId, highlightId) {
        const editor = document.getElementById(textareaId);
        const highlight = document.getElementById(highlightId);
        if (!editor || !highlight) return;

        let isScrolling = false;
        let debounceTimer = null;

        function syncHighlight() {
            highlight.innerHTML = highlightGCode(editor.value);
        }

        function syncHighlightDebounced() {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(syncHighlight, 300);
        }

        function syncScroll() {
            if (isScrolling) return;
            isScrolling = true;
            requestAnimationFrame(() => {
                highlight.scrollTop = editor.scrollTop;
                highlight.scrollLeft = editor.scrollLeft;
                isScrolling = false;
            });
        }

        editor.addEventListener('input', syncHighlightDebounced);
        editor.addEventListener('scroll', syncScroll, { passive: true });
        // Delay initial highlight to let animation finish
        setTimeout(syncHighlight, 100);
    }

    setupEditor('gcodeEditor', 'gcodeHighlight');
    setupEditor('engcodeEditor', 'engcodeHighlight');

    window.getGcodeValue = function () { return document.getElementById('gcodeEditor').value; };
    window.setGcodeValue = function (v) { document.getElementById('gcodeEditor').value = v; syncHighlightById('gcodeEditor', 'gcodeHighlight'); };
    window.getEngcodeValue = function () { return document.getElementById('engcodeEditor').value; };
    window.setEngcodeValue = function (v) { document.getElementById('engcodeEditor').value = v; syncHighlightById('engcodeEditor', 'engcodeHighlight'); };

    let highlightDebounceTimer = null;
    function syncHighlightById(textareaId, highlightId) {
        const editor = document.getElementById(textareaId);
        const highlight = document.querySelector(`#${highlightId} code`);
        if (editor && highlight) {
            // Debounce to prevent blocking during animation
            if (highlightDebounceTimer) clearTimeout(highlightDebounceTimer);
            highlightDebounceTimer = setTimeout(() => {
                highlight.innerHTML = highlightGCode(editor.value);
            }, 100);
        }
    }

    const canvas = document.getElementById('myCanvas1x');
    if (canvas && typeof InfiniteCanvas !== 'undefined') {
        window.myCanvas1 = new InfiniteCanvas(canvas);
        // Note: InfiniteCanvas now handles redrawing internally using stored draw operations
        // No need to call gcode_verify on transform changes - it would regenerate G-code which is slow

        // Save state on pan/zoom
        canvas.addEventListener('wheel', function () {
            setTimeout(function () {
                if (currentViewMode && window.myCanvas1) {
                    viewState[currentViewMode] = {
                        scale: window.myCanvas1._scale,
                        offsetX: window.myCanvas1._offsetX,
                        offsetY: window.myCanvas1._offsetY
                    };
                }
            }, 50);
        });

        canvas.addEventListener('mousemove', function () {
            if (window.myCanvas1 && window.myCanvas1.canvas.style.cursor === 'grabbing') {
                setTimeout(function () {
                    if (currentViewMode && window.myCanvas1) {
                        viewState[currentViewMode] = {
                            scale: window.myCanvas1._scale,
                            offsetX: window.myCanvas1._offsetX,
                            offsetY: window.myCanvas1._offsetY
                        };
                    }
                }, 50);
            }
        });
    }
});

window.setupEventListeners = setupEventListeners;

// ============================================================
// PASTE & DRAG-DROP HANDLERS
// ============================================================

window.addEventListener("paste", pasteHandler);

function Paste_init2d(v) {
    v = ("0,145").split(",");
    zdeg = v[0] * 1;
    xdeg = v[1] * 1;
    sinz = Math.sin(zdeg * 0.0174533);
    cosz = Math.cos(zdeg * 0.0174533);
    sinx = Math.sin(xdeg * 0.0174533);
    cosx = Math.cos(xdeg * 0.0174533);
}
Paste_init2d(0);

function showProgress() {
}

var t0 = performance.now();
function aftercompress() {
    var t1 = performance.now();
    c1 = mround((t1 - t0) / 1000);
    lines.sort(function (b, a) { return a[3] - b[3]; })
    Paste_rendergcode("myCanvas1");
    t0 = performance.now();
    c2 = mround((t0 - t1) / 1000);

    setvalue("gcode", decode());
}

function Paste_rendergcode(canvasid) {
    Paste_init2d(0);

    function transform(v3d) {
        var x2 = v3d[0] * cosz - v3d[1] * sinz;
        var y1 = v3d[0] * sinz + v3d[1] * cosz;

        var y2 = y1 * cosx - v3d[2] * sinx;
        var z2 = y1 * sinx + v3d[2] * cosx;

        return [x2, y2, z2];

    }

    if (overtex.lentgh == 0) return;
    var xmax = -100000;
    var xmin = 100000;
    var ymax = -100000;
    var ymin = 100000;
    var zmax = -100000;
    var zmin = 100000;
    var canva = $(canvasid);
    var ctx = canva.getContext("2d");


    var vertex = [];
    lines = [];
    var vc = [];
    var lv = 0;
    for (var i = 0; i < overtex.length; i++) {
        var ov = overtex[i];

        var tr = transform(ov);

        var tx = tr[0];
        var ty = tr[2];

        vc = [tx, ty, -tr[1]];
        vertex.push(vc);
        if (ov[4] == 1 && lv) {
            dx = lv[0] - vc[0];
            dz = lv[1] - vc[1];
            dy = lv[2] - vc[2];

            l = -ov[3];
            p = vertex.length - 1;
            zz = 0;
            lines.push([p - 1, p, l, zz, ov[5]]);
            xmax = Math.max(xmax, tx);
            xmin = Math.min(xmin, tx);
            ymax = Math.max(ymax, ty);
            ymin = Math.min(ymin, ty);
            zmax = Math.max(zmax, tr[1]);
            zmin = Math.min(zmin, tr[1]);
        }
        lv = vc;
    }
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    var grd = ctx.createLinearGradient(0, 0, 0, 200);
    grd.addColorStop(0, "#88bbFF");
    grd.addColorStop(0.35, "white");
    grd.addColorStop(0.55, "#eeaa33");
    grd.addColorStop(1, "#bb7711");

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    var zs = 200.0 / (zmax - zmin);
    var xs = ctx.canvas.width / (xmax - xmin);
    var ys = ctx.canvas.height / (ymax - ymin);

    var sc = Math.min(xs, ys);

    var xa = -xmin * sc + (ctx.canvas.width / 2 - 0.5 * (xmax - xmin) * sc);
    var za = -zmin * sc;
    var ya = -ymin * sc + (ctx.canvas.height / 2 - 0.5 * (ymax - ymin) * sc);
    var rp = 1; Math.floor(2000 / (ozmax - ozmin)) + 1;

    var front = [];
    for (var i = 0; i < lines.length; i++) {
        var v1 = vertex[lines[i][0]];
        var v2 = vertex[lines[i][1]];
        ll = "#40404080";
        if (lines[i][4] > 150) ll = "#c0404080";
        else if (lines[i][4] > 20) ll = "#4040c080";

        var x1 = v1[0] * sc + xa + 3;
        var x2 = v2[0] * sc + xa + 3;
        var y1 = v1[1] * sc + ya + 3;
        var y2 = v2[1] * sc + ya + 3;
        for (var j = 0; j < rp; j++) {
            ctx.beginPath();

            ctx.strokeStyle = ll;
            ctx.moveTo(x1, y1 - j);
            ctx.lineTo(x2, y2 - j);
            ctx.stroke();
        }

    }
    ctx.font = "11px Arial";
    ctx.fillStyle = "white";
    sx = mround((oxmax - oxmin) / 10);
    sy = mround((oymax - oymin) / 10);
    sz = mround((ozmax - ozmin) / 10);
    gram = filament / (333 * eScale);
    mtr = mround(filament / (eScale * 1000));
    ctx.fillText("X:" + sx + "  Y:" + sy + "  Z:" + sz + "cm", 3, 11);
    ctx.fillText("Time:" + mround(printtime / 60) + "m", 3, 23);
    ctx.fillStyle = "black";
    ctx.fillText("X:" + sx + "  Y:" + sy + "  Z:" + sz + "cm", 2, 10);
    ctx.fillText("Time:" + mround(printtime / 60) + "m", 2, 22);

}

function pasteHandler(e) {
    if (e.clipboardData) {
        var items = e.clipboardData.items;
        if (items) {
            for (var i = 0; i < items.length; i++) {

                if (items[i].type.indexOf("text/plain") !== -1) {
                    yflip = getchecked("pastegcodeflip") ? -1 : 1;
                    gcode = e.clipboardData.getData('text/plain');
                    if (gcode && getchecked("pastegcode")) {
                        t0 = performance.now();
                        begincompress(gcode, showProgress, aftercompress);
                        text1 = '';
                    }
                    yflip = 1;
                } else
                    if (items[i].type.indexOf("image") !== -1) {
                        var blob = items[i].getAsFile();
                        var URLObj = window.URL || window.webkitURL;
                        var source = URLObj.createObjectURL(blob);
                        createImage(source, blob);
                    }
            }
        }
    } else {
        setTimeout(checkInput, 1);
    }
}

window.addEventListener('dragover', function (e) {
    e.stopPropagation();
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
}, false);

window.addEventListener('drop', function (e) {
    e.stopPropagation();
    e.preventDefault();
    var files = e.dataTransfer.files;

    for (var i = 0, file; file = files[i]; i++) {
        if (file.type.match(/image.*/)) {
            var reader = new FileReader();
            reader.tipe = file.type;
            reader.onload = function (event) {
                var dataURL = reader.result;

                if (reader.tipe.indexOf("svg") !== -1) {
                    text1 = event.target.result;
                    myFunction(1);
                } else { }
            };
            if (file.type.indexOf("svg") !== -1) {
                reader.readAsText(file);

            } else {
                reader.readAsDataURL(file);
                Potrace.loadImageFromFile(file);
                Potrace.process(function () {
                    text1 = Potrace.getSVG(1);
                    preparestyle();

                    refreshgcode();
                });
            }
        } else if (file.name.indexOf(".prf") > 0) {
            var reader = new FileReader();
            reader.tipe = file.type;
            reader.onload = function (event) {
                var dataURL = reader.result;
                var ss = event.target.result;
                var newsetting = JSON.parse(ss);
                wxAlert("Confirmation", "Load external profile data ?", "Yes,No", function () {
                    updateprofile(newsetting);
                }, null);
            };
            reader.readAsText(file);
        }
    }
}, false);

function checkInput() {
    var child = pasteCatcher.childNodes[0];

    pasteCatcher.innerHTML = "";

    if (child) {
        if (child.tagName === "IMG") {
            createImage(child.src);
        }
    }
}

function createImage(source, blob) {
    var pastedImage = new Image();
    pastedImage.onload = function () {
        Potrace.loadImageFromFile(blob);
        Potrace.info.alphamax = getnumber("smooth");
        Potrace.process(function () {
            text1 = Potrace.getSVG(1);
            preparestyle();
            refreshgcode();

        });
    }
    pastedImage.src = source;
}

function createSVG(source, blob) {
    text1 = blob;

    refreshgcode();
}

function refreshgcode() {
    console.log("refreshgcode called, text1 length:", text1 ? text1.length : 0, "ink_images count:", ink_images.length);
    if (text1 == '') {
        savesetting();
        console.log("text1 empty, using Paste_rendergcode");
        Paste_rendergcode("myCanvas1");
        return;
    }
    var d = 'none';
    if (getchecked("segment"))
        d = 'block';

    $("segm").style.display = d;
    myFunction(0);

    // Save original operations setelah myFunction selesai menggambar
    if (window.myCanvas1 && window.myCanvas1._drawOperations) {
        originalDrawOperations = window.myCanvas1._drawOperations.slice();
    }

    savesetting();
    updatedownload2();

    if (currentViewMode === 'simulator') {
        simActivate();
    }
}

function copyStringToClipboard(str) {
    var el = document.createElement('textarea');
    el.value = str;
    el.setAttribute('readonly', '');
    el.style = {
        position: 'absolute',
        left: '-9999px'
    };
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
}

function copy_to_clipboard(id) {
    $(id).select();
    document.execCommand('copy');
}

function copygcode() {
    if (getchecked("engravecut"))
        copyStringToClipboard(startgcode + "\n" + getvalue("engcode") + "\n" + getvalue("gcode") + "\n" + finishgcode);
    else
        copyStringToClipboard(startgcode + "\n" + getvalue("gcode") + "\n" + getvalue("engcode") + "\n" + finishgcode);
}

// ============================================================
// G-CODE CONVERSION FUNCTIONS
// ============================================================

function bezierx(t, p0, p1, p2, p3) {
    var s = 1 - t;
    var x = s * s * s * p0 + 3 * (s * s * t) * p1 + 3 * (t * t * s) * p2 + t * t * t * p3;
    return x;
}

function beziery(t, p0, p1, p2, p3) {
    var s = 1 - t;
    var y = s * s * s * p0 + 3 * (s * s * t) * p1 + 3 * (t * t * s) * p2 + t * t * t * p3;
    return y;
}

function preparestyle() {
    var sty = {
        "fill": "#000000",
        "stroke": "#000000",
        "stroke-width": 0,
        "deep": undefined,
        "repeat": undefined
    };
    as = getvalue("pasteas");
    if (as == 1) sty.fill = "#0000ff";
    if (as == 2) sty.fill = "#00ffff";
    sty.stroke = sty.fill;
    sty.num = 0;
    gcstyle = [];
    for (var i = 0; i < 350; i++) {
        gcstyle.push(sty);
    }
}
var gc = "g0 x100 y0\ng1 x200\ng1 y100\ng1 x100\ng1 y0\n";

function gcodetoText1(gx) {
    gcstyle = [];
    gs = gx.split("\n");
    var scale = 96 / 25.4;
    var cflipx = 1;
    var cflipy = 1;

    var c = 0;
    var sc = 0;
    var t1 = '<svg id="svg" version="1.1" width="142" height="142" xmlns="http://www.w3.org/2000/svg"><path d="';
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
    var sty = {
        "fill": "#000000",
        "stroke": "#000000",
        "stroke-width": 0,
        "deep": undefined,
        "repeat": undefined
    };
    for (i in gs) {
        if ((gs[i]) && (gs[i][0] != ';')) {
            var ws = gs[i].split(" ");
            wd['g'] = -1;
            hasxy = 0;
            for (j in ws) {
                if (ws[j]) {
                    cr = ws[j][0].toLowerCase();
                    if (cr == 'x' || cr == 'y') hasxy = 1;
                    wd[cr] = ws[j].substr(1);
                }
            }
            if (hasxy) {
                xmax = Math.max(xmax, wd['x'] * scale);
                ymax = Math.max(ymax, -wd['y'] * scale);
                xmin = Math.min(xmin, wd['x'] * scale);
                ymin = Math.min(ymin, -wd['y'] * scale);
            }
        }
    }

    for (i in gs) {
        if (gs[i].indexOf(';@') == 0) {
            var dd = gs[i].substr(2).split(":");
            sty[dd[0]] = dd[1];
        }
        if ((gs[i]) && (gs[i][0] != ';')) {
            ws = gs[i].split(" ");
            wd['g'] = -1;
            hasxy = 0;
            for (j in ws) {
                if (ws[j]) {
                    cr = ws[j][0].toLowerCase();
                    if (cr == 'x' || cr == 'y') hasxy = 1;
                    wd[cr] = parseFloat(ws[j].substr(1));
                }
            }
            if (hasxy) {
                xy = mround(wd['x'] * scale - xmin) + " " + mround(-wd['y'] * scale - ymin);
                if (wd['g'] == 0) {
                    sc++;
                    if (sc > 1) {
                        t1 += " ";
                    }
                    sty.num = gcstyle.length;
                    gcstyle.push(sty);
                    sty = {
                        "fill": "#000000",
                        "stroke": "#000000",
                        "stroke-width": 0,
                        "deep": undefined,
                        "repeat": undefined
                    };
                    t1 += "M" + xy;
                    c = 0;
                }
                if (wd['g'] == 1) {
                    c++;
                    if (c == 1) t1 += " L";
                    t1 += " " + xy;
                }
            }
        }
    }
    t1 += '" stroke="none" fill="black" fill-rule="evenodd"/></svg>';
    return t1;
}

// ============================================================
// GEOMETRY UTILITIES
// ============================================================

function isInside(x, y, path, idx = 0) {
    inside = 0;
    j = path.length - 1;
    for (i in path) {
        xi = path[i][0 + idx];
        yi = path[i][1 + idx];
        xj = path[j][0 + idx];
        yj = path[j][1 + idx];

        intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
        j = i;
    }
    return inside
}

function computeH(a, b, c, d) {
    const e = {
        x: b.x - a.x,
        y: b.y - a.y
    }
    const f = {
        x: d.x - c.x,
        y: d.y - c.y
    }
    const p = {
        x: -e.y,
        y: e.x
    }

    const intersection = f.x * p.x + f.y * p.y;
    if (intersection === 0) {
        return NaN;
    }
    return ((a.x - c.x) * p.x + (a.y - c.y) * p.y) / intersection;
}

function intersect_point(a, b, c, d) {
    const h1 = computeH(a, b, c, d);
    const h2 = computeH(c, d, a, b);
    const isParallel = isNaN(h1) || isNaN(h2);
    if (!isParallel & h1 >= 0 && h1 <= 1 && h2 >= 0 && h2 <= 1) {
        return h1;
    }
    return null;
}

// ============================================================
// MATERIAL MANAGEMENT
// ============================================================

function loadMaterials() {
    let materials = localStorage.getItem('materials');
    if (!materials) {
        // Default materials
        materials = [
            { "name": "Laser Akrilik 1.5mm", "value": "10,1,30,2000" },
            { "name": "Laser Akrilik 2mm", "value": "8,1,32,2000" },
            { "name": "Laser Akrilik 2mm Warna", "value": "8,1,37,2000" },
            { "name": "Laser Akrilik 3mm", "value": "6,1,42,2000" },
            { "name": "Laser Akrilik 3mm Warna", "value": "6,1,47,2000" },
            { "name": "Laser Akrilik 4mm", "value": "4,1,52,2000" },
            { "name": "Laser Akrilik 4mm Warna", "value": "4,1,57,2000" },
            { "name": "Laser Akrilik 5mm", "value": "3,1,62,2000" },
            { "name": "Laser Akrilik 5mm Warna", "value": "3,1,67,2000" },
            { "name": "Laser Akrilik 6mm", "value": "2,1,72,2000" },
            { "name": "Laser Akrilik 6mm Warna", "value": "2,1,77,2000" },
            { "name": "Laser Triplek 3mm", "value": "8,1,5,2000" },
            { "name": "Laser Triplek 5mm", "value": "6,1,7,2000" },
            { "name": "Laser Triplek 9mm", "value": "6,2,11,2000" },
            { "name": "Laser Triplek 15mm", "value": "6,3,17,2000" },
            { "name": "MDF Hijau 3mm", "value": "6,1,7,2000" },
            { "name": "CNC MDF-H 6mm", "value": "30,3,9,2000,7" },
            { "name": "CNC MDF-H 9.5mm", "value": "30,4,12,2000,10" },
            { "name": "CNC ACP 3mm", "value": "20,1,22,2000,4.5" },
            { "name": "CNC ACP 4mm", "value": "25,2,29,2000,6" },
            { "name": "CNC PVC 5mm", "value": "40,1,25,2000,6" },
            { "name": "CNC PVC 9mm", "value": "40,2,35,2000,10" }
        ];
        localStorage.setItem('materials', JSON.stringify(materials));
    } else {
        materials = JSON.parse(materials);
    }
    return materials;
}

function saveMaterials(materials) {
    localStorage.setItem('materials', JSON.stringify(materials));
}

function populateMaterialSelect() {
    let materials = loadMaterials();
    let select = $('material');
    select.innerHTML = '';
    materials.forEach(mat => {
        let option = document.createElement('option');
        option.value = mat.value;
        option.textContent = mat.name;
        select.appendChild(option);
    });
}

function editMaterials() {
    let materials = loadMaterials();
    let text = materials.map(mat => mat.name + ',' + mat.value).join('\n');
    $('materialEditor').value = text;
    $('materialEditorTable').style.display = 'block';
}

function saveEditedMaterials() {
    let text = $('materialEditor').value;
    let lines = text.split('\n').filter(line => line.trim());
    let materials = [];
    lines.forEach(line => {
        let parts = line.split(',');
        if (parts.length >= 5) {
            let name = parts[0].trim();
            let value = parts.slice(1).join(',').trim();
            materials.push({ name: name, value: value });
        }
    });
    saveMaterials(materials);
    populateMaterialSelect();
}

// Material editor event listeners
setclick('btEditMaterials', editMaterials);
setclick('btSaveMaterials', function () {
    saveEditedMaterials();
    $('materialEditorTable').style.display = 'none';
});
setclick('btCancelMaterials', function () {
    $('materialEditorTable').style.display = 'none';
});

// Other utility buttons
setclick('btOpenDevTools', async function () {
    await window.invoke('open_devtools');
    $('vars2').style.display = 'none';
    hidd2 = !hidd2;
});

setclick('btOpenNestJSV2', function () {
    $('overlayNestJS').style.display = 'block';
    $('nestjsFrame').src = 'http://localhost:3000/v2/';
    $('vars2').style.display = 'none';
    hidd2 = !hidd2;
});

setclick('btOpenInvoice', async function () {
    try {
        await window.invoke('open_invoice');
    } catch (e) {
        console.error('Failed to open invoice generator', e);
    }
    $('vars2').style.display = 'none';
    hidd2 = !hidd2;
});

setclick('btCloseNestJS', function () {
    $('overlayNestJS').style.display = 'none';
    $('nestjsFrame').src = 'about:blank';
});

// Screenshot functionality with keyboard shortcut Ctrl+Alt+P
document.addEventListener('keydown', async function (e) {
    // Check for Ctrl+Alt+P
    if (e.ctrlKey && e.altKey && e.key === 'p') {
        e.preventDefault();
        await captureScreenshot();
    }
});

async function captureScreenshot() {
    try {
        console.log('Capturing screenshot...');

        // Call backend to capture entire screen
        const dataUrl = await window.invoke('capture_screenshot');

        // Create download link
        const filename = 'screenshot_' + new Date().toISOString().replace(/[:.]/g, '-') + '.png';
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        console.log('Screenshot download started: ' + filename);
        // Show temporary notification
        showNotification('Screenshot captured: ' + filename);
    } catch (error) {
        console.error('Screenshot failed:', error);
        alert('Failed to capture screenshot: ' + error.message);
    }
}

function showNotification(message) {
    const notif = document.createElement('div');
    notif.style.cssText = 'position:fixed;top:20px;right:20px;background:#4CAF50;color:white;padding:15px 20px;border-radius:5px;z-index:10000;font-family:Arial,sans-serif;box-shadow:0 2px 5px rgba(0,0,0,0.3);';
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

// ============================================================
// G-CODE SIMULATOR (Integrated into main canvas view)
// ============================================================

var simState = {
    running: false, speed: 10, curTime: 0, totalTime: 0,
    lastFrame: 0, moves: [], pathSegments: [], activeSeg: null,
    pos: { x: 0, y: 0, z: 0, v: 0 }
};
var simRA = null;

// ============================================================
// G-CODE SIMULATOR (standalone canvas, own coordinate system)
// ============================================================

var simCvs, simCtx;
var simZ = 1, simOX = 0, simOY = 0;
var simRA = null;
var simDrag = false, simMX = 0, simMY = 0;
var simState = {
    running: false, speed: 10, curTime: 0, totalTime: 0,
    lastFrame: 0, moves: [], pathSegments: [], activeSeg: null,
    pos: { x: 0, y: 0, z: 0, v: 0 }, bounds: null
};

function simGetGCode() {
    if (getchecked("engravecut"))
        return startgcode + "\n" + getvalue("engcode") + "\n" + getvalue("gcode") + "\n" + finishgcode;
    return startgcode + "\n" + getvalue("gcode") + "\n" + getvalue("engcode") + "\n" + finishgcode;
}

function simFormatTime(s) {
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
}

function simUpdateDisplay() {
    var pct = simState.totalTime > 0 ? simState.curTime / simState.totalTime : 0;
    document.getElementById('simProgress').value = Math.round(pct * 1000);
    document.getElementById('simTimeDisplay').textContent = simFormatTime(simState.curTime) + ' / ' + simFormatTime(simState.totalTime);
}

function simToScr(x, y, z) {
    if (gcodeViewMode === 'isometric') {
        var ix = (x - y) * ISO_COS;
        var iy = (x + y) * ISO_SIN - (z || 0);
        return { x: ix * simZ + simOX, y: iy * simZ + simOY };
    }
    return { x: x * simZ + simOX, y: y * simZ + simOY };
}

function simResize() {
    if (!simCvs) return;
    var parent = simCvs.parentElement;
    if (!parent) return;
    var r = parent.getBoundingClientRect();
    simCvs.width = r.width;
    simCvs.height = r.height;
}

function simProjectBounds(moves) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    if (gcodeViewMode === 'isometric') {
        for (var i = 0; i < moves.length; i++) {
            var m = moves[i];
            var s = { x: (m.startX - m.startY) * ISO_COS, y: (m.startX + m.startY) * ISO_SIN - m.startZ };
            var e = { x: (m.endX - m.endY) * ISO_COS, y: (m.endX + m.endY) * ISO_SIN - m.endZ };
            minX = Math.min(minX, s.x, e.x); maxX = Math.max(maxX, s.x, e.x);
            minY = Math.min(minY, s.y, e.y); maxY = Math.max(maxY, s.y, e.y);
        }
    } else {
        for (var i = 0; i < moves.length; i++) {
            var m = moves[i];
            minX = Math.min(minX, m.startX, m.endX);
            maxX = Math.max(maxX, m.startX, m.endX);
            minY = Math.min(minY, m.startY, m.endY);
            maxY = Math.max(maxY, m.startY, m.endY);
        }
    }
    return { minX: minX || 0, maxX: maxX || 1, minY: minY || 0, maxY: maxY || 1 };
}

function simCenter(moves) {
    if (moves.length === 0) return;
    var b = simProjectBounds(moves);
    // Recalc world bounds for grid use
    var wMinX = Infinity, wMaxX = -Infinity, wMinY = Infinity, wMaxY = -Infinity;
    for (var i = 0; i < moves.length; i++) {
        var m = moves[i];
        wMinX = Math.min(wMinX, m.startX, m.endX); wMaxX = Math.max(wMaxX, m.startX, m.endX);
        wMinY = Math.min(wMinY, m.startY, m.endY); wMaxY = Math.max(wMaxY, m.startY, m.endY);
    }
    simState.worldBounds = { minX: wMinX || 0, maxX: wMaxX || 1, minY: wMinY || 0, maxY: wMaxY || 1 };
    var gw = (b.maxX - b.minX) || 1, gh = (b.maxY - b.minY) || 1;
    var sx = simCvs.width * 0.5 / gw, sy = simCvs.height * 0.5 / gh;
    simZ = Math.min(sx, sy) * 0.85;
    var cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    simOX = simCvs.width / 2 - cx * simZ;
    simOY = simCvs.height / 2 - cy * simZ;
    simState.bounds = b;
}

function simDraw() {
    if (!simCtx || simState.moves.length === 0) return;
    var ctx = simCtx;
    var isDark = getchecked("isdarktheme");
    var bg = isDark ? '#0a0a0a' : '#f5f5f5';
    var grid1 = isDark ? '#1a1a1a' : '#ddd';
    var grid5 = isDark ? '#3a3a3a' : '#ccc';
    var g1Color = isDark ? '#ff4444' : '#cc3333';
    var g0Color = isDark ? '#555' : '#999';
    var traveledColor = isDark ? '#2ecc71' : '#27ae60';
    var cutterFill = isDark ? '#ff9800' : '#e65100';
    var originColor = '#ff6b6b';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, simCvs.width, simCvs.height);

    // Grid (at Z=0)
    if (simState.worldBounds) {
        var wb = simState.worldBounds;
        var sx = Math.floor(wb.minX / 10) * 10;
        var ex = Math.ceil(wb.maxX / 10) * 10;
        var sy = Math.floor(wb.minY / 10) * 10;
        var ey = Math.ceil(wb.maxY / 10) * 10;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (var x = sx; x <= ex; x += 10) {
            ctx.strokeStyle = x % 50 === 0 ? grid5 : grid1;
            var p1 = simToScr(x, wb.minY, 0);
            var p2 = simToScr(x, wb.maxY, 0);
            ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        }
        for (var y = sy; y <= ey; y += 10) {
            ctx.strokeStyle = y % 50 === 0 ? grid5 : grid1;
            var p1 = simToScr(wb.minX, y, 0);
            var p2 = simToScr(wb.maxX, y, 0);
            ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        }
        ctx.stroke();
    }

    // Paths: completed = green solid, future = dashed transparent
    if (simState.activeSeg && simState.pathSegments.length > 0) {
        var segIdx = simState.pathSegments.indexOf(simState.activeSeg);
        if (segIdx >= 0) {
            // Future segments (transparent dashed)
            ctx.beginPath();
            var hasFuture = false;
            for (var i = segIdx; i < simState.pathSegments.length; i++) {
                var seg = simState.pathSegments[i];
                var p1 = simToScr(seg.x1, seg.y1, seg.z1);
                var p2 = simToScr(seg.x2, seg.y2, seg.z2);
                if (i === segIdx) ctx.moveTo(p1.x, p1.y);
                else ctx.lineTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                hasFuture = true;
            }
            if (hasFuture) {
                ctx.globalAlpha = 0.35;
                ctx.setLineDash([4, 4]);
                ctx.strokeStyle = g1Color;
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.globalAlpha = 1;
                ctx.setLineDash([]);
            }

            // Completed segments (green solid)
            ctx.beginPath();
            var hasCompleted = false;
            for (var i = 0; i < segIdx; i++) {
                var seg = simState.pathSegments[i];
                var p1 = simToScr(seg.x1, seg.y1, seg.z1);
                var p2 = simToScr(seg.x2, seg.y2, seg.z2);
                if (i === 0) ctx.moveTo(p1.x, p1.y);
                else ctx.lineTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                hasCompleted = true;
            }
            if (hasCompleted) {
                ctx.strokeStyle = traveledColor;
                ctx.lineWidth = 3;
                ctx.stroke();
            }
        }
    } else {
        // No simulation active — draw all moves in original style
        ctx.setLineDash([]);
        for (var i = 0; i < simState.moves.length; i++) {
            var m = simState.moves[i];
            var s = simToScr(m.startX, m.startY, m.startZ);
            var e = simToScr(m.endX, m.endY, m.endZ);
            ctx.beginPath();
            ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y);
            if (m.type === 'G1') {
                ctx.strokeStyle = g1Color;
                ctx.lineWidth = 1.5;
            } else {
                ctx.strokeStyle = g0Color;
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 3]);
            }
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    // Cutter
    var cp = simToScr(simState.pos.x, simState.pos.y, simState.pos.z);
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = cutterFill;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Origin
    var o = simToScr(0, 0, 0);
    ctx.strokeStyle = originColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(o.x - 10, o.y); ctx.lineTo(o.x + 10, o.y);
    ctx.moveTo(o.x, o.y - 10); ctx.lineTo(o.x, o.y + 10);
    ctx.stroke();
    ctx.fillStyle = originColor;
    ctx.font = '11px sans-serif';
    ctx.fillText('(0,0)', o.x + 12, o.y + 4);
}

function simUpdatePos() {
    if (simState.pathSegments.length === 0) return;
    var acc = 0;
    simState.activeSeg = null;
    for (var i = 0; i < simState.pathSegments.length; i++) {
        var seg = simState.pathSegments[i];
        var dur = seg.duration || 0.001;
        if (simState.curTime <= acc + dur) {
            var t = Math.min((simState.curTime - acc) / dur, 1);
            simState.pos = {
                x: seg.x1 + (seg.x2 - seg.x1) * t,
                y: seg.y1 + (seg.y2 - seg.y1) * t,
                z: seg.z1 + (seg.z2 - seg.z1) * t,
                v: seg.v1 + (seg.v2 - seg.v1) * t
            };
            simState.activeSeg = seg;
            return;
        }
        acc += dur;
    }
    if (simState.curTime >= simState.totalTime && simState.totalTime > 0) {
        simState.running = false;
        document.getElementById('btnSimPlay').textContent = '▶ Play';
    }
}

function simRun() {
    if (!simState.running) return;
    var now = performance.now();
    var dt = (now - simState.lastFrame) / 1000;
    simState.lastFrame = now;
    simState.curTime += dt * simState.speed;
    if (simState.curTime > simState.totalTime) simState.curTime = simState.totalTime;
    simUpdatePos();
    simUpdateDisplay();
    simDraw();
    if (simState.curTime < simState.totalTime) simRA = requestAnimationFrame(simRun);
    else { simState.running = false; document.getElementById('btnSimPlay').textContent = '▶ Play'; }
}

function simToggle() {
    if (simState.moves.length === 0) return;
    simState.running = !simState.running;
    if (simState.running) {
        if (simState.curTime >= simState.totalTime) simState.curTime = 0;
        document.getElementById('btnSimPlay').textContent = '⏸ Pause';
        simState.lastFrame = performance.now();
        simUpdatePos();
        simRA = requestAnimationFrame(simRun);
    } else {
        document.getElementById('btnSimPlay').textContent = '▶ Play';
    }
}

function simReset() {
    simState.running = false;
    if (simRA) { cancelAnimationFrame(simRA); simRA = null; }
    simState.curTime = 0;
    simState.pos = { x: 0, y: 0, z: 0, v: 0 };
    simState.activeSeg = null;
    document.getElementById('btnSimPlay').textContent = '▶ Play';
    simUpdateDisplay();
    simDraw();
}

function simSeek(ratio) {
    if (simState.moves.length === 0) return;
    simState.curTime = Math.max(0, Math.min(ratio * simState.totalTime, simState.totalTime));
    simUpdatePos();
    simUpdateDisplay();
    simDraw();
}

function simUpdateSpeed() {
    simState.speed = parseInt(document.getElementById('simSpeedSelect').value) || 10;
}

function simActivate() {
    simCvs = document.getElementById('simCanvas');
    if (!simCvs) return;
    simCtx = simCvs.getContext('2d');
    simResize();
    simZ = 1; simOX = 0; simOY = 0;
    simState.running = false; simState.curTime = 0;
    simState.pos = { x: 0, y: 0, z: 0, v: 0 };
    simState.activeSeg = null;
    document.getElementById('btnSimPlay').textContent = '▶ Play';

    var gcode = simGetGCode();
    simState.moves = parseGCodeText(gcode);
    simState.pathSegments = [];
    simState.totalTime = 0;

    try {
        CncPlanner.init(defaultConfig);
        var r = CncPlanner.calculateJobTime(gcode, defaultConfig);
        simState.pathSegments = r.pathSegments || [];
        simState.totalTime = r.seconds;
    } catch (e) { }

    simCenter(simState.moves);
    simUpdateDisplay();
    document.getElementById('simControls').style.display = 'flex';
    document.getElementById('simCanvas').style.display = 'block';
    document.getElementById('myCanvas1x').style.display = 'none';
    simDraw();
}

function simDeactivate() {
    simState.running = false;
    if (simRA) { cancelAnimationFrame(simRA); simRA = null; }
    document.getElementById('simControls').style.display = 'none';
    var simEl = document.getElementById('simCanvas');
    var infEl = document.getElementById('myCanvas1x');
    if (simEl) simEl.style.display = 'none';
    if (infEl) infEl.style.display = 'block';
}

// Sim canvas mouse handlers (own coordinate system)
document.addEventListener('mousedown', function (e) {
    if (e.target !== simCvs) return;
    simDrag = true; simMX = e.clientX; simMY = e.clientY;
    simCvs.style.cursor = 'grabbing';
});

document.addEventListener('mousemove', function (e) {
    if (!simDrag) return;
    simOX += (e.clientX - simMX) / simZ;
    simOY += (e.clientY - simMY) / simZ;
    simMX = e.clientX; simMY = e.clientY;
    simDraw();
});

document.addEventListener('mouseup', function () {
    if (!simDrag) return;
    simDrag = false;
    if (simCvs) simCvs.style.cursor = 'grab';
});

document.addEventListener('wheel', function (e) {
    if (e.target !== simCvs) return;
    e.preventDefault();
    var rect = simCvs.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var nz = simZ * (e.deltaY > 0 ? 0.9 : 1.1);
    simOX = mx - (mx - simOX) * (nz / simZ);
    simOY = my - (my - simOY) * (nz / simZ);
    simZ = nz;
    simDraw();
}, { passive: false });

document.addEventListener('touchstart', function (e) {
    if (e.target !== simCvs) return;
    if (e.touches.length === 1) {
        simDrag = true; simMX = e.touches[0].clientX; simMY = e.touches[0].clientY;
    }
});

document.addEventListener('touchmove', function (e) {
    if (e.target !== simCvs) return;
    e.preventDefault();
    if (e.touches.length === 1 && simDrag) {
        simOX += (e.touches[0].clientX - simMX) / simZ;
        simOY += (e.touches[0].clientY - simMY) / simZ;
        simMX = e.touches[0].clientX; simMY = e.touches[0].clientY;
        simDraw();
    }
}, { passive: false });

document.addEventListener('touchend', function () { simDrag = false; });

window.addEventListener('resize', function () {
    if (currentViewMode === 'simulator' && simCvs) {
        simResize();
        simDraw();
    }
});
