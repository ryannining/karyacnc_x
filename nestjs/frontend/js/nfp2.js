/**
 * True NFP (No-Fit Polygon) Algorithm Implementation
 * This provides proper geometric placement using NFP boundary sampling
 * instead of brute force collision detection
 */

class NFP2SpatialHash {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.grid = new Map();
    }

    add(part) {
        const bounds = part.getBounds();
        const startX = Math.floor(bounds.x / this.cellSize);
        const endX = Math.floor((bounds.x + bounds.width) / this.cellSize);
        const startY = Math.floor(bounds.y / this.cellSize);
        const endY = Math.floor((bounds.y + bounds.height) / this.cellSize);

        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                const key = (x << 16) | (y & 0xFFFF);
                if (!this.grid.has(key)) {
                    this.grid.set(key, []);
                }
                this.grid.get(key).push(part);
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
                const cell = this.grid.get(key);
                if (cell) {
                    const idx = cell.indexOf(part);
                    if (idx !== -1) cell.splice(idx, 1);
                }
            }
        }
    }

    query(bx, by, bw, bh) {
        const startX = Math.floor(bx / this.cellSize);
        const endX = Math.floor((bx + bw) / this.cellSize);
        const startY = Math.floor(by / this.cellSize);
        const endY = Math.floor((by + bh) / this.cellSize);

        const parts = new Set();
        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                const key = (x << 16) | (y & 0xFFFF);
                const cell = this.grid.get(key);
                if (cell) {
                    for (const part of cell) {
                        parts.add(part);
                    }
                }
            }
        }
        return parts;
    }
}

/**
 * A proxy class to represent a translated Path without cloning all points.
 */
class TranslatedPathProxy {
    constructor(sourcePart, dx, dy) {
        this.source = sourcePart;
        this.dx = dx;
        this.dy = dy;
        const b = sourcePart.getBounds();
        this._bounds = {
            x: b.x + dx,
            y: b.y + dy,
            width: b.width,
            height: b.height
        };
        this._paths = null;
    }

    getBounds() { return this._bounds; }

    get paths() {
        if (!this._paths) {
            this._paths = this.source.paths.map(path =>
                path.map(p => ({ x: p.x + this.dx, y: p.y + this.dy }))
            );
        }
        return this._paths;
    }

    get lcolor() { return this.source.lcolor; }
}

class NFP2 {
    constructor() {
        this.spacing = 0;
        this.allowFlip = true;
        this.performanceStats = {
            boundaryPointsTested: 0,
            collisionAvoided: 0,
            collisionChecks: 0
        };
        this.spatialHash = null;
        this.gridSize = 10;
    }

    setSpacing(spacing) {
        this.spacing = spacing * GEOM_SCALE;
        this.gridSize = spacing > 0 ? spacing * GEOM_SCALE : GEOM_SCALE;
    }
    setAllowFlip(allowFlip) { this.allowFlip = allowFlip; }

