const GEOM_SCALE = 1000;

class Point {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    static fromSVGPoint(svgPoint) {
        return new Point(svgPoint.x, svgPoint.y);
    }

    clone() {
        return new Point(this.x, this.y);
    }
}
let originalPathCache = {};
let cacheIndex = 0;
class Path {
    constructor(paths = [], index, color = null, lcolor = null) {
        this.paths = paths;
        this.originIndex = index;
        this.lcolor = lcolor;
        if (lcolor == "#00ff00") color = "#ffffff";
        if (color == null || color === false) color = '#' + Math.floor(Math.random() * 16777215).toString(16);
        this.color = color;
        this._cachedBounds = null;
        this.transformMatrix = [1, 0, 0, 1, 0, 0];  // Identity matrix for download
        this.childIndex = [];  // Initialize array for child path indices
        this._normalCache = new Map();
    }

    static fromSVGPath(svgPath) {
        // Function to calculate path size (area)
        // console.log(svgPath);
        function calculatePathSize(points) {
            // Calculate area using shoelace formula
            let area = 0;
            for (let i = 0; i < points.length - 1; i++) {
                area += points[i].x * points[i + 1].y - points[i + 1].x * points[i].y;
            }
            return Math.abs(area) / 2;
        }

        function parsePath(pathData) {
            const subPaths = [];
            let currentPoints = [];
            const commands = pathData.match(/[a-df-z][^a-df-z]*/gi);
            let currentX = 0, currentY = 0;  // Scaled coordinates (for adding to currentPoints)
            let currentXRaw = 0, currentYRaw = 0;  // Raw coordinates (for relative calculations)
            let lastControlX = 0, lastControlY = 0;
            let firstPointOfSubPath = null;
            const steps = 5;

            // Helper: convert SVG elliptical arc to sampled points
            function arcToPoints(x1, y1, rx, ry, phi, largeArcFlag, sweepFlag, x2, y2, segments) {
                const pts = [];
                if (Math.abs(x1 - x2) < 1e-9 && Math.abs(y1 - y2) < 1e-9) return pts;

                rx = Math.abs(rx);
                ry = Math.abs(ry);
                if (rx === 0 || ry === 0) {
                    pts.push(new Point(Math.round(x2 * GEOM_SCALE), Math.round(y2 * GEOM_SCALE)));
                    return pts;
                }

                const phiRad = phi * Math.PI / 180.0;

                // Step 1: compute (x1', y1')
                const dx2 = (x1 - x2) / 2.0;
                const dy2 = (y1 - y2) / 2.0;
                const x1p = Math.cos(phiRad) * dx2 + Math.sin(phiRad) * dy2;
                const y1p = -Math.sin(phiRad) * dx2 + Math.cos(phiRad) * dy2;

                let rx_sq = rx * rx;
                let ry_sq = ry * ry;
                const x1p_sq = x1p * x1p;
                const y1p_sq = y1p * y1p;

                // Ensure radii are large enough (per SVG spec)
                let lambda = x1p_sq / rx_sq + y1p_sq / ry_sq;
                if (lambda > 1) {
                    const factor = Math.sqrt(lambda);
                    rx *= factor;
                    ry *= factor;
                    rx_sq = rx * rx;
                    ry_sq = ry * ry;
                }

                // Compute center
                const sign = (largeArcFlag === sweepFlag) ? -1 : 1;
                let sq = (rx_sq * ry_sq - rx_sq * y1p_sq - ry_sq * x1p_sq) / (rx_sq * y1p_sq + ry_sq * x1p_sq);
                sq = isNaN(sq) ? 0 : Math.max(0, sq);
                const coef = sign * Math.sqrt(sq);
                const cxp = coef * (rx * y1p / ry);
                const cyp = coef * (-ry * x1p / rx);

                const cx = Math.cos(phiRad) * cxp - Math.sin(phiRad) * cyp + (x1 + x2) / 2.0;
                const cy = Math.sin(phiRad) * cxp + Math.cos(phiRad) * cyp + (y1 + y2) / 2.0;

                function vectorAngle(ux, uy, vx, vy) {
                    const dot = ux * vx + uy * vy;
                    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
                    let ang = 0;
                    if (len !== 0) ang = Math.acos(Math.max(-1, Math.min(1, dot / len)));
                    if (ux * vy - uy * vx < 0) ang = -ang;
                    return ang;
                }

                const v1x = (x1p - cxp) / rx;
                const v1y = (y1p - cyp) / ry;
                const v2x = (-x1p - cxp) / rx;
                const v2y = (-y1p - cyp) / ry;

                let theta1 = vectorAngle(1, 0, v1x, v1y);
                let delta = vectorAngle(v1x, v1y, v2x, v2y);
                if (!sweepFlag && delta > 0) delta -= 2 * Math.PI;
                else if (sweepFlag && delta < 0) delta += 2 * Math.PI;

                for (let i = 1; i <= segments; i++) {
                    const t = i / segments;
                    const ang = theta1 + delta * t;
                    const xp = rx * Math.cos(ang);
                    const yp = ry * Math.sin(ang);
                    const x = Math.cos(phiRad) * xp - Math.sin(phiRad) * yp + cx;
                    const y = Math.sin(phiRad) * xp + Math.cos(phiRad) * yp + cy;
                    pts.push(new Point(Math.round(x * GEOM_SCALE), Math.round(y * GEOM_SCALE)));
                }

                return pts;
            }

            commands.forEach(cmd => {
                const type = cmd[0];
                const isRelative = type === type.toLowerCase();
                const command = type.toUpperCase();
                const args = cmd.slice(1).trim().split(/[\s,]+/).map(parseFloat);

                switch (command) {
                    case 'M':
                        // If we have points from previous subpath, save them
                        if (currentPoints.length > 0) {
                            // Close the path if not closed
                            if (currentPoints[currentPoints.length - 1].x !== firstPointOfSubPath.x ||
                                currentPoints[currentPoints.length - 1].y !== firstPointOfSubPath.y) {
                                currentPoints.push(new Point(firstPointOfSubPath.x, firstPointOfSubPath.y));
                            }
                            subPaths.push({
                                points: currentPoints,
                                size: calculatePathSize(currentPoints)
                            });
                            currentPoints = [];
                        }

                        if (isRelative) {
                            currentXRaw = currentXRaw + args[0];
                            currentYRaw = currentYRaw + args[1];
                        } else {
                            currentXRaw = args[0];
                            currentYRaw = args[1];
                        }
                        currentX = Math.round(currentXRaw * GEOM_SCALE) / GEOM_SCALE;
                        currentY = Math.round(currentYRaw * GEOM_SCALE) / GEOM_SCALE;
                        firstPointOfSubPath = new Point(Math.round(currentX * GEOM_SCALE), Math.round(currentY * GEOM_SCALE));
                        currentPoints.push(firstPointOfSubPath);

                        // Handle subsequent points in the M command as L commands
                        for (let i = 2; i < args.length; i += 2) {
                            if (isRelative) {
                                currentXRaw = currentXRaw + args[i];
                                currentYRaw = currentYRaw + args[i + 1];
                            } else {
                                currentXRaw = args[i];
                                currentYRaw = args[i + 1];
                            }
                            currentX = Math.round(currentXRaw * GEOM_SCALE) / GEOM_SCALE;
                            currentY = Math.round(currentYRaw * GEOM_SCALE) / GEOM_SCALE;
                            currentPoints.push(new Point(Math.round(currentX * GEOM_SCALE), Math.round(currentY * GEOM_SCALE)));
                        }
                        break;
                    case 'L':
                        for (let i = 0; i < args.length; i += 2) {
                            if (isRelative) {
                                currentXRaw = currentXRaw + args[i];
                                currentYRaw = currentYRaw + args[i + 1];
                            } else {
                                currentXRaw = args[i];
                                currentYRaw = args[i + 1];
                            }
                            currentX = Math.round(currentXRaw * GEOM_SCALE) / GEOM_SCALE;
                            currentY = Math.round(currentYRaw * GEOM_SCALE) / GEOM_SCALE;
                            currentPoints.push(new Point(Math.round(currentX * GEOM_SCALE), Math.round(currentY * GEOM_SCALE)));
                        }
                        break;
                    case 'H':
                        args.forEach(x => {
                            if (isRelative) {
                                currentXRaw = currentXRaw + x;
                            } else {
                                currentXRaw = x;
                            }
                            currentX = Math.round(currentXRaw * GEOM_SCALE) / GEOM_SCALE;
                            currentPoints.push(new Point(Math.round(currentX * GEOM_SCALE), Math.round(currentY * GEOM_SCALE)));
                        });
                        break;
                    case 'V':
                        args.forEach(y => {
                            if (isRelative) {
                                currentYRaw = currentYRaw + y;
                            } else {
                                currentYRaw = y;
                            }
                            currentY = Math.round(currentYRaw * GEOM_SCALE) / GEOM_SCALE;
                            currentPoints.push(new Point(Math.round(currentX * GEOM_SCALE), Math.round(currentY * GEOM_SCALE)));
                        });
                        break;
                    case 'C':
                        for (let i = 0; i < args.length; i += 6) {
                            const control1X = isRelative ? currentXRaw + args[i] : args[i];
                            const control1Y = isRelative ? currentYRaw + args[i + 1] : args[i + 1];
                            const control2X = isRelative ? currentXRaw + args[i + 2] : args[i + 2];
                            const control2Y = isRelative ? currentYRaw + args[i + 3] : args[i + 3];
                            const endX = isRelative ? currentXRaw + args[i + 4] : args[i + 4];
                            const endY = isRelative ? currentYRaw + args[i + 5] : args[i + 5];

                            for (let t = 0; t <= steps; t++) {
                                const tt = t / steps;
                                const mt = 1 - tt;
                                const x = Math.pow(mt, 3) * currentXRaw +
                                    3 * Math.pow(mt, 2) * tt * control1X +
                                    3 * mt * Math.pow(tt, 2) * control2X +
                                    Math.pow(tt, 3) * endX;
                                const y = Math.pow(mt, 3) * currentYRaw +
                                    3 * Math.pow(mt, 2) * tt * control1Y +
                                    3 * mt * Math.pow(tt, 2) * control2Y +
                                    Math.pow(tt, 3) * endY;
                                if (t > 0) {
                                    currentPoints.push(new Point(Math.round(x * GEOM_SCALE), Math.round(y * GEOM_SCALE)));
                                }
                            }

                            currentXRaw = endX;
                            currentYRaw = endY;
                            currentX = Math.round(currentXRaw * GEOM_SCALE) / GEOM_SCALE;
                            currentY = Math.round(currentYRaw * GEOM_SCALE) / GEOM_SCALE;
                            lastControlX = control2X;
                            lastControlY = control2Y;
                        }
                        break;
                    case 'Q':
                        for (let i = 0; i < args.length; i += 4) {
                            const controlX = isRelative ? currentXRaw + args[i] : args[i];
                            const controlY = isRelative ? currentYRaw + args[i + 1] : args[i + 1];
                            const endX = isRelative ? currentXRaw + args[i + 2] : args[i + 2];
                            const endY = isRelative ? currentYRaw + args[i + 3] : args[i + 3];

                            for (let t = 0; t <= steps; t++) {
                                const tt = t / steps;
                                const x = Math.pow(1 - tt, 2) * currentXRaw +
                                    2 * (1 - tt) * tt * controlX +
                                    Math.pow(tt, 2) * endX;
                                const y = Math.pow(1 - tt, 2) * currentYRaw +
                                    2 * (1 - tt) * tt * controlY +
                                    Math.pow(tt, 2) * endY;
                                if (t > 0) {
                                    currentPoints.push(new Point(Math.round(x * GEOM_SCALE), Math.round(y * GEOM_SCALE)));
                                }
                            }

                            currentXRaw = endX;
                            currentYRaw = endY;
                            currentX = Math.round(currentXRaw * GEOM_SCALE) / GEOM_SCALE;
                            currentY = Math.round(currentYRaw * GEOM_SCALE) / GEOM_SCALE;
                            lastControlX = controlX;
                            lastControlY = controlY;
                        }
                        break;
                    case 'A':
                        for (let i = 0; i < args.length; i += 7) {
                            const rx = args[i];
                            const ry = args[i + 1];
                            const xAxisRot = args[i + 2];
                            const largeArcFlag = Math.round(args[i + 3]);
                            const sweepFlag = Math.round(args[i + 4]);
                            const endX = isRelative ? currentXRaw + args[i + 5] : args[i + 5];
                            const endY = isRelative ? currentYRaw + args[i + 6] : args[i + 6];

                            const arcPoints = arcToPoints(currentXRaw, currentYRaw, rx, ry, xAxisRot, largeArcFlag, sweepFlag, endX, endY, steps);
                            for (const p of arcPoints) {
                                currentPoints.push(p);
                            }

                            currentXRaw = endX;
                            currentYRaw = endY;
                            currentX = Math.round(currentXRaw * GEOM_SCALE) / GEOM_SCALE;
                            currentY = Math.round(currentYRaw * GEOM_SCALE) / GEOM_SCALE;
                        }
                        break;
                    case 'Z':
                        if (currentPoints.length > 0 && firstPointOfSubPath) {
                            currentPoints.push(new Point(firstPointOfSubPath.x, firstPointOfSubPath.y));
                            currentX = firstPointOfSubPath.x;
                            currentY = firstPointOfSubPath.y;
                            currentXRaw = firstPointOfSubPath.x / GEOM_SCALE;
                            currentYRaw = firstPointOfSubPath.y / GEOM_SCALE;
                        }
                        break;
                }
            });

            // Add the last subpath if it exists
            if (currentPoints.length > 0) {
                // Close the path if not closed
                if (firstPointOfSubPath &&
                    (currentPoints[currentPoints.length - 1].x !== firstPointOfSubPath.x ||
                        currentPoints[currentPoints.length - 1].y !== firstPointOfSubPath.y)) {
                    currentPoints.push(new Point(firstPointOfSubPath.x, firstPointOfSubPath.y));
                }
                subPaths.push({
                    points: currentPoints,
                    size: calculatePathSize(currentPoints)
                });
            }


            return subPaths;
        }

        // Parse the path data
        const pathData = typeof svgPath === 'string' ? svgPath : svgPath.getAttribute('d');
        const subPaths = parsePath(pathData);

        // Sort subpaths by size (area) in descending order
        subPaths.sort((a, b) => b.size - a.size);

        // Create the main path from the largest subpath
        const mainPath = new Path(subPaths.map(p => p.points), cacheIndex++);
        // Douglas-Peucker simplification disabled - causes issues with scaled integer coordinates
        originalPathCache[mainPath.originIndex] = pathData;  // Store original path data

        //mainPath.align();

        return mainPath;
    }

