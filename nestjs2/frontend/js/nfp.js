class SpatialHash {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.grid = new Map();
        this.queryId = 0;
        this.resultArray = [];
    }

    add(part) {
        const bounds = part.getBounds();
        const startX = Math.floor(bounds.x / this.cellSize);
        const endX = Math.floor((bounds.x + bounds.width) / this.cellSize);
        const startY = Math.floor(bounds.y / this.cellSize);
        const endY = Math.floor((bounds.y + bounds.height) / this.cellSize);

        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                // Use a numeric key: pack x and y into a 32-bit integer
                // This is much faster than string keys.
                const key = (x << 16) | (y & 0xFFFF);
                let cell = this.grid.get(key);
                if (cell === undefined) {
                    cell = [];
                    this.grid.set(key, cell);
                }
                cell.push(part);
            }
        }
    }

    remove(part) {
        const bounds = part.getBounds();
        const startX = Math.floor(bounds.x / this.cellSize);
        const endX = Math.floor((bounds.x + bounds.width) / this.cellSize);
        const startY = Math.floor(bounds.y / this.cellSize);
        const endY = Math.floor((bounds.y + bounds.height) / this.cellSize);

        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                const key = (x << 16) | (y & 0xFFFF);
                let cell = this.grid.get(key);
                if (cell !== undefined) {
                    const index = cell.indexOf(part);
                    if (index !== -1) {
                        cell.splice(index, 1);
                    }
                }
            }
        }
    }

    query(bx, by, bw, bh) {
        const startX = Math.floor(bx / this.cellSize);
        const endX = Math.floor((bx + bw) / this.cellSize);
        const startY = Math.floor(by / this.cellSize);
        const endY = Math.floor((by + bh) / this.cellSize);

        const results = this.resultArray;
        results.length = 0;
        const qId = ++this.queryId;

        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                const key = (x << 16) | (y & 0xFFFF);
                const cell = this.grid.get(key);
                if (cell !== undefined) {
                    const cellLen = cell.length;
                    for (let i = 0; i < cellLen; i++) {
                        const part = cell[i];
                        if (part._lastQueryId !== qId) {
                            part._lastQueryId = qId;
                            results.push(part);
                        }
                    }
                }
            }
        }
        return results;
    }
}

class NFP {
    constructor() {
        this.spacing = 0;
        this.allowFlip = true;
        this.gridSize = 10;
        this.performanceStats = {
            collisionChecks: 0
        };
        // Last full-nest placements, reused as fixed obstacles during renest().
        this.lastPlacements = [];
    }

    setSpacing(spacing) {
        this.spacing = spacing * GEOM_SCALE;
        this.gridSize = spacing > 0 ? spacing * GEOM_SCALE : GEOM_SCALE;
    }

    setAllowFlip(allowFlip) {
        this.allowFlip = allowFlip;
    }

    _checkPlacementConflicts(part, bx, by, bw, bh, placedParts, usePart = true, checkchild = true) {
        // query() returns an internal reusable array — used read-only here, no copy needed.
        // _initialPlacements are always seeded into the spatial hash, and overlapping bboxes
        // provably share a grid cell, so no fallback loop is needed.
        const baseList = (placedParts instanceof SpatialHash)
            ? placedParts.query(bx, by, bw, bh)
            : placedParts;

        const stats = this.performanceStats;
        const len = baseList.length;
        for (let i = 0; i < len; i++) {
            const placedPart = baseList[i];
            const pb = placedPart._cachedBounds || placedPart.getBounds();
            if (bx > pb.x + pb.width || bx + bw < pb.x ||
                by > pb.y + pb.height || by + bh < pb.y) {
                continue;
            }
            if (stats) stats.collisionChecks++;
            if (placedPart.lcolor === "#00ff00") {
                if (GeometryUtil.polyOutside(part, placedPart)) return true;
            } else if (usePart) {
                if (part.polygonsIntersect(placedPart, checkchild)) return true;
            } else {
                if (GeometryUtil.polygonsIntersect(part, placedPart)) return true;
            }
        }
        return false;
    }

