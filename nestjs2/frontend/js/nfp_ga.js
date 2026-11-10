/**
 * GA + NFP2 placement optimizer.
 *
 * Genetic Algorithm whose chromosome is ONLY the placement order
 * (a permutation of part indexes). The decoder is the existing,
 * unmodified NFP2.findBestNFPPlacement, called once per part in
 * chromosome order. Geometry, collision, offset, holes, export and
 * the worker protocol are untouched — this file only decides
 * "which part goes next".
 *
 * Fitness  = bounding-box area + total bbox area part yang tidak ternesting
 * (sisa besar = rugi bahan baru, sisa kecil masih bisa pakai bahan sisa).
 * Elitism always keeps the descending-size baseline individual, so a
 * GA run can never score worse than the plain heuristic order.
 */
class NFPGA {
    constructor() {
        this.spacing = 0;
        this.allowFlip = true;
        this.gridSize = 10;
        this.performanceStats = {
            generations: 0,
            evaluations: 0,
            collisionChecks: 0,
            bestFitness: Infinity
        };
        // Last full-nest placements, reused as fixed obstacles during renest().
        this.lastPlacements = [];
        this.hascustomsheet = false;
        // GA hyper-parameters (defaults agreed with user).
        this.popSize = 6;
        this.generations = 5;
        this.mutationRate = 0.1;
    }

    setSpacing(spacing) {
        this.spacing = spacing * GEOM_SCALE;
        this.gridSize = spacing > 0 ? spacing * GEOM_SCALE : GEOM_SCALE;
    }

    setAllowFlip(allowFlip) { this.allowFlip = allowFlip; }

    setGAParams(popSize, generations, mutationRate) {
        if (popSize > 1) this.popSize = Math.floor(popSize);
        if (generations > 0) this.generations = Math.floor(generations);
        if (mutationRate >= 0 && mutationRate <= 1) this.mutationRate = mutationRate;
    }

    // ---- pure permutation helpers (no geometry here) ----