    findBestPosition(parts, sheet, progressHandler, gridSize) {
        const startTime = performance.now();
        // gridSize is already scaled
        const scaledGridSize = gridSize;
        const scaledSheet = {
            width: sheet.width * GEOM_SCALE,
            height: sheet.height * GEOM_SCALE
        };
        this.performanceStats = {
            boundaryPointsTested: 0,
            collisionAvoided: 0,
            collisionChecks: 0
        };

        const cellSize = Math.max(50 * GEOM_SCALE, scaledGridSize * 5);
        this.spatialHash = new NFP2SpatialHash(cellSize);

        let bestPlacementsAll = [];
        const totalParts = parts.length;
        this.hascustomsheet = false;

        // Reset and extract sheet
        for (let part of parts) {
            part.placed = false;
            if (part.lcolor === "#00ff00") {
                const sheetVariant = part.variants[0];
                sheetVariant.align();
                const bounds = sheetVariant.getBounds();
                scaledSheet.width = bounds.width;
                scaledSheet.height = bounds.height;
                this.hascustomsheet = true;
                const placedSheet = sheetVariant.clone();
                bestPlacementsAll.push(placedSheet);
                this.spatialHash.add(placedSheet);
                part.placed = true;
            }
        }

        const remainingParts = parts.filter(part => !part.placed);

        // Pre-calculate part data for sorting
        const partData = new Map();
        let maxArea = 0, minArea = Infinity;

        remainingParts.forEach(part => {
            const b = part.variants[0].getBounds();
            const longestSide = Math.max(b.width, b.height);
            const area = longestSide * longestSide;
            const data = {
                area,
                aspectRatio: b.width / b.height
            };
            partData.set(part, data);
            maxArea = Math.max(maxArea, area);
            minArea = Math.min(minArea, area);
        });

        const areaRange = maxArea - minArea;
        const thresholds = [
            minArea + areaRange * 0.75,
            minArea + areaRange * 0.5,
            minArea + areaRange * 0.25,
            minArea
        ];

        // Process in 4 passes like nfp.js to ensure large parts are prioritized correctly
        for (let pass = 0; pass < 4; pass++) {
            const passParts = remainingParts.filter(part => {
                if (part.placed) return false;
                const area = partData.get(part).area;
                if (pass === 0) return area >= thresholds[0];
                if (pass === 1) return area >= thresholds[1];
                if (pass === 2) return area >= thresholds[2];
                return true;
            });

            passParts.sort((a, b) => {
                const aD = partData.get(a);
                const bD = partData.get(b);
                const scoreA = aD.area * Math.abs(1 - aD.aspectRatio);
                const scoreB = bD.area * Math.abs(1 - bD.aspectRatio);
                const noise = (Math.random() - 0.5) * (scoreA + scoreB) * 0.1; // 10% noise
                return scoreB - scoreA + noise;
            });

            for (let part of passParts) {
                if (part.placed) continue;
                const bestPlacement = this.findBestNFPPlacement(part, bestPlacementsAll, scaledSheet, scaledGridSize);
                if (bestPlacement) {
                    bestPlacement.childIndex = part.childIndex;
                    bestPlacementsAll.push(bestPlacement);
                    this.spatialHash.add(bestPlacement);
                    part.placed = true;
                }
                if (progressHandler) progressHandler(bestPlacementsAll.length, totalParts);
            }
        }

        const endTime = performance.now();
        console.log(`NFP2 Performance:`, {
            time: `${(endTime - startTime).toFixed(2)}ms`,
            partsProcessed: remainingParts.length,
            ...this.performanceStats
        });

        return bestPlacementsAll;
    }