    // Tests `variant` at offset (px,py) WITHOUT cloning it, returning a score
    // number, or null when the position is invalid/conflicts. The caller keeps
    // only the best variant and clones it once after the cell loop, so the
    // expensive clone never happens for discarded candidates.
    tryPlacement(variant, px, py, placedParts, placedParts2, sheet, checkchild = true) {
        // Bounds of the translated clone = cached variant bounds + offset.
        const vb = variant.getBounds();
        const bx = vb.x + px;
        const by = vb.y + py;
        const bw = vb.width;
        const bh = vb.height;
        if (!this.hascustomsheet) {
            if (bx < 0 || by < 0 || bx + bw > sheet.width || by + bh > sheet.height) {
                return null;
            }
        }

        // Always reset so variant.insideBonus never holds a stale value from a
        // previous candidate, even on the no-candidate fast path.
        variant.insideBonus = 0;
        let insideBonus = 0;
        const cand1 = placedParts ? this._collectCandidates(bx, by, bw, bh, placedParts) : null;
        const cand2 = this._collectCandidates(bx, by, bw, bh, placedParts2);
        if (cand1 !== null || cand2 !== null) {
            // NOTE: polygonsIntersectAt may raise variant.insideBonus as a side
            // effect (variant fits inside a hole), so read it after the checks.
            if (cand1 !== null && this._conflictsWithList(variant, px, py, cand1, true, checkchild)) return null;
            if (cand2 !== null && this._conflictsWithList(variant, px, py, cand2, false, true)) return null;
            insideBonus = variant.insideBonus;
        }

        const heightScore = by + bh * 2;
        const complexityPenalty = variant.paths.length > 1 ? 1000 * GEOM_SCALE : 0;
        return (heightScore * 2 + complexityPenalty) - insideBonus;
    }

    // Collect candidates whose bounding boxes overlap (bx,by,bw,bh).
    // Returns null when nothing overlaps (fast path: no array allocated).
    _collectCandidates(bx, by, bw, bh, placedParts) {
        if (!placedParts) return null;
        const baseList = (placedParts instanceof SpatialHash)
            ? placedParts.query(bx, by, bw, bh)
            : placedParts;

        let result = null;
        const len = baseList.length;
        for (let i = 0; i < len; i++) {
            const placedPart = baseList[i];
            // Placed parts in the hash always have cached bounds (they were
            // getBounds()'d when added); read the cache directly to skip the
            // method call in this very hot loop.
            const pb = placedPart._cachedBounds || placedPart.getBounds();
            if (bx > pb.x + pb.width || bx + bw < pb.x ||
                by > pb.y + pb.height || by + bh < pb.y) {
                continue;
            }
            if (result === null) result = [];
            result.push(placedPart);
        }
        return result;
    }

    // Exact geometric collision test of `variant` (offset by px,py) against a
    // bbox-prefiltered list. Points are translated on the fly — no clone.
    _conflictsWithList(variant, px, py, list, usePart, checkchild) {
        const stats = this.performanceStats;
        for (let i = 0; i < list.length; i++) {
            const placedPart = list[i];
            if (stats) stats.collisionChecks++;
            if (placedPart.lcolor === "#00ff00") {
                if (GeometryUtil.polyOutsideAt(variant, px, py, placedPart)) return true;
            } else if (usePart) {
                if (variant.polygonsIntersectAt(px, py, placedPart, checkchild)) return true;
            } else {
                if (GeometryUtil.polygonsIntersectAt(variant, px, py, placedPart)) return true;
            }
        }
        return false;
    }

