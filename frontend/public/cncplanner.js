// CNC Planner Library - Optimized version
const CncPlanner = (function () {
    const NUMBUFFER = 32, TICK_MICROS = 10;

    const fmax = (a, b) => a < b ? b : a;
    const fmin = (a, b) => a > b ? b : a;
    const nextbuff = x => (x + 1) & (NUMBUFFER - 1);
    const prevbuff = x => (x - 1) & (NUMBUFFER - 1);
    const sqr = x => x * x;

    let cfg, motionCfg, moves = [], head = 0, tail = 0;
    let cx1 = 0, cy1 = 0, cz1 = 0, mmdis = [0, 0, 0];
    let curru = [0, 0, 0], prevu = [0, 0, 0], lastMoveDir = [0, 0, 0];
    let CPUTIME = 0, SEGMENTTIME = 0, totalTimeUs = 0, gcodeLines = [], lineIndex = 0;
    let pathSegments = [];
    let lastLineIndex = 0;

    function initPlanner(config) {
        cfg = {
            X: { vel: 200, acc: 1000, stepsPerMm: 100, shaperType: 0, backlash: 0, ...(config.X || {}) },
            Y: { vel: 60, acc: 200, stepsPerMm: 190, shaperType: 0, backlash: 0, ...(config.Y || {}) },
            Z: { vel: 50, acc: 500, stepsPerMm: 80, shaperType: 0, backlash: 0, ...(config.Z || {}) }
        };
        motionCfg = { junctionDev: 0.05, minPlannerSpeed: 0, cancelOutReducer: true, ...(config.motion || {}) };

        moves = Array(NUMBUFFER).fill().map(() => ({
            dis: 0, ac: 0, delta: 0, maxs: 0, fs: 0, fn: 0, dx: [0, 0, 0], status: 0,
            toolPower: 0, vi: 0, vc: 0, ve: 0, s2: 0, s4: 0, s6: 0, totalstep: 0, timeUs: 0,
            lineIdx: 0, startX: 0, startY: 0, startZ: 0, feed: 0, deltaX: 0, deltaY: 0, deltaZ: 0
        }));
        head = tail = cx1 = cy1 = cz1 = 0;
        lastMoveDir = [0, 0, 0];
        CPUTIME = SEGMENTTIME = totalTimeUs = lineIndex = 0;
        gcodeLines = [];
        pathSegments = [];
        lastLineIndex = 0;
    }

    const buffull = () => nextbuff(head) === tail;
    const bufflength = () => (head - tail + NUMBUFFER) & (NUMBUFFER - 1);

    function addmove(cf, cx2, cy2, cz2, toolPower, g0, rel) {
        if (cx2 == null) cx2 = cx1;
        if (cy2 == null) cy2 = cy1;
        if (cz2 == null) cz2 = cz1;
        if (rel) { cx2 += cx1; cy2 += cy1; cz2 += cz1; }

        mmdis[0] = cx2 - cx1; mmdis[1] = cy2 - cy1; mmdis[2] = cz2 - cz1;
        const total_dis = Math.sqrt(sqr(mmdis[0]) + sqr(mmdis[1]) + sqr(mmdis[2]));
        if (total_dis < 0.0001) return;
        const axisCfg = [cfg.X, cfg.Y, cfg.Z];

        const dx = [Math.round(cx2 * axisCfg[0].stepsPerMm) - Math.round(cx1 * axisCfg[0].stepsPerMm),
        Math.round(cy2 * axisCfg[1].stepsPerMm) - Math.round(cy1 * axisCfg[1].stepsPerMm),
        Math.round(cz2 * axisCfg[2].stepsPerMm) - Math.round(cz1 * axisCfg[2].stepsPerMm)];

        const curr = moves[nextbuff(head)];
        let dd = 0, faxis = 0;

        for (let i = 0; i < 3; i++) {
            const currentDir = Math.sign(mmdis[i]);

            curr.dx[i] = dx[i];

            if (Math.abs(curr.dx[i]) > dd) {
                dd = Math.abs(curr.dx[i]); faxis = i;
            }
        }

        if (dd > 0) {
            curr.dis = total_dis;
            curr.status = (g0 ? 8 : 0) | (faxis << 4);
            curr.toolPower = toolPower;
            curr.fn = cf;
            curr.fs = 0;
            curr.lineIdx = lastLineIndex;
            curr.startX = cx1;
            curr.startY = cy1;
            curr.startZ = cz1;
            curr.feed = cf;
            curr.deltaX = mmdis[0];
            curr.deltaY = mmdis[1];
            curr.deltaZ = mmdis[2];
            planner(nextbuff(head));
            head = nextbuff(head);
            [cx1, cy1, cz1] = [cx2, cy2, cz2];
        }
    }

    function planner(h) {
        const pcurr = moves[h];
        prevu = [...curru];
        let ac = 10000, fn = pcurr.fn;

        const rcDis = 1 / pcurr.dis;
        const axisCfg = [cfg.X, cfg.Y, cfg.Z];
        for (let i = 0; i < 3; i++) {
            curru[i] = 0;
            if (pcurr.dx[i] !== 0) {
                curru[i] = mmdis[i] * rcDis;
                ac = fmin(ac, Math.abs(axisCfg[i].acc / curru[i]));
                fn = fmin(fn, Math.abs(axisCfg[i].vel / curru[i]));
            }
        }

        pcurr.ac = ac << 1;
        pcurr.delta = (pcurr.ac * pcurr.dis);
        pcurr.fn = sqr(fn);
        pcurr.maxs = motionCfg.minPlannerSpeed;

        if (bufflength() > 1) {
            const junc_cos = -prevu[0] * curru[0] - prevu[1] * curru[1] - prevu[2] * curru[2];
            if (junc_cos < 0.999) {
                pcurr.maxs = pcurr.fn;
                if (junc_cos > -0.999) {
                    const sin_theta_d2 = Math.sqrt(0.5 * (1 - junc_cos));
                    pcurr.maxs = fmin(pcurr.maxs, (motionCfg.junctionDev * sin_theta_d2) / (1 - (sin_theta_d2)) * pcurr.ac);
                }
            }
        }
        backforward();
    }

    function backforward() {
        // --- Backward Pass ---
        let h = head;
        if (h === tail) return;

        let fes = motionCfg.minPlannerSpeed;
        let backward_stop = tail;

        while (true) {
            if (h === tail) break;

            const newFs = fmin(fes + moves[h].delta, moves[h].maxs);

            // OPTIMASI PLANNER O(1):
            if (newFs === moves[h].fs) {
                backward_stop = h;
                break;
            }

            moves[h].fs = newFs;
            fes = newFs;
            h = prevbuff(h);
        }

        // --- Forward Pass ---
        // HANYA iterasi dari blok terakhir yang disentuh oleh perubahan Backward Pass sampai ke node Head yang baru!
        h = backward_stop;
        let fesForward = 0;  // fes untuk forward pass
        while (h !== head) {
            const p = h;           // Simpan posisi sekarang
            h = nextbuff(h);       // Maju ke segmen berikutnya
            fesForward = moves[p].fs + moves[p].delta;  // ✅ Hitung dari segmen sebelumnya
            moves[h].fs = fmin(moves[h].fs, fesForward);
        }
    }

    function startmove() {
        if (tail === head) return;
        t = nextbuff(tail);
        prepareramp(t);
        SEGMENTTIME = calculateSegmentTimeUs(t);
        totalTimeUs += SEGMENTTIME;
        CPUTIME = 0;
        tail = t;
    }

    function prepareramp(t) {
        const m = moves[t], next = t != head ? moves[nextbuff(t)] : null;
        let vi_sq = m.fs, ve_sq = next ? next.fs : 0;
        let vc_sq = fmin(m.fn, vi_sq + (ve_sq - vi_sq + m.delta) / 2);

        let totalstep = Math.max(1, Math.abs(m.dx[(m.status >> 4) & 3]));
        let accel3 = Math.max(1, m.dis * m.ac);
        let inv_accel3 = 1 / accel3;

        [m.vi, m.vc, m.ve] = [vi_sq, vc_sq, ve_sq];
        m.s2 = Math.max(0, totalstep * (vc_sq - vi_sq) * inv_accel3);
        m.s6 = Math.max(0, totalstep * (vc_sq - ve_sq) * inv_accel3);
        m.s4 = Math.max(0, totalstep - (m.s2 + m.s6));
        m.totalstep = totalstep;

        const vi = Math.sqrt(vi_sq);
        const vc = Math.sqrt(vc_sq);
        const ve = Math.sqrt(ve_sq);
        const accel = m.ac / 2;

        const isG0 = (m.status & 8) !== 0;
        const x1 = m.startX, y1 = m.startY, z1 = m.startZ;
        const dx = m.deltaX, dy = m.deltaY, dz = m.deltaZ;

        const addSegment = (type, segStartStep, segEndStep, v1, v2) => {
            if (segEndStep <= segStartStep) return;
            const t1 = segStartStep / totalstep;
            const t2 = segEndStep / totalstep;

            const segX1 = x1 + dx * t1;
            const segY1 = y1 + dy * t1;
            const segZ1 = z1 + dz * t1;
            const segX2 = x1 + dx * t2;
            const segY2 = y1 + dy * t2;
            const segZ2 = z1 + dz * t2;

            let duration = 0;
            if (type === 'accel' && vc > vi) duration = (vc - vi) / accel;
            else if (type === 'cruise' && vc > 0) duration = (m.dis * (t2 - t1)) / vc;
            else if (type === 'decel' && vc > ve) duration = (vc - ve) / accel;

            const segment = {
                lineidx: m.lineIdx,
                x1: segX1, y1: segY1, z1: segZ1,
                x2: segX2, y2: segY2, z2: segZ2,
                F: m.feed * 60,
                S: m.toolPower,
                v1: v1,
                v2: v2,
                type: isG0 ? 'G0' : 'G1',
                duration: duration
            };
            pathSegments.push(segment);
        };

        if (m.s2 > 0) {
            addSegment('accel', 0, m.s2, vi, vc);
        }
        if (m.s4 > 0) {
            addSegment('cruise', m.s2, m.s2 + m.s4, vc, vc);
        }
        if (m.s6 > 0) {
            addSegment('decel', m.s2 + m.s4, totalstep, vc, ve);
        }
    }

    function calculateSegmentTimeUs(t) {
        const m = moves[t];
        if (m.dis <= 0) return 0;

        const [vi, vc, ve, fn] = [Math.sqrt(m.vi), Math.sqrt(m.vc), Math.sqrt(m.ve), Math.sqrt(m.fn)];
        const accel = m.ac / 2;
        let timeSec = 0;

        if (m.s2 > 0 && vc > vi) timeSec += (vc - vi) / accel;
        if (m.s4 > 0 && vc > 0) timeSec += (m.s4 * m.dis / m.totalstep) / vc;
        if (m.s6 > 0 && vc > ve) timeSec += (vc - ve) / accel;

        return timeSec * 1000000;
    }

    function parseGCodeLine(line) {
        line = line.trim().toUpperCase();
        if (!line || line[0] === ';') return null;

        const cmd = { type: null, x: null, y: null, z: null, f: null, s: null, isG0: false, isG1: false, rel: false };

        if (line.startsWith('G90')) cmd.rel = false;
        else if (line.startsWith('G91')) cmd.rel = true;
        else if (line.startsWith('G0')) { cmd.type = 'G0'; cmd.isG0 = true; }
        else if (line.startsWith('G1')) { cmd.type = 'G1'; cmd.isG1 = true; }
        else if (line.startsWith('G28')) { cmd.type = 'G28'; }
        else if (line.startsWith('M3') || line.startsWith('M03')) { cmd.type = 'M3'; }
        else if (line.startsWith('M5') || line.startsWith('M05')) { cmd.type = 'M5'; }
        else if (line.startsWith('M2') || line.startsWith('M30')) { cmd.type = 'END'; }

        const regex = /([XYZFS])(-?\d+\.?\d*)/g;
        let match;
        while ((match = regex.exec(line)) !== null) {
            const val = parseFloat(match[2]);
            if (match[1] === 'X') cmd.x = val;
            else if (match[1] === 'Y') cmd.y = val;
            else if (match[1] === 'Z') cmd.z = val;
            else if (match[1] === 'F') cmd.f = val / 60;
            else if (match[1] === 'S') cmd.s = val;
        }
        return cmd;
    }

    function processGCodeLine(line, state, lineIdx) {
        const cmd = parseGCodeLine(line);
        if (!cmd || cmd.type === 'G28' || cmd.type === 'END') {
            if (cmd?.type === 'G28') {
                initPlanner(cfg);
                return { ...state, pos: { x: 0, y: 0, z: 0 } };
            }
            return state;
        }

        if (cmd.rel !== undefined) state.rel = cmd.rel;

        if (cmd.isG0 || cmd.isG1) {
            if (cmd.f > 0) state[cmd.isG0 ? 'g0f' : 'g1f'] = cmd.f;
            lastLineIndex = lineIdx;
            addmove(state[cmd.isG0 ? 'g0f' : 'g1f'], cmd.x, cmd.y, cmd.z, cmd.isG1 ? 255 : 0, cmd.isG0 ? 1 : 0, state.rel);
            state.pos = { x: cmd.x, y: cmd.y, z: cmd.z };
        }
        return state;
    }

    function calculateJobTime(gcodeText, config) {
        initPlanner(config);
        let state = { pos: { x: 0, y: 0, z: 0 }, g0f: 2000 / 60, g1f: 2000 / 60, rel: false };
        gcodeLines = gcodeText.split('\n');
        lineIndex = 0;
        let parsingComplete = false;

        while (!(parsingComplete && head === tail)) {
            if (!buffull() && lineIndex < gcodeLines.length) {
                state = processGCodeLine(gcodeLines[lineIndex], state, lineIndex);
                lineIndex++;
                if (lineIndex >= gcodeLines.length) parsingComplete = true;
            }
            if (CPUTIME >= SEGMENTTIME) startmove();
            CPUTIME += Math.max(TICK_MICROS, SEGMENTTIME / 5);
            if (totalTimeUs > 3600e6) break;
        }

        return {
            seconds: totalTimeUs / 1e6,
            formatted: formatTime(totalTimeUs / 1e6),
            segments: bufflength(),
            pathSegments: pathSegments
        };
    }

    function formatTime(sec) {
        if (sec < 60) return sec.toFixed(1) + 's';
        if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`;
        return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
    }

    return { init: initPlanner, calculateJobTime, formatTime, getPathSegments: () => pathSegments };
})();

const defaultConfig = { "motion": { "junctionDev": 0.5, "minPlannerSpeed": 0, "enableInputShaping": true, "cancelOutReducer": false }, "X": { "vel": 300, "acc": 2000, "stepsPerMm": -100, "freq": 55, "damp": 0.1, "shaperType": 2, "pinStep": 12, "pinDir": 14, "hasEndstop": 0, "backlash": 0 }, "Y": { "vel": 60, "acc": 100, "stepsPerMm": 255.579, "freq": 25, "damp": 0.1, "shaperType": 2, "pinStep": 0, "pinDir": 16, "hasEndstop": 0, "backlash": 0 }, "Z": { "vel": 5, "acc": 50, "stepsPerMm": 200, "freq": 0, "damp": 0, "shaperType": 0, "pinStep": 2, "pinDir": 13, "hasEndstop": 0, "backlash": 0 }, "tool": { "pinPwm": 15, "scale": 20, "mode": 1, "pwmMode": 0 }, "homing": { "pinEndstop": 16, "homingSpeed": 100, "homingPullback": 2 }, "system": { "broadcastPositionWhenJobRunning": false, "motorStepPulseWidth": 2, "testLaserPower": 255, "testLaserTime": 10 }, "cncInfo": { "name": "CNC Machine 1" } };

async function loadConfig2(url = '/config.json') {
    try {
        return await (await fetch(url)).json();
    } catch (e) {
        console.error('Failed to load config:', e);
        return defaultConfig;
    }
}

async function calculateGCodeTimeWithConfig(gcodeText, config) {
    if (!config) return { seconds: 0, formatted: 'No config', segments: 0 };
    return CncPlanner.calculateJobTime(gcodeText, config);
}

async function loadFromURL(url, isJson = false) {
    try {
        const response = await fetch(url);
        return isJson ? await response.json() : await response.text();
    } catch (e) {
        console.error('Failed to load from', url, e);
        return null;
    }
}

const loadConfigFromURL = url => loadFromURL(url, true);
const loadGCodeFromURL = url => loadFromURL(url, false);
