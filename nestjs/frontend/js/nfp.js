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
    }

    setSpacing(spacing) {
        this.spacing = spacing * GEOM_SCALE;
        this.gridSize = spacing > 0 ? spacing * GEOM_SCALE : GEOM_SCALE;
    }

    setAllowFlip(allowFlip) {
        this.allowFlip = allowFlip;
    }

    _checkPlacementConflicts(part, bx, by, bw, bh, placedParts, usePart = true, checkchild = true) {
        let partsToCheck;
        if (placedParts instanceof SpatialHash) {
            partsToCheck = placedParts.query(bx, by, bw, bh);
        } else {
            partsToCheck = placedParts;
        }

        const len = partsToCheck.length;
        for (let i = 0; i < len; i++) {
            const placedPart = partsToCheck[i];
            const pb = placedPart.getBounds();

            // Skip if bounding boxes don't overlap
            if (bx > pb.x + pb.width || bx + bw < pb.x ||
                by > pb.y + pb.height || by + bh < pb.y) {
                continue;
            }

            // Geometric intersection check reached
            if (this.performanceStats) this.performanceStats.collisionChecks++;

            // Check for intersection
            const isSheet = placedPart.lcolor === "#00ff00";
            if (isSheet) {
                if (GeometryUtil.polyOutside(part, placedPart)) return true;
            } else if (usePart) {
                if (part.polygonsIntersect(placedPart, checkchild)) return true;
            } else {
                if (GeometryUtil.polygonsIntersect(part, placedPart)) return true;
            }
        }
        return false;
    }

    tryPlacement(part, placedParts, placedParts2, sheet, checkchild = true) {
        part.insideBonus = 0;

        // Get bounds once and store in local variables for faster access
        const bounds = part.getBounds();
        const bx = bounds.x;
        const by = bounds.y;
        const bw = bounds.width;
        const bh = bounds.height;
        if (!this.hascustomsheet) {
            // Single condition with local variables
            if (bx < 0 || by < 0 || bx + bw > sheet.width || by + bh > sheet.height) {
                return null;
            }
        }

        if (this._checkPlacementConflicts(part, bx, by, bw, bh, placedParts, true, checkchild)) return null;
        if (this._checkPlacementConflicts(part, bx, by, bw, bh, placedParts2, false)) return null;

        // Calculate score prioritizing less height
        let heightScore = by + bh * 2; // Higher y positions (more height) increase score
        let complexityPenalty = part.paths.length > 1 ? 1000 * GEOM_SCALE : 0;
        let score = (heightScore * 2 + complexityPenalty) - part.insideBonus;

        return { part, score };
    }

    findBestPosition(parts, sheet, progressHandler, gridSize) {
        const startTime = performance.now();
        // gridSize is already scaled coming from main thread setSpacing or Worker
        const scaledGridSize = gridSize;
        const scaledSheet = {
            width: sheet.width * GEOM_SCALE,
            height: sheet.height * GEOM_SCALE
        };
        let bestPlacementsAll = [];
        const totalParts = parts.length;
        this.hascustomsheet = false;

        // Reset stats
        this.performanceStats = {
            collisionChecks: 0
        };

        // Initialize SpatialHash
        // Use a cell size relative to sheet size or fixed. 
        // 50 is a reasonable default, or derived from gridSize
        const hashCellSize = Math.max(50 * GEOM_SCALE, scaledGridSize * 5);
        this.spatialHash = new SpatialHash(hashCellSize);

        // Pre-calculate and cache part areas and bounds
        const partData = new Map();
        let maxArea = 0;
        let minArea = Infinity;

        parts.forEach(part => {
            part.placed = false;
            if (part.lcolor === "#00ff00") {
                const sheetVariant = part.variants[0];
                sheetVariant.align();
                const bounds = sheetVariant.getBounds();
                scaledSheet.width = bounds.width;
                scaledSheet.height = bounds.height;
                this.hascustomsheet = true;
                bestPlacementsAll.push(sheetVariant.clone());
                this.spatialHash.add(bestPlacementsAll[bestPlacementsAll.length - 1]);
                // for sheet, set center as the top left most point in sheet
                bestPlacementsAll.center = {
                    x: bounds.x,
                    y: bounds.y
                };
                return;
            }

            // Cache part data
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
        });

        // Calculate area thresholds for passes
        const areaRange = maxArea - minArea;
        const thresholds = [
            minArea + areaRange * 0.75,
            minArea + areaRange * 0.5,
            minArea + areaRange * 0.25,
            minArea
        ];

        // Assign and sort parts into passes
        const passParts = [[], [], [], []];
        parts.forEach(part => {
            if (part.lcolor === "#00ff00" || part.placed) return;

            const data = partData.get(part);
            let passIndex;
            if (data.area > thresholds[0]) passIndex = 0;
            else if (data.area > thresholds[1]) passIndex = 1;
            else if (data.area > thresholds[2]) passIndex = 2;
            else passIndex = 3;

            passParts[passIndex].push(part);
        });

        // Sort parts within each pass by area and aspect ratio
        passParts.forEach(pass => {
            pass.sort((a, b) => {
                const aData = partData.get(a);
                const bData = partData.get(b);
                // Prioritize larger parts and extreme aspect ratios
                const scoreA = aData.area * Math.abs(1 - aData.aspectRatio);
                const scoreB = bData.area * Math.abs(1 - bData.aspectRatio);
                const noise = (Math.random() - 0.5) * (scoreA + scoreB) * 0.1; // 10% noise
                return scoreB - scoreA + noise;
            });
        });

        // Process each pass with dynamic grid size
        for (let pass = 0; pass < 4; pass++) {
            const currentParts = passParts[pass];
            if (currentParts.length === 0) continue;

            // Calculate dynamic grid size based on average part size in this pass
            // In scaled space, sqrt(area) is scaled by GEOM_SCALE. 
            // We need to divide by GEOM_SCALE to keep the formula proportional.
            const dynamicGridSize = Math.floor(Math.max(scaledGridSize, (scaledGridSize * Math.sqrt(minArea) / GEOM_SCALE) * 0.01) * (4 - pass));

            for (let y = 0; y < scaledSheet.height; y += dynamicGridSize) {
                let bestPlacements = [];
                // Get array of points from horizontal line at y that intersect with placed parts
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
                    // Check if x is outside the sheet bounds
                    if (sheetleftright.length === 2 && (x < sheetleftright[0] || x > sheetleftright[1])) {
                        continue;
                    }

                    // // Check if x is between any pair of intersection points
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
                    if (!isValidPosition) {
                        continue;
                    }


                    let bestPartResult = null;
                    let bestScore = Infinity;
                    let bestPart = null;

                    // Try each unplaced part in the current pass
                    const currentPartsLength = currentParts.length;
                    const shuffleStart = Math.floor(Math.random() * currentPartsLength);
                    for (let j = 0; j < currentPartsLength; j++) {
                        const part = currentParts[(j + shuffleStart) % currentPartsLength];
                        if (part.placed) continue;
                        const variantCount = part.variants.length;
                        const variantStart = Math.floor(Math.random() * variantCount);
                        for (let i = 0; i < variantCount; i++) {
                            const variant = part.variants[(i + variantStart) % variantCount];
                            //const bounds = variant.getBounds();
                            const px = x;//-bounds.x;
                            const py = y;//-bounds.y;
                            const result = this.tryPlacement(
                                variant.clone(px, py),
                                bestPlacements, this.spatialHash,
                                scaledSheet, pass > 1
                            );
                            // add score distance from avgcenter of bestPlacementsall if length > 0
                            // if (result && bestPlacementsAll.length > 0) {
                            //     const avgCenter = bestPlacementsAll.center;
                            //     // Distance score must be scaled to match heightScore
                            //     result.score -= (
                            //         Math.pow(px - avgCenter.x, 2) +
                            //         Math.pow(py - avgCenter.y, 2)
                            //     ) / (GEOM_SCALE * 10);
                            // }
                            if (result && result.score < bestScore) {
                                result.part.x = px;
                                result.part.y = py;
                                bestScore = result.score;
                                bestPartResult = result.part;
                                bestPart = part;
                            }
                        }
                    }

                    // Place the best part found
                    if (bestPart && bestPartResult) {
                        bestPartResult.childIndex = bestPart.childIndex;
                        bestPlacements.push(bestPartResult);
                        bestPart.placed = true;

                    }
                }
                if (progressHandler) {
                    let placedCount = bestPlacementsAll.length - (this.hascustomsheet ? 1 : 0);
                    progressHandler(placedCount, totalParts);
                }
                // average the center of the parts
                if (bestPlacements.length > 0) {
                    // const avgCenter = {
                    //     x: bestPlacements.reduce((sum, part) => sum + part.x, 0) / bestPlacements.length,
                    //     y: bestPlacements.reduce((sum, part) => sum + part.y, 0) / bestPlacements.length
                    // };
                    // // averate total center accumulative for faster, if empty set as first center
                    // if (bestPlacementsAll.length == 0) {
                    //     bestPlacementsAll.center = avgCenter;
                    // } else {
                    //     bestPlacementsAll.center = {
                    //         x: (bestPlacementsAll.center.x + avgCenter.x) / 2,
                    //         y: (bestPlacementsAll.center.y + avgCenter.y) / 2
                    //     };
                    // }
                    bestPlacementsAll.push(...bestPlacements);
                    for (const p of bestPlacements) {
                        this.spatialHash.add(p);
                    }
                }

            }

        }

        const endTime = performance.now();
        console.log(`Grid NFP Performance:`, {
            time: `${(endTime - startTime).toFixed(2)}ms`,
            partsProcessed: totalParts,
            ...this.performanceStats
        });

        return bestPlacementsAll;
    }

    getPerformanceStats() {
        return this.performanceStats;
    }

    compactSolution(placements, sheet) {
        // Prepare initial hash state
        const hashCellSize = this.spatialHash.cellSize;
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
}