    getBounds() {
        if (this._cachedBounds) {
            return this._cachedBounds;
        }

        const path0 = this.paths[0];
        if (!path0 || !path0.length) {
            this._cachedBounds = { x: 0, y: 0, width: 0, height: 0 };
            return this._cachedBounds;
        }

        // Direct array access and local variables for better performance
        let x = path0[0].x;
        let minX = x, maxX = x;
        let y = path0[0].y;
        let minY = y, maxY = y;

        // Fast loop with direct array access
        const len = path0.length;
        let pMinX = x, pMinY = y;
        for (let i = 1; i < len; i++) {
            const point = path0[i];
            x = point.x;
            y = point.y;

            if (x < minX) minX = x;
            else if (x > maxX) maxX = x;

            if (y < minY) minY = y;
            else if (y > maxY) maxY = y;

            if (y < pMinY || (y === pMinY && x < pMinX)) {
                pMinX = x;
                pMinY = y;
            }
        }

        this._cachedBounds = {
            x: minX,
            y: minY,
            pX: pMinX,
            pY: pMinY,
            width: maxX - minX,
            height: maxY - minY,
            fX: minX / GEOM_SCALE,
            fY: minY / GEOM_SCALE,
            fWidth: (maxX - minX) / GEOM_SCALE,
            fHeight: (maxY - minY) / GEOM_SCALE
        };

        return this._cachedBounds;
    }

