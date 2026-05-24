// CNC Planner Library - Highly Optimized version
const CncPlanner = (function () {
    const NUMBUFFER = 32, TICK_MICROS = 20;

    const fmax = (a, b) => a < b ? b : a;
    const fmin = (a, b) => a > b ? b : a;
    const nextbuff = x => (x + 1) & (NUMBUFFER - 1);
    const prevbuff = x => (x - 1) & (NUMBUFFER - 1);
    const sqr = x => x * x;

    // Optimized global Regex (case insensitive, finds G, M, X, Y, Z, F, S and their values)
    const gcodeRegex = /([GMXYZFS])(-?\d+\.?\d*)/gi;

    let cfg, motionCfg, axisCfg = [], moves = [], head = 0, tail = 0;
    let cx1 = 0, cy1 = 0, cz1 = 0, mmdis = [0, 0, 0];
    let curru = [0, 0, 0], prevu = [0, 0, 0];
    let CPUTIME = 0, SEGMENTTIME = 0, totalTimeUs = 0, gcodeLines = [], lineIndex = 0;

    function initPlanner(config) {
        cfg = {
            X: { vel: 200, acc: 1000, stepsPerMm: 100, shaperType: 0, backlash: 0, ...(config.X || {}) },
            Y: { vel: 60, acc: 200, stepsPerMm: 190, shaperType: 0, backlash: 0, ...(config.Y || {}) },
            Z: { vel: 50, acc: 500, stepsPerMm: 80, shaperType: 0, backlash: 0, ...(config.Z || {}) }
        };
        motionCfg = { junctionDev: 0.05, minPlannerSpeed: 0, cancelOutReducer: true, ...(config.motion || {}) };

        axisCfg = [cfg.X, cfg.Y, cfg.Z]; // Cache this to prevent array allocation on every move

        moves = Array(NUMBUFFER).fill().map(() => ({
            dis: 0, ac: 0, delta: 0, maxs: 0, fs: 0, fn: 0, dx: [0, 0, 0], status: 0,
            vi: 0, vc: 0, ve: 0, s2: 0, s4: 0, s6: 0, totalstep: 0, timeUs: 0
        }));

        head = tail = cx1 = cy1 = cz1 = 0;
        CPUTIME = SEGMENTTIME = totalTimeUs = lineIndex = 0;
        gcodeLines = [];
    }

    const buffull = () => nextbuff(head) === tail;
    const bufflength = () => (head - tail + NUMBUFFER) & (NUMBUFFER - 1);

    function addmove(cf, cx2, cy2, cz2, toolPower, g0, rel) {
        if (cx2 == null) cx2 = cx1;
        if (cy2 == null) cy2 = cy1;
        if (cz2 == null) cz2 = cz1;
        if (rel) { cx2 += cx1; cy2 += cy1; cz2 += cz1; }

        mmdis[0] = cx2 - cx1;
        mmdis[1] = cy2 - cy1;
        mmdis[2] = cz2 - cz1;

        const total_dis = Math.sqrt(sqr(mmdis[0]) + sqr(mmdis[1]) + sqr(mmdis[2]));
        if (total_dis < 0.0001) return;

        const curr = moves[nextbuff(head)];
        let dd = 0, faxis = 0;

        // Calculate deltas using the cached axis configs
        curr.dx[0] = Math.round(cx2 * axisCfg[0].stepsPerMm) - Math.round(cx1 * axisCfg[0].stepsPerMm);
        curr.dx[1] = Math.round(cy2 * axisCfg[1].stepsPerMm) - Math.round(cy1 * axisCfg[1].stepsPerMm);
        curr.dx[2] = Math.round(cz2 * axisCfg[2].stepsPerMm) - Math.round(cz1 * axisCfg[2].stepsPerMm);

        for (let i = 0; i < 3; i++) {
            let absDx = Math.abs(curr.dx[i]);
            if (absDx > dd) {
                dd = absDx; faxis = i;
            }
        }

        if (dd > 0) {
            curr.dis = total_dis;
            curr.status = (g0 ? 8 : 0) | (faxis << 4);
            curr.fn = cf;
            curr.fs = 0;
            planner(nextbuff(head));
            head = nextbuff(head);
            // Direct assignment avoids array destructuring allocation
            cx1 = cx2; cy1 = cy2; cz1 = cz2;
        }
    }

    function planner(h) {
        const pcurr = moves[h];
        // Fast copy array
        prevu[0] = curru[0]; prevu[1] = curru[1]; prevu[2] = curru[2];
        let ac = 10000, fn = pcurr.fn;

        const rcDis = 1 / pcurr.dis;

        for (let i = 0; i < 3; i++) {
            curru[i] = 0;
            if (pcurr.dx[i] !== 0) {
                curru[i] = mmdis[i] * rcDis;
                ac = fmin(ac, Math.abs(axisCfg[i].acc / curru[i]));
                fn = fmin(fn, Math.abs(axisCfg[i].vel / curru[i]));
            }
        }

        pcurr.ac = ac << 1;
        pcurr.delta = Math.floor(pcurr.ac * pcurr.dis);
        pcurr.fn = sqr(fn);
        pcurr.maxs = motionCfg.minPlannerSpeed;

        if (bufflength() > 1) {
            const junc_cos = -prevu[0] * curru[0] - prevu[1] * curru[1] - prevu[2] * curru[2];
            pcurr.maxs = pcurr.fn;
            if (junc_cos < 0.995 && junc_cos > -0.995) {
                const sin_theta_d2 = 0.5 * (1 - junc_cos);
                pcurr.maxs = fmin(pcurr.maxs, (motionCfg.junctionDev * sin_theta_d2) / (1 - Math.sqrt(sin_theta_d2)) * pcurr.ac);
            }
        }
        backforward();
    }

    function backforward() {
        let h = head;
        let fes = motionCfg.minPlannerSpeed;
        while (h !== tail) {
            const newFs = fmin(fes + moves[h].delta, moves[h].maxs);
            moves[h].fs = newFs;
            fes = newFs;
            h = prevbuff(h);
        }

        h = tail;
        let fesForward = 0;
        while (h !== head) {
            const p = h;
            h = nextbuff(h);
            fesForward = moves[p].fs + moves[p].delta;
            moves[h].fs = fmin(moves[h].fs, fesForward);
        }
    }

    function startmove() {
        if (tail === head) return;
        let t = nextbuff(tail);
        prepareramp(t);
        const segTime = calculateSegmentTimeUs(tail);
        totalTimeUs += segTime;
        SEGMENTTIME = segTime;
        CPUTIME = 0;
        tail = t;
    }

    function prepareramp(t) {
        const m = moves[t], next = t !== head ? moves[nextbuff(t)] : null;
        let vi_sq = m.fs, ve_sq = next ? next.fs : 0;
        let vc_sq = fmin(m.fn, vi_sq + (ve_sq - vi_sq + m.delta) / 2);

        let totalstep = Math.max(1, Math.abs(m.dx[(m.status >> 4) & 3]));
        let accel3 = Math.max(1, m.dis * m.ac);
        let inv_accel3 = 1 / accel3;

        m.vi = vi_sq; m.vc = vc_sq; m.ve = ve_sq;
        m.s2 = Math.max(0, totalstep * (vc_sq - vi_sq) * inv_accel3);
        m.s6 = Math.max(0, totalstep * (vc_sq - ve_sq) * inv_accel3);
        m.s4 = Math.max(0, totalstep - (m.s2 + m.s6));
        m.totalstep = totalstep;
    }

    function calculateSegmentTimeUs(t) {
        const m = moves[t];
        if (m.dis <= 0) return 0;

        const vi = Math.sqrt(m.vi), vc = Math.sqrt(m.vc), ve = Math.sqrt(m.ve);
        const accel = m.ac / 2;
        let timeSec = 0;

        if (m.s2 > 0 && vc > vi) timeSec += (vc - vi) / accel;
        if (m.s4 > 0 && vc > 0) timeSec += (m.s4 * m.dis / m.totalstep) / vc;
        if (m.s6 > 0 && vc > ve) timeSec += (vc - ve) / accel;

        return (timeSec * 1000000) - (m.totalstep * TICK_MICROS);
    }

    function parseGCodeLine(line) {
        if (!line || line[0] === ';') return null;

        const cmd = { type: null, x: null, y: null, z: null, f: null, s: null, isG0: false, isG1: false, isG92: false, rel: undefined };
        let hasData = false;

        gcodeRegex.lastIndex = 0; // Reset regex
        let match;

        while ((match = gcodeRegex.exec(line)) !== null) {
            hasData = true;
            const letter = match[1].toUpperCase();
            const val = parseFloat(match[2]);

            if (letter === 'X') cmd.x = val;
            else if (letter === 'Y') cmd.y = val;
            else if (letter === 'Z') cmd.z = val;
            else if (letter === 'F') cmd.f = val / 60;
            else if (letter === 'S') cmd.s = val;
            else if (letter === 'G') {
                if (val === 0) { cmd.type = 'G0'; cmd.isG0 = true; }
                else if (val === 1) { cmd.type = 'G1'; cmd.isG1 = true; }
                else if (val === 90) cmd.rel = false;
                else if (val === 91) cmd.rel = true;
                else if (val === 92) { cmd.type = 'G92'; cmd.isG92 = true; }
                else if (val === 28) cmd.type = 'G28';
            }
            else if (letter === 'M') {
                if (val === 3) cmd.type = 'M3';
                else if (val === 5) cmd.type = 'M5';
                else if (val === 2 || val === 30) cmd.type = 'END';
            }
        }

        return hasData ? cmd : null;
    }

    function processGCodeLine(line, state) {
        const cmd = parseGCodeLine(line);
        if (!cmd || cmd.type === 'G28' || cmd.type === 'END') {
            if (cmd?.type === 'G28') {
                initPlanner(cfg);
                state.g92Offset.x = 0; state.g92Offset.y = 0; state.g92Offset.z = 0;
                state.pos.x = 0; state.pos.y = 0; state.pos.z = 0;
            }
            return;
        }

        if (cmd.rel !== undefined) state.rel = cmd.rel;

        if (cmd.isG92) {
            if (cmd.x !== null) state.g92Offset.x = state.pos.x - cmd.x;
            if (cmd.y !== null) state.g92Offset.y = state.pos.y - cmd.y;
            if (cmd.z !== null) state.g92Offset.z = state.pos.z - cmd.z;
            return;
        }

        if (cmd.isG0 || cmd.isG1) {
            if (cmd.f > 0) {
                if (cmd.isG0) state.g0f = cmd.f;
                else state.g1f = cmd.f;
            }

            const adjustedX = cmd.x !== null ? cmd.x + state.g92Offset.x : null;
            const adjustedY = cmd.y !== null ? cmd.y + state.g92Offset.y : null;
            const adjustedZ = cmd.z !== null ? cmd.z + state.g92Offset.z : null;

            addmove(cmd.isG0 ? state.g0f : state.g1f, adjustedX, adjustedY, adjustedZ, cmd.isG1 ? 255 : 0, cmd.isG0 ? 1 : 0, state.rel);

            if (cmd.x !== null) state.pos.x = cmd.x;
            if (cmd.y !== null) state.pos.y = cmd.y;
            if (cmd.z !== null) state.pos.z = cmd.z;
        }
    }

    function calculateJobTime(gcodeText, config) {
        initPlanner(config);

        // Use a persistent state object instead of reallocating
        const state = {
            pos: { x: 0, y: 0, z: 0 },
            g0f: 2000 / 60,
            g1f: 2000 / 60,
            rel: false,
            g92Offset: { x: 0, y: 0, z: 0 }
        };

        gcodeLines = gcodeText.split('\n');
        lineIndex = 0;
        let parsingComplete = false;

        while (!(parsingComplete && head === tail)) {
            if (!buffull() && lineIndex < gcodeLines.length) {
                processGCodeLine(gcodeLines[lineIndex], state);
                lineIndex++;
                if (lineIndex >= gcodeLines.length) parsingComplete = true;
            }
            if (CPUTIME >= SEGMENTTIME) startmove();
            CPUTIME += Math.max(TICK_MICROS, SEGMENTTIME / 5);
            // if (totalTimeUs > 3600e6) break; // Break loop if it takes > 1 hr of computation limits (safety catch)
        }

        return {
            seconds: totalTimeUs / 1e6,
            formatted: formatTime(totalTimeUs / 1e6),
            segments: bufflength()
        };
    }

    function formatTime(sec) {
        if (sec < 60) return sec.toFixed(1) + 's';
        if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`;
        return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
    }

    return { init: initPlanner, calculateJobTime, formatTime };
})();

// Utilities stay exactly the same
const defaultConfig = { "motion": { "junctionDev": 0.5, "minPlannerSpeed": 0, "enableInputShaping": true, "cancelOutReducer": false }, "X": { "vel": 300, "acc": 2000, "stepsPerMm": -100, "freq": 55, "damp": 0.1, "shaperType": 2, "pinStep": 12, "pinDir": 14, "hasEndstop": 0, "backlash": 0 }, "Y": { "vel": 60, "acc": 100, "stepsPerMm": 255.579, "freq": 25, "damp": 0.1, "shaperType": 2, "pinStep": 0, "pinDir": 16, "hasEndstop": 0, "backlash": 0 }, "Z": { "vel": 5, "acc": 50, "stepsPerMm": 200, "freq": 0, "damp": 0, "shaperType": 0, "pinStep": 2, "pinDir": 13, "hasEndstop": 0, "backlash": 0 }, "tool": { "pinPwm": 15, "scale": 20, "mode": 1, "pwmMode": 0 }, "homing": { "pinEndstop": 16, "homingSpeed": 100, "homingPullback": 2 }, "system": { "broadcastPositionWhenJobRunning": false, "motorStepPulseWidth": 2, "testLaserPower": 255, "testLaserTime": 10 }, "cncInfo": { "name": "CNC Machine 1" } };

async function loadConfig2(url = '/config.json') {
    try {
        return await (await fetch(url)).json();
    } catch (e) {
        console.error('Failed to load config:', e);
        return defaultConfig;
    }
}

async function calculateGCodeTime(gcodeText) {
    return CncPlanner.calculateJobTime(gcodeText, await loadConfig2());
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