    findBestPosition(parts, sheet, progressHandler, gridSize, initialPlacements = []) {
        const startTime = performance.now();
        // gridSize is already scaled coming from main thread setSpacing or Worker
        const scaledGridSize = gridSize;
        const scaledSheet = {
            width: sheet.width * GEOM_SCALE,
            height: sheet.height * GEOM_SCALE
        };
        // Store initial placements for explicit collision checking fallback
        let bestPlacementsAll = [...initialPlacements];
        const totalParts = parts.length;
        this.hascustomsheet = false;

        // Build a Set of originIndexes for O(1) lookup when filtering bestPlacements
        this._initialIndexSet = initialPlacements.length > 0
            ? new Set(initialPlacements.map(p => p.originIndex))
            : null;

        // Reset stats
        this.performanceStats = {
            collisionChecks: 0
        };

        // Initialize SpatialHash
        // Use a cell size relative to sheet size or fixed. 
        // 50 is a reasonable default, or derived from gridSize
        const hashCellSize = Math.max(50 * GEOM_SCALE, scaledGridSize * 5);
        this.spatialHash = new SpatialHash(hashCellSize);

        // Add initial placements to spatial hash
        initialPlacements.forEach(p => this.spatialHash.add(p));

        // Full nest (Start nesting) clears all placement flags.
        parts.forEach(p => { p.placed = false; });

        // Run the shared placement loop (also used by renest()).
        this._runPlacementPasses(parts, bestPlacementsAll, scaledSheet, scaledGridSize, progressHandler, totalParts);

        const endTime = performance.now();
        console.log(`Grid NFP Performance:`, {
            time: `${(endTime - startTime).toFixed(2)}ms`,
            partsProcessed: totalParts,
            ...this.performanceStats
        });

        this.lastPlacements = bestPlacementsAll;
        return bestPlacementsAll;
    }