    invalidateBounds() {
        this._cachedBounds = null;

    }

    translate(dx, dy) {
        // Update transform matrix
        const matrix = [1, 0, 0, 1, dx, dy];
        this.transformMatrix = multiplyMatrices(this.transformMatrix, matrix);

        // Perform actual translation on points
        for (const path of this.paths) {
            path.forEach(point => {
                point.x += dx;
                point.y += dy;
            });
        }

        // Update cached bounds if they exist
        if (this._cachedBounds) {
            this._cachedBounds.x += dx;
            this._cachedBounds.y += dy;
        } else this.invalidateBounds();

        return this;
    }

    rotate(angle) {
        let rangle = angle * Math.PI / 180;
        const cos = Math.cos(rangle);
        const sin = Math.sin(rangle);

        // Update transform matrix
        const matrix = [cos, sin, -sin, cos, 0, 0];
        this.transformMatrix = multiplyMatrices(this.transformMatrix, matrix);

        // Perform actual rotation on points
        this.paths.forEach(path => {
            path.forEach(point => {
                const x = point.x * cos - point.y * sin;
                const y = point.x * sin + point.y * cos;
                point.x = x;
                point.y = y;
            });
        });


        this.align();
        return this;
    }

    flip(centerY = null) {
        centerY = centerY ?? (this.getBounds().y + this.getBounds().height / 2);

        // Update transform matrix
        const matrix = [1, 0, 0, -1, 0, 2 * centerY];
        this.transformMatrix = multiplyMatrices(this.transformMatrix, matrix);

        // Perform actual flip on points
        this.paths.forEach(path => {
            path.forEach(point => {
                point.y = 2 * centerY - point.y;
            });
        });

        // this.align();
        return this;
    }