    findBestNFPPlacement(part, placedPartsAll, sheet, gridSize) {
        const sheetParts = placedPartsAll.filter(p => p.lcolor === "#00ff00");
        let bestPlacement = null;
        let bestScore = Infinity;

        // 1. Scanline-based search (The Speed/Compactness from nfp.js)
        // gridSize is already scaled
        const yStep = Math.max(4 * GEOM_SCALE, gridSize);
        const xStep = Math.max(4 * GEOM_SCALE, gridSize);

        for (let y = 0; y < sheet.height; y += yStep) {
            const intersections = [];
            let sheetRange = [0, sheet.width];

            for (const placed of placedPartsAll) {
                const pts = GeometryUtil.getHorizontalIntersections(placed, y);
                if (placed.lcolor === "#00ff00") {
                    if (pts.length >= 2) {
                        pts.sort((a, b) => a - b);
                        sheetRange = [pts[0], pts[pts.length - 1]];
                    }
                } else {
                    intersections.push(...pts);
                }
            }
            intersections.sort((a, b) => a - b);

            for (let x = sheetRange[0]; x <= sheetRange[1]; x += xStep) {
                let insideAnyPart = false;
                for (let i = 0; i < intersections.length; i += 2) {
                    if (x >= intersections[i] && x <= intersections[i + 1]) {
                        x = Math.ceil(intersections[i + 1]);
                        insideAnyPart = true;
                        break;
                    }
                }
                if (insideAnyPart) continue;

                for (let variant of part.variants) {
                    const b = variant.getBounds();
                    const dx = x - b.x;
                    const dy = y - b.y;

                    if (x < 0 || y < 0 || x + b.width > sheet.width || y + b.height > sheet.height) continue;

                    const score = (y + b.height * 2) * 2 + (x * 0.1) + (variant.paths.length > 1 ? 1000 * GEOM_SCALE : 0);
                    if (score > bestScore + 100) continue;

                    variant.insideBonus = 0;
                    if (!this.checkCollisions(variant, dx, dy, sheetParts)) {
                        const finalScore = score - (variant.insideBonus || 0);
                        if (finalScore < bestScore) {
                            bestScore = finalScore;
                            bestPlacement = variant.clone(dx, dy);
                            if (variant.insideBonus > 5000) return bestPlacement;
                        }
                    }
                }
            }
            // Stop evaluation if we have a very solid result at the top
            if (bestPlacement && y > sheet.height / 3) break;
        }

        // 2. Vertex Refinement (The Precision from NFP)
        // If we haven't found a perfect top spot, try one fast pass through NFP vertices
        if (!bestPlacement || bestScore > (sheet.height * 0.5)) {
            const edgeCandidates = this.getCandidatePositions(part.variants[0], placedPartsAll, sheet, gridSize);
            for (let pos of edgeCandidates) {
                const b = part.variants[0].getBounds();
                const score = ((pos.y + b.y) + b.height * 2) * 2 + ((pos.x + b.x) * 0.1);
                if (score < bestScore) {
                    if (!this.checkCollisions(part.variants[0], pos.x, pos.y, sheetParts)) {
                        bestPlacement = part.variants[0].clone(pos.x, pos.y);
                        bestScore = score;
                    }
                }
            }
        }

        return bestPlacement;
    }

    getCandidatePositions(part, placedParts, sheet, gridSize) {
        const positions = [];
        const pb = part.getBounds();
        const pW = pb.width;
        const pH = pb.height;

        // 1. Initial start points along the top and left to encourage top-left packing
        const startStep = gridSize * 2;
        for (let x = 0; x <= sheet.width; x += startStep) {
            positions.push({ x: x - pb.x, y: -pb.y });
        }
        for (let y = 0; y <= sheet.height / 2; y += startStep) {
            positions.push({ x: -pb.x, y: y - pb.y });
        }

        if (placedParts.length === 0) return positions;

        const seen = new Set();
        const addPos = (x, y) => {
            const k = `${Math.round(x)},${Math.round(y)}`;
            if (!seen.has(k)) {
                positions.push({ x, y });
                seen.add(k);
            }
        };

        // Pre-sample vertices from the new part to try vertex-to-vertex alignment
        const newPartPath = part.paths[0];
        const vSamples = [];

        // Use corners + center-edge points. Add more for "Maximum Packing" mode.
        vSamples.push({ x: pb.x, y: pb.y });
        vSamples.push({ x: pb.x + pW, y: pb.y });
        vSamples.push({ x: pb.x + pW, y: pb.y + pH });
        vSamples.push({ x: pb.x, y: pb.y + pH });
        vSamples.push({ x: pb.x + pW / 2, y: pb.y });
        vSamples.push({ x: pb.x, y: pb.y + pH / 2 });

        if (this.gridSize < 3) {
            // Maximum Packing: add more mid-points
            vSamples.push({ x: pb.x + pW / 2, y: pb.y + pH });
            vSamples.push({ x: pb.x + pW, y: pb.y + pH / 2 });
            vSamples.push({ x: pb.x + pW / 2, y: pb.y + pH / 2 });
        }

        for (const placed of placedParts) {
            if (placed.lcolor === "#00ff00") continue; // Sheets handled by scanline

            for (const path of placed.paths) {
                const len = path.length;
                if (len < 2) continue;

                // Dynamic vertex sampling based on gridSize (Smaller = More Precise)
                const vSkip = Math.max(1, Math.floor(gridSize / (2 * GEOM_SCALE)));
                for (let i = 0; i < len; i += vSkip) {
                    const pt = path[i];
                    for (const v of vSamples) {
                        addPos(pt.x - v.x, pt.y - v.y);
                    }
                }
            }
        }

        return positions.filter(p => {
            const bx = p.x + pb.x;
            const by = p.y + pb.y;
            return bx >= 0 && bx + pb.width <= sheet.width &&
                by >= 0 && by + pb.height <= sheet.height;
        });
    }