    /**
     * Shared core placement loop. Places every part in `parts` whose `placed`
     * flag is false, using the already-placed parts and the seeded spatial hash
     * as fixed obstacles. Used by both findBestPosition (full nest) and
     * renest() (partial re-placement of marked parts).
     *
     * NOTE: this method intentionally does NOT reset part.placed flags. The
     * caller decides which parts should be re-placed (placed=false).
     */
    _runPlacementPasses(parts, bestPlacementsAll, scaledSheet, scaledGridSize, progressHandler, totalParts) {
        // Pre-calculate and cache part areas and bounds
        const partData = new Map();
        let maxArea = 0;
        let minArea = Infinity;

        for (const part of parts) {
            // Fixed (already placed) parts act as obstacles; skip them here.
            if (part.placed) continue;

            if (part.lcolor === "#00ff00") {
                const sheetVariant = part.variants[0];
                sheetVariant.align();
                const bounds = sheetVariant.getBounds();
                scaledSheet.width = bounds.width;
                scaledSheet.height = bounds.height;
                this.hascustomsheet = true;
                bestPlacementsAll.push(sheetVariant.clone());
                this.spatialHash.add(bestPlacementsAll[bestPlacementsAll.length - 1]);
                bestPlacementsAll.center = { x: bounds.x, y: bounds.y };
                continue;
            }

            const variantData = part.variants[0];
            const bounds = variantData.getBounds();
            const longestSide = Math.max(bounds.width, bounds.height);
            const area = longestSide * longestSide;
            partData.set(part, {
                area,
                bounds,
                aspectRatio: bounds.width / bounds.height
            });

            maxArea = Math.max(maxArea, area);
            minArea = Math.min(minArea, area);
        }

        const areaRange = maxArea - minArea;
        const thresholds = [
            minArea + areaRange * 0.75,
            minArea + areaRange * 0.5,
            minArea + areaRange * 0.25,
            minArea
        ];

        const passParts = [[], [], [], []];
        for (const part of parts) {
            if (part.lcolor === "#00ff00" || part.placed) continue;
            const data = partData.get(part);
            let passIndex;
            if (data.area > thresholds[0]) passIndex = 0;
            else if (data.area > thresholds[1]) passIndex = 1;
            else if (data.area > thresholds[2]) passIndex = 2;
            else passIndex = 3;
            passParts[passIndex].push(part);
        }

        passParts.forEach(pass => {
            pass.sort((a, b) => {
                const aData = partData.get(a);
                const bData = partData.get(b);
                const scoreA = aData.area * Math.abs(1 - aData.aspectRatio);
                const scoreB = bData.area * Math.abs(1 - bData.aspectRatio);
                const noise = (Math.random() - 0.5) * (scoreA + scoreB) * 0.1;
                return scoreB - scoreA + noise;
            });
        });

        for (let pass = 0; pass < 4; pass++) {
            let currentParts = passParts[pass];
            if (currentParts.length === 0) continue;

            const dynamicGridSize = Math.floor(Math.max(scaledGridSize, (scaledGridSize * Math.sqrt(minArea) / GEOM_SCALE) * 0.01) * (4 - pass));

            // Track unplaced parts so we can stop early once everything fits.
            let unplacedCount = currentParts.length;
            let allPlaced = false;

            for (let y = 0; y < scaledSheet.height; y += dynamicGridSize) {
                const intersectionPoints = [];
                let sheetleftright = [];
                const rowParts = this.spatialHash.query(0, y, scaledSheet.width, Math.max(GEOM_SCALE, dynamicGridSize));
                for (const placedPart of rowParts) {
                    const intersections = GeometryUtil.getHorizontalIntersections(placedPart, y);
                    if (placedPart.lcolor === "#00ff00") {
                        sheetleftright = intersections;
                        sheetleftright.sort((a, b) => a - b);
                    } else {
                        intersectionPoints.push(...intersections);
                    }
                }
                intersectionPoints.sort((a, b) => a - b);

                for (let x = 0; x < scaledSheet.width; x += dynamicGridSize) {
                    if (sheetleftright.length === 2 && (x < sheetleftright[0] || x > sheetleftright[1])) continue;

                    let isValidPosition = true;
                    for (let i = 0; i < intersectionPoints.length; i += 2) {
                        const start = intersectionPoints[i];
                        const end = intersectionPoints[i + 1];
                        if (x >= start && x <= end) {
                            isValidPosition = false;
                            x = Math.ceil(end);
                            break;
                        }
                    }
                    if (!isValidPosition) continue;

                    let bestVariant = null;
                    let bestScore = Infinity;
                    let bestPart = null;

                    // Compact the pass list once most of it is placed so the
                    // per-cell scan doesn't keep skipping dead entries.
                    if (unplacedCount < (currentParts.length >> 1)) {
                        currentParts = currentParts.filter(p => !p.placed);
                        passParts[pass] = currentParts;
                    }

                    const currentPartsLength = currentParts.length;
                    const shuffleStart = Math.floor(Math.random() * currentPartsLength);
                    for (let j = 0; j < currentPartsLength; j++) {
                        const part = currentParts[(j + shuffleStart) % currentPartsLength];
                        if (part.placed) continue;
                        const variantCount = part.variants.length;
                        const variantStart = Math.floor(Math.random() * variantCount);
                        for (let i = 0; i < variantCount; i++) {
                            const variant = part.variants[(i + variantStart) % variantCount];
                            const score = this.tryPlacement(
                                variant, x, y,
                                null, this.spatialHash,
                                scaledSheet, pass > 1
                            );
                            if (score !== null && score < bestScore) {
                                bestScore = score;
                                bestVariant = variant;
                                bestPart = part;
                            }
                        }
                    }

                    if (bestPart && bestVariant) {
                        const placedVariant = bestVariant.clone(x, y);
                        placedVariant.insideBonus = bestVariant.insideBonus || 0;
                        placedVariant.x = x;
                        placedVariant.y = y;
                        placedVariant.childIndex = bestPart.childIndex;
                        bestPart.placed = true;
                        // Add to the hash immediately so the very next cell's
                        // candidate query sees it (and it can't overlap).
                        const initIndexSet = this._initialIndexSet;
                        if (!initIndexSet || !initIndexSet.has(placedVariant.originIndex)) {
                            bestPlacementsAll.push(placedVariant);
                            this.spatialHash.add(placedVariant);
                        }
                        if (--unplacedCount === 0) { allPlaced = true; break; }
                    }
                }
                if (progressHandler) {
                    const placedCount = bestPlacementsAll.length - (this.hascustomsheet ? 1 : 0);
                    progressHandler(placedCount, totalParts);
                }
                if (allPlaced) break;
            }
        }
    }