    clone(dx = 0, dy = 0) {
        const newPaths = this.paths.map(p => p.map(pt => new Point(pt.x + dx, pt.y + dy)));
        const newPath = new Path(newPaths, this.originIndex, this.color, this.lcolor);
        newPath.transformMatrix = this.transformMatrix.slice();
        newPath.transformMatrix[4] += dx;
        newPath.transformMatrix[5] += dy;
        newPath.childIndex = this.childIndex;
        // const b = this.getBounds();
        // if (b) {
        //     newPath._cachedBounds = {
        //         x: b.x + dx,
        //         y: b.y + dy,
        //         width: b.width,
        //         height: b.height
        //     };
        // }
        return newPath;
    }

    align() {
        const bounds = this.getBounds();
        const l = this.lcolor === "#00ff00";
        return this.translate(l ? -bounds.x : -bounds.pX, l ? -bounds.y : -bounds.pY);
    }

    // const paths = [originalPathCache[this.originIndex], ...this.childIndex.map(i => originalPathCache[i]).filter(Boolean)];
    // const optimizedPaths = paths.map(d => {
    //     const match = d.substr(1).trim().match(/^([^A-Za-z]+)(.*)$/);
    //     if (match) {
    //         const [, coords, rest] = match;
    //         const [first, ...others] = coords.split(/\s+/);
    //         return others.length > 1 ? `M${first} l${others.join(' ')}${rest}` : `M${coords}${rest}`;
    //     }
    //     return d;
    // });

    getSVGPathData() {
        let origin = originalPathCache[this.originIndex] || '';
        for (const i of this.childIndex) {
            const d = originalPathCache[i];
            if (!d) continue;
            const match = d.substr(1).trim().match(/^([^A-Za-z]+)(.*)$/);
            if (match) {
                const [, coords, rest] = match;
                const pts = coords.trim().split(/\s+/);
                origin += pts.length > 1 ? ` M${pts[0]} l${pts.slice(1).join(' ')}${rest}` : ` M${coords.trim()}${rest}`;
            }
        }
        return origin;
    }

    toSVGPath() {
        let origin = this.getSVGPathData();

        const transformStr = `matrix(${this.transformMatrix[0]},${this.transformMatrix[1]},${this.transformMatrix[2]},${this.transformMatrix[3]},${this.transformMatrix[4] / GEOM_SCALE},${this.transformMatrix[5] / GEOM_SCALE})`;

        origin = `<path d="${origin}" transform="${transformStr}" fill="none" ${this.lcolor ? `stroke="${this.lcolor}"` : ''} style="-inkscape-stroke: hairline;"/>`;
        return origin;
    }