    _shuffled(n) {
        const a = [];
        for (let i = 0; i < n; i++) a.push(i);
        for (let i = n - 1; i > 0; i--) {
            const j = (Math.random() * (i + 1)) | 0;
            const t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }

    // Order crossover (OX): copy a slice of p1, fill the rest in p2 order.
    _crossover(p1, p2) {
        const n = p1.length;
        if (n < 2) return p1.slice();
        let a = (Math.random() * n) | 0;
        let b = (Math.random() * n) | 0;
        if (a > b) { const t = a; a = b; b = t; }
        const child = new Array(n).fill(-1);
        const used = new Set();
        for (let i = a; i <= b; i++) { child[i] = p1[i]; used.add(p1[i]); }
        let j = (b + 1) % n;
        for (let i = 0; i < n; i++) {
            const g = p2[(b + 1 + i) % n];
            if (!used.has(g)) { child[j] = g; used.add(g); j = (j + 1) % n; }
        }
        return child;
    }

    // One random mutation of the placement order: swap two positions,
    // relocate one part, or invert a random segment.
    _mutateOrder(order) {
        const n = order.length;
        if (n < 2) return order;
        const a = order.slice();
        const r = Math.random();
        if (r < 0.5) {
            const i = (Math.random() * n) | 0;
            let j = (Math.random() * n) | 0;
            if (i === j) j = (j + 1) % n;
            const t = a[i]; a[i] = a[j]; a[j] = t;
        } else if (r < 0.8) {
            const i = (Math.random() * n) | 0;
            const g = a.splice(i, 1)[0];
            a.splice((Math.random() * (n - 1 + 1)) | 0, 0, g);
        } else {
            let i = (Math.random() * n) | 0;
            let j = (Math.random() * n) | 0;
            if (i > j) { const t = i; i = j; j = t; }
            while (i < j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
        }
        return a;
    }

    // Random rotation-gene vector: one variant index per entry position.
    _randomRots() {
        return this._variantCounts.map(c => (Math.random() * c) | 0);
    }

    // Uniform crossover of two rotation vectors.
    _crossoverRots(r1, r2) {
        const n = r1.length;
        const child = new Array(n);
        for (let i = 0; i < n; i++) child[i] = Math.random() < 0.5 ? r1[i] : r2[i];
        return child;
    }

    // Mutate one individual ({order, rots}): always shuffle the order a
    // little (SVGnest-style, keeps every generation exploring), and with
    // probability mutationRate also change one rotation gene.
    _mutate(ind) {
        const order = this._mutateOrder(ind.order);
        let rots = ind.rots;
        if (Math.random() < this.mutationRate) {
            rots = ind.rots.slice();
            const i = (Math.random() * rots.length) | 0;
            const c = this._variantCounts[i];
            if (c > 1) {
                let v = (Math.random() * c) | 0;
                if (v === rots[i]) v = (v + 1) % c;
                rots[i] = v;
            }
        }
        return { order, rots };
    }

    // A seed from the previous infinite-loop iteration is valid only when
    // it is a full permutation of the current entry positions.
    _isValidSeed(seed, n) {
        if (!seed || !Array.isArray(seed.order) || !Array.isArray(seed.rots)) return false;
        if (seed.order.length !== n || seed.rots.length !== n) return false;
        const seen = new Array(n).fill(false);
        for (const v of seed.order) {
            if (!Number.isInteger(v) || v < 0 || v >= n || seen[v]) return false;
            seen[v] = true;
        }
        return true;
    }

    _tournament(fits, k) {
        let best = (Math.random() * fits.length) | 0;
        for (let i = 1; i < k; i++) {
            const c = (Math.random() * fits.length) | 0;
            if (fits[c] < fits[best]) best = c;
        }
        return best;
    }

    /**
     * Bounding-box area of one entry (variant 0, scaled units).
     * Cached per entry object so the fitness loop stays cheap.
     */
    _entryArea(e) {
        if (e._gaArea !== undefined) return e._gaArea;
        let a = 0;
        if (e.variants && e.variants.length > 0) {
            const b = e.variants[0].getBounds();
            a = b.width * b.height;
        }
        e._gaArea = a;
        return a;
    }

    /**
     * Decode one chromosome: place parts in `order` using a fresh,
     * unmodified NFP2 instance as the decoder. Rotation genes pick one
     * variant per part (SVGnest-style); order-only entries fall back to
     * trying all variants so old seeds stay valid.
     * Fitness = bounding-box area + total bbox area yang tidak ternesting.
     * Jadi GA memprioritaskan part BESAR lebih dulu: sisa besar = rugi bahan
     * baru, sisa kecil masih bisa pakai bahan sisa.
     * ctx = { entries, scaledSheet, gridSize, stats }
     * Returns { placements, fitness, unplaced, unplacedArea }.
     */
    _evaluate(ind, ctx) {
        const order = Array.isArray(ind) ? ind : ind.order;
        const dec = new NFP2();
        dec.spacing = this.spacing;
        dec.allowFlip = this.allowFlip;
        dec.gridSize = this.gridSize;
        dec.performanceStats = { boundaryPointsTested: 0, collisionAvoided: 0, collisionChecks: 0 };
        const cellSize = Math.max(50 * GEOM_SCALE, ctx.gridSize * 5);
        dec.spatialHash = new NFP2SpatialHash(cellSize);

        const sheet = { width: ctx.scaledSheet.width, height: ctx.scaledSheet.height };
        const placed = ctx.fixed.slice();
        for (const p of placed) dec.spatialHash.add(p);

        // Custom sheet outlines (green) become the sheet, exactly like NFP2.
        for (const e of ctx.entries) {
            if (e.lcolor !== '#00ff00') continue;
            const sv = e.variants[0];
            sv.align();
            const b = sv.getBounds();
            sheet.width = b.width;
            sheet.height = b.height;
            dec.hascustomsheet = true;
            const c = sv.clone();
            c.childIndex = e.childIndex;
            placed.push(c);
            dec.spatialHash.add(c);
        }

        let unplaced = 0;
        let unplacedArea = 0;
        for (let k = 0; k < order.length; k++) {
            const e = ctx.entries[order[k]];
            if (!e || ctx.initialSet.has(e.originIndex)) continue;
            if (e.lcolor === '#00ff00') continue; // fixed by decoder above
            let bp = null;
            if (ind && !Array.isArray(ind) && ind.rots) {
                bp = this._placeWithVariant(dec, e, ind.rots[order[k]], placed, sheet, ctx.gridSize);
            } else {
                bp = dec.findBestNFPPlacement(e, placed, sheet, ctx.gridSize);
            }
            if (bp) {
                bp.childIndex = e.childIndex;
                placed.push(bp);
                dec.spatialHash.add(bp);
            } else {
                unplaced++;
                unplacedArea += this._entryArea(e);
            }
        }

        let area = 0;
        if (placed.length > 0) {
            const b = dec.calculateTotalBounds(placed);
            area = b.width * b.height;
        }
        ctx.stats.collisionChecks += dec.performanceStats.collisionChecks || 0;
        return { placements: placed, fitness: area + unplacedArea, unplaced: unplaced, unplacedArea: unplacedArea };
    }

    /**
     * Place one part trying only the rotation gene (a single variant
     * index), mirroring SVGnest where the genome carries rotation.
     * Falls back to all variants when the gene is missing or invalid
     * (multi-flip variants generate extra indices at runtime).
     */
    _placeWithVariant(dec, entry, gene, placed, sheet, gridSize) {
        const variants = entry.variants;
        if (!variants || variants.length === 0) return null;
        let list = variants;
        if (Number.isInteger(gene)) {
            const v = variants[((gene % variants.length) + variants.length) % variants.length];
            if (v) list = [v];
        }
        const single = { variants: list, childIndex: entry.childIndex };
        return dec.findBestNFPPlacement(single, placed, sheet, gridSize);
    }

    findBestPosition(parts, sheet, progressHandler, gridSize, initialPlacements = [], seedOrder = null) {
        const startTime = performance.now();
        const scaledSheet = {
            width: sheet.width * GEOM_SCALE,
            height: sheet.height * GEOM_SCALE
        };
        this.hascustomsheet = false;

        // Full nest clears all placement flags, like NFP2.
        parts.forEach(p => { p.placed = false; });

        const initialSet = new Set(initialPlacements.map(p => p.originIndex));
        const entries = parts
            .map((p, i) => ({ part: p, idx: i }))
            .filter(e => !initialSet.has(e.part.originIndex));
        const placeables = entries.filter(e => e.part.lcolor !== '#00ff00');

        // Degenerate case: nothing to order, keep NFP2 behaviour.
        if (placeables.length === 0) {
            const dec = new NFP2();
            dec.spacing = this.spacing;
            dec.allowFlip = this.allowFlip;
            dec.gridSize = gridSize;
            const out = dec.findBestPosition(parts, sheet, progressHandler, gridSize, initialPlacements);
            this.lastPlacements = dec.lastPlacements;
            this.hascustomsheet = dec.hascustomsheet;
            this.performanceStats = {
                generations: 0, evaluations: 1,
                collisionChecks: (dec.performanceStats && dec.performanceStats.collisionChecks) || 0,
                bestFitness: Infinity
            };
            return out;
        }

        // Baseline individual: descending size (longest side squared),
        // same metric NFP2 uses for its passes. Elitism keeps it, so the
        // GA result is never worse than this heuristic order.
        const sizeOf = (w) => {
            const b = w.part.variants[0].getBounds();
            const l = Math.max(b.width, b.height);
            return l * l;
        };
        // Custom-sheet (green) entries are fixed by the decoder, so they are
        // excluded from the chromosome; only placeable parts are ordered.
        const baselineOrder = placeables
            .map(e => entries.indexOf(e))
            .sort((a, b) => sizeOf(entries[b]) - sizeOf(entries[a]));

        const ctx = {
            entries: entries.map(e => e.part),
            scaledSheet: scaledSheet,
            gridSize: gridSize,
            fixed: initialPlacements.slice(),
            initialSet: initialSet,
            stats: { collisionChecks: 0 }
        };

        // Variant counts per entry position (one rotation gene each).
        // Flip adds its own variant indices on top of rotation, so counts
        // are read live from the entries.
        this._variantCounts = ctx.entries.map(e =>
            (e.variants && e.variants.length > 0) ? e.variants.length : 1);

        const popSize = Math.max(2, this.popSize);
        // Chromosome = permutation of ENTRY positions (0..entries.length-1),
        // so duplicate parts stay distinguishable.
        const n = entries.length;
        const baseSet = new Set(baselineOrder);
        // Full permutation of all entry positions; the fixed green entries
        // simply decode to no-ops wherever they appear in the order.
        // The first individual keeps the heuristic solution up front
        // (baseline positions first) so elitism can never lose it.
        const baseRots = this._randomRots();
        let pop = [{ order: baselineOrder.concat(
            Array.from({ length: n }, (_, i) => i).filter(i => !baseSet.has(i))
        ), rots: baseRots }];
        // Individual #2 continues the winner of the previous infinite-loop
        // iteration (mutated fresh each loop so exploration never stalls).
        if (this._isValidSeed(seedOrder, n)) {
            pop.push({ order: seedOrder.order.slice(), rots: seedOrder.rots.slice() });
        }
        while (pop.length < popSize) pop.push({ order: this._shuffled(n), rots: this._randomRots() });

        const totalEvals = pop.length * Math.max(1, this.generations) + 1;
        let evalsDone = 0;
        let fits = pop.map(o => {
            const r = this._evaluate(o, ctx);
            if (progressHandler) progressHandler(++evalsDone, totalEvals);
            return r.fitness;
        });

        const ELITES = Math.min(2, pop.length);
        for (let g = 0; g < this.generations; g++) {
            const ranked = pop.map((o, i) => i).sort((a, b) => fits[a] - fits[b]);
            const next = [];
            for (let e = 0; e < ELITES; e++) next.push(pop[ranked[e]]);
            while (next.length < pop.length) {
                const p1 = pop[this._tournament(fits, 3)];
                const p2 = pop[this._tournament(fits, 3)];
                const order = this._crossover(p1.order, p2.order);
                const rots = this._crossoverRots(p1.rots, p2.rots);
                next.push(this._mutate({ order, rots }));
            }
            pop = next;
            fits = pop.map((o, i) => {
                // Elites carry their fitness over without re-evaluation.
                if (i < ELITES) return fits[ranked[i]];
                const r = this._evaluate(o, ctx);
                if (progressHandler) progressHandler(++evalsDone, totalEvals);
                return r.fitness;
            });
        }

        const ranked = pop.map((o, i) => i).sort((a, b) => fits[a] - fits[b]);
        const bestInd = pop[ranked[0]];
        const best = this._evaluate(bestInd, ctx);
        if (progressHandler) progressHandler(++evalsDone, totalEvals);

        this.performanceStats = {
            generations: this.generations,
            evaluations: evalsDone,
            collisionChecks: ctx.stats.collisionChecks,
            bestFitness: best.fitness
        };
        this.lastPlacements = best.placements;
        // Winner chromosome for the next infinite-loop iteration.
        this.bestOrder = { order: bestInd.order.slice(), rots: bestInd.rots.slice() };

        const endTime = performance.now();
        console.log('NFP-GA Performance:', {
            time: ((endTime - startTime).toFixed(2) + 'ms'),
            partsProcessed: parts.length,
            unplaced: best.unplaced,
            unplacedArea: (best.unplacedArea / (GEOM_SCALE * GEOM_SCALE)).toFixed(2) + ' mm²',
            bestFitness: best.fitness / (GEOM_SCALE * GEOM_SCALE),
            ...this.performanceStats
        });

        return best.placements;
    }

    // Partial renesting and compaction reuse the proven NFP2 code paths
    // unchanged; only the full-nest search is genetic.
    renest(parts, sheet, progressHandler, gridSize) {
        const dec = new NFP2();
        dec.spacing = this.spacing;
        dec.allowFlip = this.allowFlip;
        dec.gridSize = this.gridSize;
        dec.lastPlacements = this.lastPlacements;
        const out = dec.renest(parts, sheet, progressHandler, gridSize);
        this.lastPlacements = dec.lastPlacements;
        return out;
    }

    compactSolution(placements, sheet) {
        const dec = new NFP2();
        dec.spacing = this.spacing;
        dec.allowFlip = this.allowFlip;
        dec.gridSize = this.gridSize;
        return dec.compactSolution(placements, sheet);
    }

    checkDragPlacement(part, x, y, placedParts, sheet) {
        const dec = new NFP2();
        return dec.checkDragPlacement(part, x, y, placedParts, sheet);
    }

    calculateTotalBounds(parts) {
        if (parts.length === 0) return { x: 0, y: 0, width: 10, height: 10 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const part of parts) {
            if (part.lcolor === '#00ff00') continue;
            const b = part.getBounds();
            minX = Math.min(minX, b.x);
            minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.width);
            maxY = Math.max(maxY, b.y + b.height);
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    getPerformanceStats() { return this.performanceStats; }
}