    /**
     * Partial re-nesting: re-place only the parts whose `placed` flag is false,
     * using the last full-nest result (this.lastPlacements) as fixed obstacles.
     * Does NOT reset part positions — the caller marks exactly the parts to move.
     */
    renest(parts, sheet, progressHandler, gridSize) {
        const startTime = performance.now();
        const scaledGridSize = gridSize;
        const scaledSheet = {
            width: sheet.width * GEOM_SCALE,
            height: sheet.height * GEOM_SCALE
        };
        const totalParts = parts.length;

        const markedSet = new Set();
        for (const p of parts) {
            if (p.placed === false) markedSet.add(p.originIndex);
        }

        const fixedPlacements = (this.lastPlacements || []).filter(p => !markedSet.has(p.originIndex));

        this.performanceStats = { collisionChecks: 0 };
        this._initialPlacements = fixedPlacements;
        this._initialIndexSet = new Set(fixedPlacements.map(p => p.originIndex));

        const hashCellSize = Math.max(50 * GEOM_SCALE, scaledGridSize * 5);
        this.spatialHash = new SpatialHash(hashCellSize);
        fixedPlacements.forEach(p => this.spatialHash.add(p));

        for (const p of fixedPlacements) {
            if (p.lcolor === "#00ff00") {
                const b = p.getBounds();
                scaledSheet.width = b.width;
                scaledSheet.height = b.height;
                this.hascustomsheet = true;
                break;
            }
        }

        const bestPlacementsAll = fixedPlacements.slice();
        this._runPlacementPasses(parts, bestPlacementsAll, scaledSheet, scaledGridSize, progressHandler, totalParts);

        const endTime = performance.now();
        console.log(`Grid NFP Renest Performance:`, {
            time: `${(endTime - startTime).toFixed(2)}ms`,
            partsProcessed: totalParts,
            rePlaced: markedSet.size,
            ...this.performanceStats
        });

        this.lastPlacements = bestPlacementsAll;
        return bestPlacementsAll;
    }

    getPerformanceStats() {
        return this.performanceStats;
    }

    compactSolution(placements, sheet) {
        // Prepare initial hash state
        // Fallback cell size when compactSolution is called without a prior
        // findBestPosition run on this NFP instance (e.g. after nesting was
        // executed inside a Web Worker).
        const hashCellSize = (this.spatialHash && this.spatialHash.cellSize) ||
            Math.max(50 * GEOM_SCALE, (this.gridSize || 10) * 5);
        this.spatialHash = new SpatialHash(hashCellSize);
        placements.forEach(p => this.spatialHash.add(p));

        const collisionCheck = (part, phase) => {
            if (part.lcolor === "#00ff00") return false; // Don't move the sheet

            if (phase === 'start') {
                this.spatialHash.remove(part);
                return false;
            }
            if (phase === 'end') {
                this.spatialHash.add(part);
                return false;
            }

            const b = part.getBounds();
            // Check sheet boundaries
            if (b.x < 0 || b.y < 0 || b.x + b.width > sheet.width * GEOM_SCALE || b.y + b.height > sheet.height * GEOM_SCALE) {
                return true;
            }

            // Check overlap with other parts
            return this._checkPlacementConflicts(part, b.x, b.y, b.width, b.height, this.spatialHash);
        };

        const moves = GeometryUtil.compactLayout(placements, collisionCheck);
        console.log(`Grid Compaction complete. Multi-pass moves: ${moves}`);

        return placements;
    }

    calculateTotalBounds(parts) {
        if (parts.length === 0) return { x: 0, y: 0, width: 10, height: 10 };

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let hasValidPart = false;

        for (const part of parts) {
            if (part.lcolor === "#00ff00") continue; // Skip sheet parts
            const bounds = part.getBounds();
            if (bounds.width === 0 || bounds.height === 0) continue; // Skip empty bounds

            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
            hasValidPart = true;
        }

        if (!hasValidPart) {
            return { x: 0, y: 0, width: 10, height: 10 };
        }

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    checkDragPlacement(part, x, y, placedParts, sheet) {
        const scaledSheet = {
            width: sheet.width * GEOM_SCALE,
            height: sheet.height * GEOM_SCALE
        };

        const bounds = part.getBounds();
        const bx = bounds.x;
        const by = bounds.y;
        const bw = bounds.width;
        const bh = bounds.height;

        // Allow dragging outside the sheet so Renesting can work later.

        for (const placed of placedParts) {
            if (placed === part) continue;
            
            // If the placed part is a "sheet hole" (green), we must stay INSIDE it
            if (placed.lcolor === "#00ff00") {
                if (GeometryUtil.polyOutside(part, placed)) {
                    return false;
                }
                continue;
            }

            // Otherwise, check for normal collisions
            const pb = placed.getBounds();
            if (bx > pb.x + pb.width || bx + bw < pb.x ||
                by > pb.y + pb.height || by + bh < pb.y) {
                continue;
            }
            if (part.polygonsIntersect(placed, true)) {
                return false;
            }
        }
        return true;
    }
}