    static getSignedArea(points) {
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            area += points[i].x * points[j].y - points[j].x * points[i].y;
        }
        return area / 2;
    }

    ensureClockwise() {
        const path = this.paths[0];
        if (!path) return this;

        const signedArea = Path.getSignedArea(path);
        if (signedArea < 0) {
            // Already clockwise
            return this;
        }

        // Reverse the path to make it clockwise
        this.paths[0] = path.reverse();
        return this;
    }

    offset(distance) {
        if (distance === 0 || this.lcolor === "#00ff00") return this;

        // ClipperLib requires integer coordinates, so we scale
        const clipperPaths = this.paths.map(path =>
            path.map(p => ({ X: p.x, Y: p.y }))
        );

        const co = new ClipperLib.ClipperOffset();
        co.AddPaths(clipperPaths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);

        const solution_paths = new ClipperLib.Paths();
        co.Execute(solution_paths, distance * GEOM_SCALE / 2);

        const newPaths = solution_paths.map(path =>
            path.map(p => new Point(p.X, p.Y))
        );

        this.paths = newPaths;
        this.invalidateBounds();
        return this;
    }

    removeIntersections(points) {
        if (points.length < 4) {
            // A single path that is not a valid polygon
            return [];
        }

        let mainPoints = points;
        const newPolygons = [];
        let iterations = 0;

        // Arbitrary limit to prevent infinite loops from complex geometries
        while (iterations < mainPoints.length) {
            let intersection = null;
            let seg1_idx = -1, seg2_idx = -1;

            const numPoints = mainPoints.length - 1; // Path is closed
            // Find first intersection
            for (let i = 0; i < numPoints; i++) {
                for (let j = i + 1; j < numPoints; j++) {
                    // Skip adjacent segments
                    if (Math.abs(i - j) < 2) continue;
                    // Skip last segment connecting to first
                    if (i == 0 && j == numPoints - 1) continue;

                    const p1 = mainPoints[i];
                    const p2 = mainPoints[i + 1];
                    const p3 = mainPoints[j];
                    const p4 = mainPoints[j + 1];

                    intersection = this.findIntersection(p1, p2, p3, p4);
                    if (intersection) {
                        seg1_idx = i;
                        seg2_idx = j;
                        break;
                    }
                }
                if (intersection) break;
            }

            if (!intersection) {
                // No more intersections, we're done with this polygon
                break;
            }

            const intersectionPoint = new Point(intersection.x, intersection.y);

            // The loop is from seg1_idx+1 to seg2_idx
            const loopPoly = [intersectionPoint];
            for (let i = seg1_idx + 1; i <= seg2_idx; i++) {
                loopPoly.push(mainPoints[i]);
            }
            loopPoly.push(intersectionPoint);
            newPolygons.push(loopPoly);

            // The new main polygon is the remainder
            const nextMainPoints = [];
            for (let i = 0; i <= seg1_idx; i++) {
                nextMainPoints.push(mainPoints[i]);
            }
            nextMainPoints.push(intersectionPoint);
            for (let i = seg2_idx + 1; i < mainPoints.length; i++) {
                nextMainPoints.push(mainPoints[i]);
            }

            mainPoints = nextMainPoints;
            iterations++;
        }

        if (mainPoints.length > 3) {
            newPolygons.push(mainPoints);
        }

        return newPolygons;
    }

    getSegmentLength(segment) {
        return Math.sqrt(
            Math.pow(segment.end.x - segment.start.x, 2) +
            Math.pow(segment.end.y - segment.start.y, 2)
        );
    }

    findIntersection(p1, p2, p3, p4) {
        const denominator = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
        if (denominator === 0) return null;

        const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denominator;
        const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denominator;

        if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
            return {
                x: p1.x + ua * (p2.x - p1.x),
                y: p1.y + ua * (p2.y - p1.y)
            };
        }

        return null;
    }

    simplifyPath(points, tolerance = 0.1 * GEOM_SCALE) {
        if (points.length < 3) return points;

        // Douglas-Peucker algorithm
        const simplified = this._douglasPeucker(points, 0, points.length - 1, tolerance);
        // Always close the path
        if (simplified.length > 0) {
            simplified.push(points[points.length - 1].clone());
        }
        return simplified;
    }

    _douglasPeucker(points, startIdx, endIdx, tolerance) {
        if (endIdx - startIdx < 2) {
            return startIdx < points.length ? [points[startIdx].clone()] : [];
        }

        // Find point with maximum perpendicular distance from line
        let maxDist = 0;
        let maxIdx = 0;

        const lineStart = points[startIdx];
        const lineEnd = points[endIdx];
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const magSq = dx * dx + dy * dy;

        for (let i = startIdx + 1; i < endIdx; i++) {
            const point = points[i];
            let dist;
            if (magSq === 0) {
                // Line is a point, use distance to that point
                const pdx = point.x - lineStart.x;
                const pdy = point.y - lineStart.y;
                dist = Math.sqrt(pdx * pdx + pdy * pdy);
            } else {
                // Perpendicular distance to line segment
                const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / magSq;
                const projX = lineStart.x + t * dx;
                const projY = lineStart.y + t * dy;
                const pdx = point.x - projX;
                const pdy = point.y - projY;
                dist = Math.sqrt(pdx * pdx + pdy * pdy);
            }

            if (dist > maxDist) {
                maxDist = dist;
                maxIdx = i;
            }
        }

        // If max distance exceeds tolerance, recursively simplify
        if (maxDist > tolerance) {
            const left = this._douglasPeucker(points, startIdx, maxIdx, tolerance);
            const right = this._douglasPeucker(points, maxIdx, endIdx, tolerance);
            // Merge, avoiding duplicate at maxIdx
            return left.concat(right.slice(1));
        } else {
            // All points within tolerance, keep only endpoints
            return [points[startIdx].clone()];
        }
    }

    static getNormal(pt1, pt2) {
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        return len === 0 ? { x: 0, y: 0 } : { x: -dy / len, y: dx / len };
    }

    static dotProduct(v1, v2) {
        return v1.x * v2.x + v1.y * v2.y;
    }

    static getBisector(prev, curr, next, distance) {
        const n1 = Path.getNormal(prev, curr);
        const n2 = Path.getNormal(curr, next);

        // Calculate angle between normals
        const dot = Path.dotProduct(n1, n2);
        const angle = Math.acos(Math.min(1, Math.max(-1, dot)));

        // Calculate bisector vector
        const bisector = {
            x: n1.x + n2.x,
            y: n1.y + n2.y
        };

        // Normalize and scale bisector
        const len = Math.sqrt(bisector.x * bisector.x + bisector.y * bisector.y);
        if (len === 0) return { x: n1.x * distance, y: n1.y * distance };

        const scale = distance / Math.sin(angle / 2);
        return {
            x: (bisector.x / len) * scale,
            y: (bisector.y / len) * scale
        };
    }

    _getNormals(path) {
        const cacheKey = 0;// only index 0
        if (this._normalCache.has(cacheKey)) {
            return this._normalCache.get(cacheKey);
        }

        const normals = [];
        for (let i = 0; i < path.length; i++) {
            const p1 = path[i];
            const p2 = path[(i + 1) % path.length];
            const normal = { x: p2.y - p1.y, y: p1.x - p2.x };
            const len = Math.sqrt(normal.x * normal.x + normal.y * normal.y);
            normals.push({ x: normal.x / len, y: normal.y / len });
        }
        this._normalCache.set(cacheKey, normals);
        return normals;
    }

    _projectPolygon(path, axis) {
        let min = Infinity, max = -Infinity;
        for (const point of path) {
            const projection = point.x * axis.x + point.y * axis.y;
            min = Math.min(min, projection);
            max = Math.max(max, projection);
        }
        return { min, max };
    }

    _satIntersect(other) {
        const path1 = this.paths[0];
        const path2 = other.paths[0];
        const normals1 = this._getNormals(path1);
        const normals2 = other._getNormals(path2);

        const allNormals = [...normals1, ...normals2];
        for (const normal of allNormals) {
            const proj1 = this._projectPolygon(path1, normal);
            const proj2 = this._projectPolygon(path2, normal);
            if (proj1.max < proj2.min || proj2.max < proj1.min) {
                return false;
            }
        }
        return true;
    }

    polygonsIntersect(other, checkchild = true) {
        // Add a small buffer to prevent touching edges
        const BUFFER = 0.1 * GEOM_SCALE;

        // Check bounding boxes first with buffer
        const bounds1 = this.getBounds();
        const bounds2 = other.getBounds();

        if (!(bounds1.x + bounds1.width + BUFFER > bounds2.x &&
            bounds1.x - BUFFER < bounds2.x + bounds2.width &&
            bounds1.y + bounds1.height + BUFFER > bounds2.y &&
            bounds1.y - BUFFER < bounds2.y + bounds2.height)) {
            return false;
        }

        // if have child, check if poly1 fully inside poly2 childs
        if (other.paths.length > 1 && checkchild) {
            for (let i = 1; i < other.paths.length; i++) {
                if (!GeometryUtil.polyOutside(this, other, i)) {
                    this.insideBonus = 10000 * GEOM_SCALE;
                    return false;
                }
            }
        }

        // Use more accurate intersection test instead of SAT (which fails for concave shapes)
        const path1 = this.paths[0];
        const path2 = other.paths[0];
        const len1 = path1.length;
        const len2 = path2.length;

        // 1. Check if any point from poly1 is inside poly2
        for (let i = 0; i < len1; i++) {
            if (GeometryUtil.pointInPolygon(path1[i], path2)) return true;
        }

        // 2. Check if any point from poly2 is inside poly1
        for (let i = 0; i < len2; i++) {
            if (GeometryUtil.pointInPolygon(path2[i], path1)) return true;
        }

        // 3. Check for line segment intersections
        for (let i = 0; i < len1; i++) {
            const p1 = path1[i];
            const p2 = path1[(i + 1) % len1];
            for (let j = 0; j < len2; j++) {
                const p3 = path2[j];
                const p4 = path2[(j + 1) % len2];
                if (GeometryUtil.lineSegmentsIntersect(p1, p2, p3, p4)) {
                    return true;
                }
            }
        }

        return false;
    }
}

