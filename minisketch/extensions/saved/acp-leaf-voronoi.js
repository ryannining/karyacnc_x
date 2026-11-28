// saved by MiniSketch (server disk) — id: acp-leaf-voronoi
// label: Daun Voronoi
(() => {
  'use strict';
  const NS = window.MiniSketchTools;
  const ID = 'acp-leaf-voronoi';
  const el = (id) => document.getElementById(id);

  function rectPts(cx, cy, w, h) {
    const x = w / 2, y = h / 2;
    return [
      { x: cx - x, y: cy - y },
      { x: cx + x, y: cy - y },
      { x: cx + x, y: cy + y },
      { x: cx - x, y: cy + y }
    ];
  }

  function polyCentroid(pts) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[i], p1 = pts[(i + 1) % pts.length];
      const cr = p0.x * p1.y - p1.x * p0.y;
      a += cr;
      cx += (p0.x + p1.x) * cr;
      cy += (p0.y + p1.y) * cr;
    }
    if (Math.abs(a) < 1e-6) {
      let sx = 0, sy = 0;
      for (const p of pts) { sx += p.x; sy += p.y; }
      return { x: sx / pts.length, y: sy / pts.length };
    }
    return { x: cx / (3 * a), y: cy / (3 * a) };
  }

  function clipHalfPlane(poly, mx, my, nx, ny) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = (a.x - mx) * nx + (a.y - my) * ny;
      const db = (b.x - mx) * nx + (b.y - my) * ny;
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return out;
  }

  function computeVoronoiCells(seeds, bbox) {
    const initBox = [
      { x: bbox.minX, y: bbox.minY },
      { x: bbox.maxX, y: bbox.minY },
      { x: bbox.maxX, y: bbox.maxY },
      { x: bbox.minX, y: bbox.maxY }
    ];
    const cells = [];
    for (let i = 0; i < seeds.length; i++) {
      let cell = initBox.slice();
      const si = seeds[i];
      for (let j = 0; j < seeds.length; j++) {
        if (i === j) continue;
        const sj = seeds[j];
        const dx = sj.x - si.x, dy = sj.y - si.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-6) continue;
        const mx = (si.x + sj.x) * 0.5, my = (si.y + sj.y) * 0.5;
        cell = clipHalfPlane(cell, mx, my, dx, dy);
        if (cell.length < 3) break;
      }
      if (cell.length >= 3) cells.push({ seed: si, poly: cell });
    }
    return cells;
  }

  function cellPrincipalFrame(poly) {
    const c = polyCentroid(poly);
    let cxx = 0, cyy = 0, cxy = 0;
    for (const p of poly) {
      const dx = p.x - c.x, dy = p.y - c.y;
      cxx += dx * dx;
      cyy += dy * dy;
      cxy += dx * dy;
    }
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const vx = -uy, vy = ux;

    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of poly) {
      const dx = p.x - c.x, dy = p.y - c.y;
      const pu = dx * ux + dy * uy;
      const pv = dx * vx + dy * vy;
      if (pu < minU) minU = pu;
      if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv;
      if (pv > maxV) maxV = pv;
    }
    const midU = (minU + maxU) * 0.5;
    const midV = (minV + maxV) * 0.5;
    return {
      cx: c.x + ux * midU + vx * midV,
      cy: c.y + uy * midU + vy * midV,
      angle,
      len: Math.max(20, maxU - minU),
      wid: Math.max(15, maxV - minV)
    };
  }

  function buildFittedLeafVanes(api, frame, vaneCount, ribGap, flipDir) {
    const L = frame.len * 1.12;
    const W = frame.wid * 1.14;
    const dir = flipDir ? -1 : 1;
    const cos = Math.cos(frame.angle), sin = Math.sin(frame.angle);

    const toWorld = (u, v) => {
      const lu = u * dir;
      return {
        x: frame.cx + lu * cos - v * sin,
        y: frame.cy + lu * sin + v * cos
      };
    };

    const vanes = [];
    const steps = Math.max(6, Math.round(vaneCount));
    const stepT = 0.88 / steps;
    const halfMidrib = Math.max(4.5, ribGap * 0.55);

    for (let i = 0; i < steps; i++) {
      const t0 = 0.05 + i * stepT;
      const t1 = t0 + stepT * 0.65;
      if (t1 >= 0.95) break;

      for (const side of [1, -1]) {
        const pts = [];
        const segs = 9;

        for (let s = 0; s <= segs; s++) {
          const f = s / segs;
          const tCur = t0 + f * 0.13;
          const maxW = Math.sin(Math.pow(Math.min(0.99, tCur), 0.72) * Math.PI) * (W * 0.5);
          if (maxW <= halfMidrib + 5) continue;

          const vMag = halfMidrib + f * (maxW - halfMidrib);
          const arch = Math.sin(f * Math.PI) * (L * 0.022) + Math.pow(f, 1.35) * (L * 0.075);
          const u = -(L * 0.5) + t0 * L + arch;
          pts.push(toWorld(u, side * vMag));
        }

        for (let s = segs; s >= 0; s--) {
          const f = s / segs;
          const tCur = t1 + f * 0.12;
          const maxW = Math.sin(Math.pow(Math.min(0.99, tCur), 0.72) * Math.PI) * (W * 0.5);
          if (maxW <= halfMidrib + 5) continue;

          const vMag = halfMidrib + f * (maxW - halfMidrib);
          const taper = 1 - f * 0.22;
          const arch = Math.sin(f * Math.PI) * (L * 0.022) + Math.pow(f, 1.35) * (L * 0.07);
          const uBase = -(L * 0.5) + t0 * L + arch;
          const thick = (stepT * L * 0.63) * taper;
          pts.push(toWorld(uBase + thick, side * vMag));
        }

        if (pts.length >= 6) {
          if (api.signedAreaPts(pts) < 0) pts.reverse();
          vanes.push(pts);
        }
      }
    }
    return vanes;
  }

  NS.register({
    id: ID,
    label: 'Daun Voronoi',
    title: 'Parametric Voronoi Leaf ACP Panel',
    version: '3.1.0',
    author: 'AI Builder',
    category: 'Signage & Art',
    description: 'Membagi panel ACP dengan sel Voronoi penuh sampai melewati batas tepi, lalu di-crop rapi sesuai wadah & margin.',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><polygon points="2,2 8,1 14,3 13,9 7,15 1,10"/><path d="M8 1L7 15M2 6L13 6M3 11L12 10"/></svg>',
    modalId: ID + '-modal',
    modal: `
      <div id="${ID}-modal" class="modal hidden">
        <div class="modal-box wide-cols">
          <h3>Panel Daun ACP (Voronoi &amp; Gradasi)</h3>
          <div class="modal-cols">
            <div class="opt-col">
              <label class="opt">Width / Lebar (mm) <input type="number" id="dvor-w" value="1220" min="100"></label>
              <label class="opt">Height / Tinggi (mm) <input type="number" id="dvor-h" value="2440" min="100"></label>
              <label class="opt">Outer Margin (mm) <input type="number" id="dvor-margin" value="20" min="0"></label>
              <label class="opt">Target Jumlah Daun (dalam wadah) <input type="number" id="dvor-count" value="16" min="4" max="120"></label>
              <label class="opt">Gradasi Ukuran Vertikal
                <select id="dvor-grad">
                  <option value="none">Seragam (Rapat Merata)</option>
                  <option value="top-small">Atas Kecil → Bawah Besar</option>
                  <option value="top-large">Atas Besar → Bawah Kecil</option>
                  <option value="center-large">Tengah Besar → Tepi Kecil</option>
                </select>
              </label>
              <label class="opt">Kekuatan Gradasi (1.0 - 4.0) <input type="number" id="dvor-grad-str" value="2.2" step="0.2" min="1" max="5"></label>
              <label class="opt">Jarak Antar Sel / Tulang (mm) <input type="number" id="dvor-gap" value="14" min="4" max="60"></label>
              <label class="opt">Bilah per Sisi Daun <input type="number" id="dvor-vanes" value="12" min="6" max="24"></label>
              <label class="opt">Seed Variasi <input type="number" id="dvor-seed" value="12" min="1" max="999"></label>
              <label class="opt"><input type="checkbox" id="dvor-show-cells"> Tampilkan jaring sel Voronoi (#00ff00)</label>
            </div>
            <div class="cnc-status" data-guide="main"></div>
          </div>
          <div class="modal-actions">
            <button class="btn" id="${ID}-cancel">Batal</button>
            <button class="btn primary" id="${ID}-ok">Buat Panel</button>
          </div>
        </div>
      </div>
    `,
    guide: {
      id: {
        main: '<b>Voronoi Oversized Bleed + Crop:</b><br>1. Sel Voronoi &amp; daun dibangkitkan melebihi batas tepi wadah agar <b>pinggiran penuh terisi (zero edge gaps)</b>.<br>2. Mendukung <b>gradasi ukuran daun</b>.<br>3. Di langkah akhir seluruh bilah di-crop presisi ke <b>wadah - margin</b> dan digabung menjadi <b>group parametrik</b>.'
      },
      en: {
        main: '<b>Voronoi Oversized Bleed + Crop:</b><br>1. Generates Voronoi cells &amp; leaves beyond container boundaries for <b>full edge coverage</b>.<br>2. Supports <b>vertical size gradients</b>.<br>3. Clips cleanly to <b>container minus margin</b> inside a <b>parametric group</b>.'
      }
    },

    open(api, params) {
      if (params) {
        if (params.w != null) el('dvor-w').value = params.w;
        if (params.h != null) el('dvor-h').value = params.h;
        if (params.margin != null) el('dvor-margin').value = params.margin;
        if (params.count != null) el('dvor-count').value = params.count;
        if (params.grad != null) el('dvor-grad').value = params.grad;
        if (params.gradStr != null) el('dvor-grad-str').value = params.gradStr;
        if (params.gap != null) el('dvor-gap').value = params.gap;
        if (params.vanes != null) el('dvor-vanes').value = params.vanes;
        if (params.seed != null) el('dvor-seed').value = params.seed;
        if (params.showCells != null) el('dvor-show-cells').checked = !!params.showCells;
      }
      const ok = el(ID + '-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const w = +el('dvor-w').value;
      const h = +el('dvor-h').value;
      const margin = +el('dvor-margin').value;
      const targetCount = Math.round(+el('dvor-count').value);
      const grad = el('dvor-grad').value;
      const gradStr = Math.max(1, +el('dvor-grad-str').value || 1);
      const gap = +el('dvor-gap').value;
      const vanes = Math.round(+el('dvor-vanes').value);
      const seed = Math.round(+el('dvor-seed').value) || 1;
      const showCells = !!el('dvor-show-cells').checked;

      if (!(w >= 100 && h >= 100)) {
        api.toast('Lebar dan tinggi minimal 100 mm');
        return;
      }
      if (!(margin >= 0 && targetCount >= 4 && vanes >= 6)) {
        api.toast('Periksa kembali parameter input');
        return;
      }

      NS.close(ID);

      const selEnts = api.selectedEntities();
      const prev = selEnts.find(e => e.type === 'art' && e.gen && e.gen.kind === ID);
      const nonPrevSel = selEnts.filter(e => e !== prev && api.colorOf(e) !== '#00ff00');
      const sb = nonPrevSel.length ? api.selectionBounds() : (!prev ? api.selectionBounds() : null);

      let outerRings = [];
      let usedExistingContainer = false;

      if (nonPrevSel.length > 0) {
        const baked = api.bakeContours(nonPrevSel, { joinTol: 0.5 });
        for (const ct of (baked && baked.contours) || []) {
          if (ct.pts && ct.pts.length >= 3) {
            const r = ct.pts.slice();
            if (api.signedAreaPts(r) < 0) r.reverse();
            outerRings.push(r);
          }
        }
        if (!outerRings.length) {
          api.toast('Objek wadah terpilih tidak memiliki kontur tertutup yang valid');
          return;
        }
        usedExistingContainer = true;
      } else if (sb && !prev) {
        const cx = (sb.minX + sb.maxX) / 2, cy = (sb.minY + sb.maxY) / 2;
        outerRings = [rectPts(cx, cy, sb.maxX - sb.minX, sb.maxY - sb.minY)];
        usedExistingContainer = true;
      } else {
        let c = api.s2w(api.getW() / 2, api.getH() / 2);
        if (prev) {
          const p0 = api.P(prev.p0), pw = api.P(prev.pw), ph = api.P(prev.ph);
          if (pw && ph) c = { x: (pw.x + ph.x) / 2, y: (pw.y + ph.y) / 2 };
          else if (p0) c = { x: p0.x, y: p0.y };
        }
        outerRings = [rectPts(c.x, c.y, w, h)];
      }

      // Area potong akhir (wadah - outer margin)
      let clipRings = outerRings;
      if (margin > 0) {
        const chains = outerRings.map(pts => ({ pts, closed: true }));
        const inset = api.offsetClosedChains(chains, -margin, { join: 'miter', miterLimit: 2, arcTol: 0.2 });
        if (!inset || !inset.length) {
          api.toast('Outer margin terlalu besar untuk ukuran wadah');
          return;
        }
        clipRings = inset.map(c => {
          const r = c.pts.slice();
          if (api.signedAreaPts(r) < 0) r.reverse();
          return r;
        });
      }

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const ring of clipRings) {
        for (const p of ring) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
      const areaW = maxX - minX, areaH = maxY - minY;
      if (areaW <= 20 || areaH <= 20) {
        api.toast('Area kerja terlalu kecil');
        return;
      }

      // Perluas area pembangkitan Voronoi (bleed keluar batas wadah) agar tepi penuh tanpa ruang kosong
      const avgCellDim = Math.sqrt((areaW * areaH) / targetCount);
      const bleed = avgCellDim * 0.85;
      const bMinX = minX - bleed, bMaxX = maxX + bleed;
      const bMinY = minY - bleed, bMaxY = maxY + bleed;
      const bW = bMaxX - bMinX, bH = bMaxY - bMinY;

      // Sesuaikan jumlah seed untuk area yang telah diperluas agar kepadatan di dalam wadah tetap sesuai target
      let clipArea = 0;
      for (const r of clipRings) clipArea += Math.abs(api.signedAreaPts(r));
      const bleedRatio = (bW * bH) / Math.max(100, clipArea);
      const totalSeeds = Math.max(6, Math.round(targetCount * bleedRatio));

      let rng = (seed * 1664525 + 1013904223) >>> 0;
      const rand = () => {
        rng = (rng * 1664525 + 1013904223) >>> 0;
        return rng / 4294967296;
      };

      const densityAt = (x, y) => {
        const ny = api.clamp((y - minY) / areaH, 0, 1);
        const nx = api.clamp((x - minX) / areaW, 0, 1);
        if (grad === 'top-small') return Math.pow(1 - ny, 1.35) * (gradStr - 1) + 1;
        if (grad === 'top-large') return Math.pow(ny, 1.35) * (gradStr - 1) + 1;
        if (grad === 'center-large') {
          const d = Math.hypot(nx - 0.5, ny - 0.5) * 1.42;
          return Math.pow(Math.min(1, d), 1.4) * (gradStr - 1) + 1;
        }
        return 1;
      };

      let seeds = [];
      let guard = 0;
      while (seeds.length < totalSeeds && guard < totalSeeds * 80) {
        guard++;
        const sx = bMinX + rand() * bW;
        const sy = bMinY + rand() * bH;
        const prob = densityAt(sx, sy) / gradStr;
        if (rand() <= prob) {
          seeds.push({ x: sx, y: sy });
        }
      }
      while (seeds.length < totalSeeds) {
        seeds.push({ x: bMinX + rand() * bW, y: bMinY + rand() * bH });
      }

      const bleedBox = { minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY };

      // 2 iterasi Lloyd Relaxation pada area bleed
      for (let iter = 0; iter < 2; iter++) {
        const cells = computeVoronoiCells(seeds, bleedBox);
        if (cells.length === seeds.length) {
          seeds = cells.map(c => polyCentroid(c.poly));
        }
      }

      const voronoiCells = computeVoronoiCells(seeds, bleedBox);
      const finalHoleRings = [];
      const debugCellRings = [];
      let activeLeafCount = 0;

      for (let idx = 0; idx < voronoiCells.length; idx++) {
        const fullCell = voronoiCells[idx].poly;
        if (fullCell.length < 3) continue;
        if (api.signedAreaPts(fullCell) < 0) fullCell.reverse();

        // 1. Susutkan sel UTUH (sebelum dipotong wadah) sebagai cangkang daun penuh
        const shellChains = api.offsetClosedChains(
          [{ pts: fullCell, closed: true }],
          -gap * 0.5,
          { join: 'round', miterLimit: 2, arcTol: 0.3 }
        );
        if (!shellChains || !shellChains.length) continue;

        const leafShell = shellChains[0].pts;
        if (leafShell.length < 3) continue;
        if (api.signedAreaPts(leafShell) < 0) leafShell.reverse();

        // Lewati jika cangkang daun sama sekali tidak menyentuh bbox area potong
        const sBB = polyBBox(leafShell);
        if (sBB.maxX < minX || sBB.minX > maxX || sBB.maxY < minY || sBB.minY > maxY) continue;

        // 2. Bangun daun utuh sesuai ukuran & orientasi sel penuh (boleh melewati batas wadah)
        const frame = cellPrincipalFrame(leafShell);
        if (frame.len < 35 || frame.wid < 20) continue;

        const flipDir = ((idx + seed) % 2 === 0);
        const scaledVanes = Math.max(6, Math.min(22, Math.round(vanes * Math.min(1.4, Math.max(0.65, frame.len / 340)))));
        const localVanes = buildFittedLeafVanes(api, frame, scaledVanes, Math.max(8, gap * 0.7), flipDir);

        let leafHasHole = false;
        for (const vane of localVanes) {
          // 3. Batasi bilah ke cangkang selnya (anti-overlap antar daun), LALU crop ke clipRings (wadah - margin)
          const insideShell = api.polyBoolOp('intersection', [vane], [leafShell]);
          if (!insideShell || !insideShell.length) continue;

          const clippedToContainer = api.polyBoolOp('intersection', insideShell, clipRings);
          if (clippedToContainer && clippedToContainer.length > 0) {
            for (const hole of clippedToContainer) {
              if (hole.length >= 3 && Math.abs(api.signedAreaPts(hole)) > 10) {
                finalHoleRings.push(hole);
                leafHasHole = true;
              }
            }
          }
        }

        if (leafHasHole) {
          activeLeafCount++;
          if (showCells) {
            const clippedDebug = api.polyBoolOp('intersection', [leafShell], clipRings);
            for (const dr of (clippedDebug || [])) {
              if (dr.length >= 3) debugCellRings.push(dr);
            }
          }
        }
      }

      if (!finalHoleRings.length) {
        api.toast('Tidak ada bilah daun yang terbentuk. Kurangi jarak antar sel atau jumlah daun.');
        return;
      }

      api.pushHistory();
      if (prev) api.removeEntity(prev.id);

      const madeIds = [];

      if (!usedExistingContainer) {
        for (const r of outerRings) {
          const fid = api.addPanelEntity(r, '#000000');
          if (fid) madeIds.push(fid);
        }
      }

      for (const hole of finalHoleRings) {
        let hid = api.addFittedCurve(hole, '#000000', { tol: 0.25, sharpAngle: 32, closed: true, denoise: false });
        if (!hid) hid = api.addPanelEntity(hole, '#000000');
        if (hid) madeIds.push(hid);
      }

      if (showCells) {
        for (const cr of debugCellRings) {
          const cid = api.addPanelEntity(cr, '#00ff00');
          if (cid) madeIds.push(cid);
        }
      }

      api.commit();
      if (!madeIds.length) return;

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });

      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = {
          kind: ID,
          params: { w, h, margin, count: targetCount, grad, gradStr, gap, vanes, seed, showCells }
        };
        wrap.name = `Panel Daun Voronoi (${activeLeafCount} daun)`;
        api.commit();
      }

      api.toast(`Selesai: ${activeLeafCount} daun Voronoi penuh hingga tepi`);
    }
  });
})();