    checkCollisions(variant, dx, dy, sheetParts) {
        const vBounds = variant.getBounds();
        const bx = vBounds.x + dx;
        const by = vBounds.y + dy;
        const bw = vBounds.width;
        const bh = vBounds.height;

        let proxy = null;
        // 1. Sheet constraints
        for (const s of sheetParts) {
            this.performanceStats.collisionChecks++;
            if (!proxy) proxy = new TranslatedPathProxy(variant, dx, dy);
            if (GeometryUtil.polyOutside(proxy, s)) return true;
        }

        const candidates = this.spatialHash.query(bx, by, bw, bh);
        if (!candidates || candidates.size === 0) return false;

        // 2. Part intersections
        for (const placed of candidates) {
            if (placed.lcolor === "#00ff00") continue;

            const pb = placed.getBounds();
            if (bx > pb.x + pb.width || bx + bw < pb.x ||
                by > pb.y + pb.height || by + bh < pb.y) {
                continue;
            }

            this.performanceStats.collisionChecks++;
            if (!proxy) proxy = new TranslatedPathProxy(variant, dx, dy);
            if (GeometryUtil.polygonsIntersect(proxy, placed, true)) return true;
            if (proxy.insideBonus) variant.insideBonus = Math.max(variant.insideBonus || 0, proxy.insideBonus);
        }

        return false;
    }

    calculateTotalBounds(parts) {
        if (parts.length === 0) return { x: 0, y: 0, width: 10, height: 10 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const part of parts) {
            if (part.lcolor === "#00ff00") continue;
            const b = part.getBounds();
            minX = Math.min(minX, b.x);
            minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.width);
            maxY = Math.max(maxY, b.y + b.height);
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    getPerformanceStats() { return this.performanceStats; }

    compactSolution(placements, sheet) {
        const cellSize = this.spatialHash.cellSize;
        const sheetParts = placements.filter(p => p.lcolor === "#00ff00");

        const collisionCheck = (part, phase) => {
            if (part.lcolor === "#00ff00") return false;

            if (phase === 'start') {
                this.spatialHash.remove(part);
                return false;
            }
            if (phase === 'end') {
                this.spatialHash.add(part);
                return false;
            }

            const b = part.getBounds();
            if (b.x < 0 || b.y < 0 || b.x + b.width > sheet.width * GEOM_SCALE || b.y + b.height > sheet.height * GEOM_SCALE) {
                return true;
            }

            return this.checkCollisions(part, 0, 0, sheetParts);
        };

        const moves = GeometryUtil.compactLayout(placements, collisionCheck);
        console.log(`NFP2 Compaction done. Multi-pass moves: ${moves}`);
        return placements;
    }

    calculateTotalBounds(parts) {
        if (parts.length === 0) return { x: 0, y: 0, width: 10, height: 10 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const part of parts) {
            if (part.lcolor === "#00ff00") continue;
            const b = part.getBounds();
            minX = Math.min(minX, b.x);
            minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.width);
            maxY = Math.max(maxY, b.y + b.height);
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
}