// Utility functions for geometry calculations
const GeometryUtil = {
    distance: function (p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    },

    pointInPolygon: function (point, polygon) {
        // Using the ray casting algorithm for point in polygon test
        const numVertices = polygon.length;
        let isInside = false;
        const testX = point.x;
        const testY = point.y;

        for (let i = 0, j = numVertices - 1; i < numVertices; j = i++) {
            const vertI = polygon[i];
            const vertJ = polygon[j];

            if (((vertI.y > testY) !== (vertJ.y > testY)) &&
                (testX < (vertJ.x - vertI.x) * (testY - vertI.y) / (vertJ.y - vertI.y) + vertI.x)) {
                isInside = !isInside;
            }
        }
        return isInside;
    },
    // function to check if poly1 lines intersect poly2
    polygonsIntersect2: function (poly1, poly2, idx = 0) {
        // Check for line segment intersections (with buffer)
        const path1 = poly1.paths[0];
        const path2 = poly2.paths[idx];
        const len1 = path1.length;
        const len2 = path2.length;

        for (let i = 0; i < len1; i++) {
            const p1 = path1[i];
            const p2 = path1[(i + 1) % len1];

            for (let j = 0; j < len2; j++) {
                const p3 = path2[j];
                const p4 = path2[(j + 1) % len2];

                if (this.lineSegmentsIntersect(p1, p2, p3, p4)) {
                    return true;
                }
            }
        }

        return false;
    },
    // function to check if two poly1 fully inside poly2
    polyOutside: function (poly1, poly2, idx = 0) {
        // Check if any point from poly1 is inside poly2 (with buffer)
        for (const point of poly1.paths[0]) {
            if (!this.pointInPolygon(point, poly2.paths[idx])) return true;
        }
        return false;
    },
    //function to check if two poly1 intersect with poly2
    polygonsIntersect: function (poly1, poly2, checkchild = true) {
        // Add a small buffer to prevent touching edges
        const BUFFER = 0.1 * GEOM_SCALE;

        // Check bounding boxes first with buffer
        const bounds1 = poly1.getBounds();
        const bounds2 = poly2.getBounds();

        if (!(bounds1.x + bounds1.width + BUFFER > bounds2.x &&
            bounds1.x - BUFFER < bounds2.x + bounds2.width &&
            bounds1.y + bounds1.height + BUFFER > bounds2.y &&
            bounds1.y - BUFFER < bounds2.y + bounds2.height)) {
            return false;
        }

        // if have child, check if poly1 fully inside poly2 childs
        if (poly2.paths.length > 1 && checkchild) {
            for (let i = 1; i < poly2.paths.length; i++) {
                if (!this.polyOutside(poly1, poly2, i)) {
                    poly1.insideBonus = 10000 * GEOM_SCALE;
                    return false;
                }
            }
        }

        // Cache paths for faster access
        const path1 = poly1.paths[0];
        const path2 = poly2.paths[0];
        const len1 = path1.length;
        const len2 = path2.length;

        // Check if any point from poly1 is inside poly2
        for (let i = 0; i < len1; i++) {
            if (this.pointInPolygon(path1[i], path2)) return true;
        }

        // Check if any point from poly2 is inside poly1
        for (let i = 0; i < len2; i++) {
            if (this.pointInPolygon(path2[i], path1)) return true;
        }

        // Check for line segment intersections (with buffer)
        for (let i = 0; i < len1; i++) {
            const p1 = path1[i];
            const p2 = path1[(i + 1) % len1];

            for (let j = 0; j < len2; j++) {
                const p3 = path2[j];
                const p4 = path2[(j + 1) % len2];

                if (this.lineSegmentsIntersect(p1, p2, p3, p4)) {
                    return true;
                }
            }
        }

        return false;
    },

    lineSegmentsIntersect: function (p1, p2, p3, p4) {
        const ccw = (A, B, C) => {
            return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
        };
        return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
    },

    /**
     * Get points where a horizontal line intersects with a part's paths
     * @param {Path} part - The part to check intersections with
     * @param {number} y - The y-coordinate of the horizontal line
     * @returns {Array<{x: number, y: number}>} Array of intersection points
     */
    getHorizontalIntersections(part, y) {
        const intersections = [];
        // const b=part.getBounds();
        // if (b.y > y || b.y+b.height < y) return intersections;

        // Check each path in the part
        for (const path of part.paths) {
            // Check each line segment in the path
            for (let i = 0; i < path.length; i++) {
                const p1 = path[i];
                const p2 = path[(i + 1) % path.length];  // Loop back to first point

                // Skip horizontal lines
                if (Math.abs(p1.y - p2.y) < 0.0001) continue;

                // Check if the horizontal line intersects this segment
                if ((p1.y <= y && p2.y >= y) || (p1.y >= y && p2.y <= y)) {
                    // Calculate x-intersection using linear interpolation
                    const t = (y - p1.y) / (p2.y - p1.y);
                    const x = p1.x + t * (p2.x - p1.x);

                    // Add intersection point
                    intersections.push(x);
                }
            }
        }
        // Sort intersections in ascending order
        // intersections.sort((a, b) => a - b);

        return intersections;
    },

    /**
     * Get ranges of x coordinates where a part can be placed at a given y coordinate
     * @param {Array<{x: number, y: number}>} intersections - Sorted array of intersection points
     * @returns {Array<{start: number, end: number}>} Array of valid x-ranges
     */
    getValidXRanges(intersections) {
        const ranges = [];

        // Process pairs of intersections
        for (let i = 0; i < intersections.length - 1; i += 2) {
            const start = intersections[i].x;
            const end = intersections[i + 1].x;
            ranges.push({ start, end });
        }

        return ranges;
    },

    compactLayout(placements, collisionCheck) {
        const step = 1 * GEOM_SCALE;
        const iterations = 3;

        // Get parts excluding the sheet
        const items = placements.filter(p => p.lcolor !== "#00ff00");
        if (items.length === 0) return 0;

        // Find sheet bounds for boundary checks
        const sheet = placements.find(p => p.lcolor === "#00ff00");
        const sheetWidth = sheet ? sheet.getBounds().width : Infinity;

        let totalMoved = 0;
        for (let pass = 0; pass < iterations; pass++) {
            // Randomize horizontal direction for this pass to create "wiggle"
            const hDir = Math.random() < 0.5 ? -1 : 1;

            // Sort Strategy: 
            // Pass 0: Smallest Area First (User Request) with noise
            // Pass 1: Top-Left First (Standard settlement) with noise
            // Pass 2: Smallest Area First (Cleanup)
            items.sort((a, b) => {
                const bA = a.getBounds();
                const bB = b.getBounds();
                const noise = (Math.random() - 0.5) * 0.2; // 20% randomness

                if (pass % 2 === 0) {
                    const areaA = bA.width * bA.height;
                    const areaB = bB.width * bB.height;
                    return (areaA - areaB) + (noise * (areaA + areaB));
                } else {
                    const posA = bA.y * 10 + bA.x;
                    const posB = bB.y * 10 + bB.x;
                    return (posA - posB) + (noise * 100 * GEOM_SCALE);
                }
            });

            for (const part of items) {
                // phase 'start': signal we are moving this part
                collisionCheck(part, 'start');

                let moved = true;
                while (moved) {
                    moved = false;

                    // Try UP (settle upward)
                    let bounds = part.getBounds();
                    if (bounds.y >= step) {
                        part.translate(0, -step);
                        if (collisionCheck(part, 'check')) {
                            part.translate(0, step); // Revert
                        } else {
                            moved = true;
                            totalMoved++;
                        }
                    }

                    // Try Horizontal (wiggle left or right based on hDir chosen for this pass)
                    bounds = part.getBounds();
                    let canMoveH = false;
                    if (hDir === -1 && bounds.x >= step) {
                        canMoveH = true;
                    } else if (hDir === 1 && (bounds.x + bounds.width + step) <= sheetWidth) {
                        canMoveH = true;
                    }

                    if (canMoveH) {
                        part.translate(hDir * step, 0);
                        if (collisionCheck(part, 'check')) {
                            part.translate(-hDir * step, 0); // Revert
                        } else {
                            moved = true;
                            totalMoved++;
                        }
                    }
                }

                // phase 'end': signal we are done moving this part
                collisionCheck(part, 'end');
            }
        }
        return totalMoved;
    }
};

