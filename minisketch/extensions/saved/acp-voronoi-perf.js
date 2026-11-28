// saved by MiniSketch (server disk) — id: acp-voronoi-perf
// label: ACP Voronoi
(() => {
  'use strict';
  const NS = window.MiniSketchTools;
  const ID = 'acp-voronoi-perf';
  const el = (id) => document.getElementById(id);

  function rectPts(cx, cy, w, h) {
    const hw = w / 2, hh = h / 2;
    return [
      { x: cx - hw, y: cy - hh },
      { x: cx + hw, y: cy - hh },
      { x: cx + hw, y: cy + hh },
      { x: cx - hw, y: cy + hh }
    ];
  }

  function makeRng(seed) {
    let s = (Math.floor(Math.abs(seed)) || 1) % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function ensureCCW(pts) {
    let a = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      a += p.x * q.y - q.x * p.y;
    }
    return a < 0 ? pts.slice().reverse() : pts.slice();
  }

  function cleanRing(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = out[out.length - 1];
      if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-4) out.push({ x: p.x, y: p.y });
    }
    if (out.length > 2 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-4) {
      out.pop();
    }
    return out;
  }

  function buildHolePoly(cx, cy, d, shape) {
    const r = d / 2;
    const n = shape === 'hex' ? 6 : 28;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      pts.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
    }
    return pts;
  }

  function voronoiRidgeDist(x, y, seeds) {
    let d1 = Infinity, d2 = Infinity;
    let s1 = null, s2 = null;
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      const dx = x - s.x, dy = y - s.y;
      const d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1; s2 = s1;
        d1 = d; s1 = s;
      } else if (d < d2) {
        d2 = d; s2 = s;
      }
    }
    if (!s1 || !s2) return 0;
    const vx = s2.x - s1.x, vy = s2.y - s1.y;
    const len = Math.hypot(vx, vy);
    if (len < 1e-6) return 0;
    const mx = (s1.x + s2.x) * 0.5, my = (s1.y + s2.y) * 0.5;
    return Math.abs((x - mx) * (vx / len) + (y - my) * (vy / len));
  }

  function pointInRings(api, pt, rings) {
    let inside = false;
    for (let i = 0; i < rings.length; i++) {
      if (api.pointInPoly(pt, rings[i])) inside = !inside;
    }
    return inside;
  }

  function outerRingsOnly(api, rings) {
    const valid = rings.map(r => cleanRing(r)).filter(r => r.length >= 3);
    const outers = [];
    for (let i = 0; i < valid.length; i++) {
      const probe = valid[i][0];
      let depth = 0;
      for (let j = 0; j < valid.length; j++) {
        if (i !== j && api.pointInPoly(probe, valid[j])) depth++;
      }
      if (depth % 2 === 0) outers.push(ensureCCW(valid[i]));
    }
    return outers;
  }

  MiniSketchTools.register({
    id: ID,
    label: 'ACP Voronoi',
    title: 'ACP Perforated Voronoi Pattern',
    version: '1.0.0',
    author: 'AI Builder',
    category: 'Signage & Art',
    description: 'Panel perforasi ACP (bulat/hexagon) dengan ukuran modulasi jarak garis sel Voronoi.',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="1.5" width="13" height="13" rx="1"/><circle cx="5.2" cy="5.2" r="2.1"/><circle cx="11" cy="5.2" r="1.2"/><circle cx="5.2" cy="11" r="1.2"/><circle cx="10.8" cy="10.8" r="2.2"/></svg>',
    modalId: ID + '-modal',
    modal: `<div id="${ID}-modal" class="modal hidden">
      <div class="modal-box wide-cols">
        <h3>ACP Voronoi Perforation</h3>
        <div class="modal-cols">
          <div class="opt-col">
            <label class="opt">Width Area (mm) <input type="number" id="avp-w" value="1220" min="50" step="1"></label>
            <label class="opt">Height Area (mm) <input type="number" id="avp-h" value="2440" min="50" step="1"></label>
            <label class="opt">Outer Margin (mm) <input type="number" id="avp-margin" value="20" min="0" step="1"></label>
            <label class="opt">Bentuk Pola
              <select id="avp-shape">
                <option value="circle" selected>Bulat (Circle)</option>
                <option value="hex">Hexagon</option>
              </select>
            </label>
            <label class="opt">Ukuran Max Pola (mm) <input type="number" id="avp-dmax" value="50" min="2" step="0.5"></label>
            <label class="opt">Ukuran Min Pola (mm) <input type="number" id="avp-dmin" value="5" min="1" step="0.5"></label>
            <label class="opt">Jarak Min Antar Pola (mm) <input type="number" id="avp-gap" value="20" min="1" step="0.5"></label>
            <label class="opt">Tipe Grid
              <select id="avp-grid">
                <option value="stagger" selected>Staggered (Hex Grid)</option>
                <option value="square">Square Grid</option>
              </select>
            </label>
            <label class="opt">Jumlah Sel Voronoi <input type="number" id="avp-cells" value="18" min="2" max="300" step="1"></label>
            <label class="opt">Random Seed <input type="number" id="avp-seed" value="42" min="1" step="1"></label>
          </div>
          <div class="cnc-status" data-guide="main"></div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="${ID}-cancel">Cancel</button>
          <button class="btn primary" id="${ID}-ok">Generate</button>
        </div>
      </div>
    </div>`,
    guide: {
      en: { main: 'Generates through-cut (#000000) circular or hexagonal holes modulated by distance to random Voronoi cell edges. Uses selected shape as container or creates W×H outer frame. Clips cleanly inside outer margin without islands.' },
      id: { main: 'Membuat lubang cutting (#000000) bulat atau hexagon dengan ukuran bergradasi berdasarkan jarak ke garis sel Voronoi. Menggunakan objek terpilih sebagai wadah atau membuat frame W×H otomatis. Di-crop bersih pada batas outer margin tanpa pulau.' }
    },
    open(api, params) {
      if (params) {
        if (params.w != null) el('avp-w').value = params.w;
        if (params.h != null) el('avp-h').value = params.h;
        if (params.margin != null) el('avp-margin').value = params.margin;
        if (params.shape != null) el('avp-shape').value = params.shape;
        if (params.dmax != null) el('avp-dmax').value = params.dmax;
        if (params.dmin != null) el('avp-dmin').value = params.dmin;
        if (params.gap != null) el('avp-gap').value = params.gap;
        if (params.grid != null) el('avp-grid').value = params.grid;
        if (params.cells != null) el('avp-cells').value = params.cells;
        if (params.seed != null) el('avp-seed').value = params.seed;
      }
      const ok = el(ID + '-ok');
      if (ok) ok.focus();
    },
    apply(api) {
      const w = +el('avp-w').value;
      const h = +el('avp-h').value;
      const margin = +el('avp-margin').value;
      const shape = el('avp-shape').value === 'hex' ? 'hex' : 'circle';
      const dmax = +el('avp-dmax').value;
      const dmin = +el('avp-dmin').value;
      const gap = +el('avp-gap').value;
      const gridType = el('avp-grid').value === 'square' ? 'square' : 'stagger';
      const cells = Math.round(+el('avp-cells').value);
      const seed = Math.round(+el('avp-seed').value);

      if (!(w >= 50 && h >= 50)) { api.toast('Width & Height minimal 50 mm'); return; }
      if (!(margin >= 0)) { api.toast('Outer margin tidak valid'); return; }
      if (!(dmax > 0 && dmin > 0 && dmin <= dmax)) { api.toast('Ukuran Min harus <= Ukuran Max dan > 0'); return; }
      if (!(gap >= 0)) { api.toast('Jarak min antar pola tidak valid'); return; }
      if (!(cells >= 2 && cells <= 300)) { api.toast('Jumlah sel Voronoi harus 2 - 300'); return; }

      NS.close(ID);

      const selEnts = api.selectedEntities();
      const prev = selEnts.find(e => e.type === 'art' && e.gen && e.gen.kind === ID);
      const sb = api.selectionBounds();

      let containerRings = [];
      let drawFrame = false;

      if (prev) {
        let cx = null, cy = null;
        if (prev.pw && prev.ph && api.P(prev.pw) && api.P(prev.ph)) {
          const pw = api.P(prev.pw), ph = api.P(prev.ph);
          cx = (pw.x + ph.x) / 2;
          cy = (pw.y + ph.y) / 2;
        } else if (sb) {
          cx = (sb.minX + sb.maxX) / 2;
          cy = (sb.minY + sb.maxY) / 2;
        } else {
          const c = api.s2w(api.getW() / 2, api.getH() / 2);
          cx = c.x; cy = c.y;
        }
        containerRings = [ensureCCW(rectPts(cx, cy, w, h))];
        drawFrame = true;
      } else {
        const nonGreen = selEnts.filter(e => api.colorOf(e) !== '#00ff00');
        if (nonGreen.length > 0) {
          const baked = api.bakeContours(nonGreen, { joinTol: 0.1 });
          const closedCts = ((baked && baked.contours) || [])
            .filter(ct => ct && Array.isArray(ct.pts) && ct.pts.length >= 3)
            .map(ct => cleanRing(ct.pts))
            .filter(pts => pts.length >= 3);
          if (!closedCts.length) {
            api.toast('Objek wadah terpilih tidak memiliki kontur tertutup');
            return;
          }
          containerRings = closedCts.map(ensureCCW);
        } else if (sb) {
          const sw = sb.maxX - sb.minX, sh = sb.maxY - sb.minY;
          if (!(sw > 1 && sh > 1)) {
            api.toast('Seleksi wadah terlalu kecil');
            return;
          }
          containerRings = [ensureCCW(rectPts((sb.minX + sb.maxX) / 2, (sb.minY + sb.maxY) / 2, sw, sh))];
        } else {
          const c = api.s2w(api.getW() / 2, api.getH() / 2);
          containerRings = [ensureCCW(rectPts(c.x, c.y, w, h))];
          drawFrame = true;
        }
      }

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const r of containerRings) {
        for (const p of r) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
      if (!isFinite(minX) || (maxX - minX) <= margin * 2 || (maxY - minY) <= margin * 2) {
        api.toast('Outer margin melebihi ukuran wadah');
        return;
      }

      let clipRings = containerRings;
      if (margin > 0) {
        const off = api.offsetClosedChains(
          containerRings.map(pts => ({ pts, closed: true })),
          -margin,
          { join: 'miter', miterLimit: 2, arcTol: 0.1 }
        );
        if (!off || !off.length) {
          api.toast('Wadah terlalu sempit untuk outer margin ' + margin + ' mm');
          return;
        }
        clipRings = off.map(o => ensureCCW(cleanRing(o.pts))).filter(r => r.length >= 3);
        if (!clipRings.length) {
          api.toast('Area setelah outer margin kosong');
          return;
        }
      }

      let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
      for (const r of clipRings) {
        for (const p of r) {
          if (p.x < cMinX) cMinX = p.x;
          if (p.y < cMinY) cMinY = p.y;
          if (p.x > cMaxX) cMaxX = p.x;
          if (p.y > cMaxY) cMaxY = p.y;
        }
      }

      const rng = makeRng(seed);
      const padV = Math.max(cMaxX - cMinX, cMaxY - cMinY) * 0.1;
      const vMinX = cMinX - padV, vMaxX = cMaxX + padV;
      const vMinY = cMinY - padV, vMaxY = cMaxY + padV;
      const seeds = [];
      for (let i = 0; i < cells; i++) {
        seeds.push({
          x: vMinX + rng() * (vMaxX - vMinX),
          y: vMinY + rng() * (vMaxY - vMinY)
        });
      }

      const pitch = dmax + gap;
      const stepX = pitch;
      const stepY = gridType === 'stagger' ? pitch * Math.sin(Math.PI / 3) : pitch;

      const spanW = cMaxX - cMinX;
      const spanH = cMaxY - cMinY;
      // Tambahkan kolom/baris ekstra melewati batas agar tepi panel penuh lalu di-crop
      const cols = Math.floor(spanW / stepX) + 3;
      const rows = Math.floor(spanH / stepY) + 3;
      const cx0 = (cMinX + cMaxX) / 2;
      const cy0 = (cMinY + cMaxY) / 2;
      const startX = cx0 - ((cols - 1) * stepX) / 2;
      const startY = cy0 - ((rows - 1) * stepY) / 2;

      const candidates = [];
      let maxRidge = 0;
      for (let r = 0; r < rows; r++) {
        const py = startY + r * stepY;
        const rowShift = (gridType === 'stagger' && (r % 2 !== 0)) ? stepX * 0.5 : 0;
        for (let c = 0; c < cols; c++) {
          const px = startX + c * stepX + rowShift;
          if (px + dmax * 0.5 < cMinX || px - dmax * 0.5 > cMaxX ||
              py + dmax * 0.5 < cMinY || py - dmax * 0.5 > cMaxY) continue;
          const dRidge = voronoiRidgeDist(px, py, seeds);
          if (dRidge > maxRidge && pointInRings(api, { x: px, y: py }, clipRings)) {
            maxRidge = dRidge;
          }
          candidates.push({ x: px, y: py, dRidge });
        }
      }

      if (maxRidge < 1e-3) maxRidge = Math.max(spanW, spanH) / Math.sqrt(cells) * 0.45;
      // Skala referensi transisi ukuran dari garis Voronoi ke pusat sel
      const bandWidth = Math.min(maxRidge, Math.max(pitch * 1.6, Math.sqrt((spanW * spanH) / cells) * 0.42));

      const holePolys = [];
      for (let i = 0; i < candidates.length; i++) {
        const pt = candidates[i];
        const t = api.clamp(pt.dRidge / Math.max(1e-3, bandWidth), 0, 1);
        const smoothT = t * t * (3 - 2 * t);
        const dia = dmin + (dmax - dmin) * smoothT;
        if (dia < 0.8) continue;

        const poly = ensureCCW(buildHolePoly(pt.x, pt.y, dia, shape));
        const clipped = api.polyBoolOp('intersection', [poly], clipRings);
        if (clipped && clipped.length) {
          const noIslands = outerRingsOnly(api, clipped);
          for (const ring of noIslands) {
            if (ring.length >= 3 && Math.abs(api.signedAreaPts(ring)) > 0.5) {
              holePolys.push(ring);
            }
          }
        }
      }

      if (!holePolys.length) {
        api.toast('Tidak ada lubang yang terbentuk di dalam area margin');
        return;
      }

      api.pushHistory();
      if (prev) api.removeEntity(prev.id);

      const madeIds = [];
      if (drawFrame) {
        for (const r of containerRings) {
          const fid = api.addPanelEntity(r, '#000000');
          if (fid) madeIds.push(fid);
        }
      }
      for (const hPoly of holePolys) {
        const hid = api.addPanelEntity(hPoly, '#000000');
        if (hid) madeIds.push(hid);
      }

      api.commit();
      if (!madeIds.length) return;

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = {
          kind: ID,
          params: { w, h, margin, shape, dmax, dmin, gap, grid: gridType, cells, seed }
        };
        wrap.name = 'ACP Voronoi ' + api.fmt(w) + 'x' + api.fmt(h);
        api.commit();
      }
      api.toast('Panel ACP Voronoi selesai (' + holePolys.length + ' lubang)');
    }
  });
})();