// Compute convex hull using Graham Scan
function convexHull(points) {
    if (points.length < 3) return points;

    // Find point with lowest y-coordinate (and leftmost if tied)
    let bottomPoint = points[0];
    for (let i = 1; i < points.length; i++) {
        if (points[i].y < bottomPoint.y ||
            (points[i].y === bottomPoint.y && points[i].x < bottomPoint.x)) {
            bottomPoint = points[i];
        }
    }

    // Sort points by polar angle with respect to bottom point
    const sortedPoints = points.filter(p => p !== bottomPoint).sort((a, b) => {
        const angleA = Math.atan2(a.y - bottomPoint.y, a.x - bottomPoint.x);
        const angleB = Math.atan2(b.y - bottomPoint.y, b.x - bottomPoint.x);
        return angleA - angleB;
    });
    sortedPoints.unshift(bottomPoint);

    // Build convex hull
    const stack = [sortedPoints[0], sortedPoints[1]];
    for (let i = 2; i < sortedPoints.length; i++) {
        while (stack.length > 1) {
            const p1 = stack[stack.length - 2];
            const p2 = stack[stack.length - 1];
            const p3 = sortedPoints[i];

            // Check if making a right turn
            const cross = (p2.x - p1.x) * (p3.y - p1.y) -
                (p2.y - p1.y) * (p3.x - p1.x);
            if (cross > 0) break;
            stack.pop();
        }
        stack.push(sortedPoints[i]);
    }
    return stack;
}

class NFPCalculator {
    static calculateNFP(stationary, orbiting) {
        // Ensure we're working with the outer path only
        const stationaryPoints = stationary.paths[0];
        const orbitingPoints = orbiting.paths[0];

        // Rotate orbiting polygon 180 degrees
        const rotatedOrbiting = orbitingPoints.map(point => ({
            x: -point.x,
            y: -point.y
        }));

        return this.minkowskiSum(stationaryPoints, rotatedOrbiting);
    }

    static minkowskiSum(poly1, poly2) {
        const result = [];
        const len1 = poly1.length;
        const len2 = poly2.length;

        // Pre-allocate array for better performance
        result.length = len1 * len2;
        let idx = 0;

        // Compute sum of all vertex pairs
        for (let i = 0; i < len1; i++) {
            const p1 = poly1[i];
            for (let j = 0; j < len2; j++) {
                const p2 = poly2[j];
                result[idx++] = {
                    x: p1.x + p2.x,
                    y: p1.y + p2.y
                };
            }
        }

        // Return convex hull of points
        return convexHull(result);
    }

    static getValidPlacements(stationary, moving) {
        const nfp = this.calculateNFP(stationary, moving);
        return nfp; // NFP vertices represent valid placement positions
    }
}

// Matrix multiplication helper
function multiplyMatrices(m1, m2) {
    const [a1, b1, c1, d1, e1, f1] = m1;
    const [a2, b2, c2, d2, e2, f2] = m2;
    return [
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2,
        e1 * b2 + f1 * d2 + f2
    ];
}
