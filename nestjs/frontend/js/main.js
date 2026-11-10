class NestingApp {
    constructor(ui = false) {
        this.parts = [];
        this.placedParts = [];
        this.bestPlacedParts = null;
        this.bestArea = Infinity;
        // Initialize NFP algorithm based on UI toggle
        this.initializeNFP();
        this.sheet = { width: 1000, height: 1000 };
        this.sheet2 = { width: 1000, height: 1000 };
        this.partColors = []; // Store colors for each part
        this.partsVariants = null; // Cache for part variants
        this.lastRotationValue = null; // Track last rotation setting
        this.lastFlipValue = null; // Track last flip setting
        this.lastOffset = null;
        this.numWorkers = 1; // Default to single CPU
        this.currentProgress = 0;
        this.hasui = ui;
        this.useNFP = false;  // Flag to choose between methods
        this.lastSvgTimestamp = null;
        this.checkInterval = null;

        if (ui) {
            this.initializeUI();
            this.updatePathCounts();
        }

        // Initialize NFP algorithm (needs to be after DOM elements are available)
        if (ui) {
            this.initializeNFP();
        }
        this.startSvgCheck();
    }

    initializeUI() {
        // Initialize input elements
        this.svgInput = document.getElementById('svgInput');

        this.sheetWidth = document.getElementById('sheetWidth');
        this.sheetHeight = document.getElementById('sheetHeight');
        this.rotation = document.getElementById('rotation');
        this.spacing = document.getElementById('spacing');
        this.gridSpacing = document.getElementById('gridSpacing');
        this.allowFlip = document.getElementById('allowFlip');
        this.multiCPU = document.getElementById('multiCPU');
        this.startButton = document.getElementById('startNest');
        this.useNFP2Checkbox = document.getElementById('useNFP2');
        this.selectAsBestButton = document.getElementById('selectAsBest');
        this.downloadBestButton = document.getElementById('downloadBest');
        this.copyBestButton = document.getElementById('copyBest');
        this.recompactCurrentButton = document.getElementById('recompactCurrent');
        this.currentAreaDisplay = document.getElementById('currentArea');
        this.bestAreaDisplay = document.getElementById('bestArea');
        this.progressDisplay = document.getElementById('progress');
        this.nfpMethodToggle = document.getElementById('nfpMethodToggle');
        this.usePhysics = document.getElementById('usePhysics');

        // Initialize canvases
        this.previewCanvas = new Canvas('previewCanvas');
        this.currentSolutionCanvas = new Canvas('currentSolutionCanvas');
        this.bestSolutionCanvas = new Canvas('bestSolutionCanvas');

        // Set up event listeners


        this.svgInput.addEventListener('change', this.handleSVGUpload.bind(this));
        this.startButton.addEventListener('click', this.startNestingWeb.bind(this));
        this.sheetWidth.addEventListener('change', this.updateSheet.bind(this));
        this.sheetHeight.addEventListener('change', this.updateSheet.bind(this));
        this.spacing.addEventListener('change', () => {
            this.nfp.setSpacing(parseFloat(this.spacing.value));
        });
        this.allowFlip.addEventListener('change', () => {
            this.nfp.setAllowFlip(this.allowFlip.checked);
            this.partsVariants = null; // Invalidate cache when flip setting changes
        });
        this.rotation.addEventListener('change', () => {
            this.partsVariants = null; // Invalidate cache when rotation setting changes
        });
        this.selectAsBestButton.addEventListener('click', this.selectAsBest.bind(this));
        this.downloadBestButton.addEventListener('click', this.downloadBestSolution.bind(this));
        this.useNFP2Checkbox.addEventListener('change', this.toggleNFPAlgorithm.bind(this));
        this.recompactCurrentButton.addEventListener('click', this.recompactCurrentSolution.bind(this));





    }

    toggleNFPMethod() {
        this.useNFP = !this.useNFP;
        console.log(`Using ${this.useNFP ? 'NFP' : 'Grid'} based method`);
    }

    /**
     * Initialize the NFP algorithm based on UI selection
     */
    initializeNFP() {
        const useNFP2 = this.useNFP2Checkbox && this.useNFP2Checkbox.checked;
        if (useNFP2) {
            this.nfp = new NFP2();
            console.log('Using True NFP Algorithm (NFP2)');
        } else {
            this.nfp = new NFP();
            console.log('Using Original Grid Algorithm');
        }
    }

    /**
     * Toggle between NFP algorithms when checkbox changes
     */
    toggleNFPAlgorithm() {
        this.initializeNFP();
        // Reset parts variants cache when algorithm changes
        this.partsVariants = null;
        console.log(`Algorithm switched to: ${this.useNFP2Checkbox && this.useNFP2Checkbox.checked ? 'NFP2 (True NFP)' : 'Original (Grid-based)'}`);
    }

    /**
     * Display performance statistics for current algorithm
     */
    displayPerformanceStats() {
        const stats = this.nfp.getPerformanceStats();
        if (!stats) return;

        if (this.nfp instanceof NFP2) {
            console.log('NFP2 Performance Statistics:', {
                'Boundary Points Tested': stats.boundaryPointsTested,
                'Collisions Avoided': stats.collisionAvoided,
                'Actual Intersection Checks': stats.collisionChecks
            });

            if (this.currentAreaDisplay) {
                const currentText = this.currentAreaDisplay.textContent;
                if (!currentText.includes('|')) {
                    this.currentAreaDisplay.textContent = `${currentText} | NFP2 tests: ${stats.collisionChecks}`;
                }
            }
        } else {
            console.log('Original Grid Performance Statistics:', {
                'Actual Intersection Checks': stats.collisionChecks
            });
            if (this.currentAreaDisplay) {
                const currentText = this.currentAreaDisplay.textContent;
                if (!currentText.includes('|')) {
                    this.currentAreaDisplay.textContent = `${currentText} | Grid tests: ${stats.collisionChecks}`;
                }
            }
        }
    }


    async fetchStoredSVG() {
        try {
            const response = await fetch('http://localhost:3000/stored-svg');
            const svgData = await response.text();
            this.handleSVGUpload2(svgData);
        } catch (error) {
            console.error('Error fetching SVG:', error);
        }
    }
    async handleSVGUpload(event) {
        const file = event.target.files[0];
        if (!file) return;


        // Reset the file input value to allow uploading the same file again
        event.target.value = '';

        const text = await file.text();

        this.handleSVGUpload2(text);
    }
    async handleSVGUpload2(text) {
        let cleanedText = text
            // First, remove all plain xmlns attributes
            .replace(/xmlns="[^"]*"/g, '')
            // Add back single xmlns at the start of svg tag
            .replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');

        originalPathCache = {};
        cacheIndex = 0;
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(cleanedText, 'image/svg+xml');

        // Get all paths, including those inside groups
        const paths = [];
        this.collectPathsWithTransforms(svgDoc.documentElement, paths);

        this.parts = [];
        this.partColors = [];

        paths.forEach(({ path, transform }) => {
            const style = path.getAttribute('style');
            let color = null;
            let lcolor = null;
            if (style) {
                const fillMatch = style.match(/fill:\s*([^;]+)/);
                if (fillMatch) {
                    color = fillMatch[1].trim();
                }

                const strokeMatch = style.match(/stroke:\s*([^;]+)/);
                if (strokeMatch) {
                    lcolor = strokeMatch[1].trim();
                }
            }

            // skip if lcolor = #ffff00
            if (lcolor != "#ffff00") {
                this.partColors.push(color);
                const part = Path.fromSVGPath(path);

                // Apply accumulated transforms
                if (transform) {
                    this.applyTransformToPath(part, transform);
                }
                //part.align();

                part.color = color;
                part.lcolor = lcolor;
                // Note: originIndex is already set by Path.fromSVGPath()
                // and the original path data is already cached there
                this.parts.push(part);
            }
        });
        // Check for parts inside other parts
        for (let i = this.parts.length - 1; i >= 0; i--) {
            if (this.parts[i].paths.length == 0) continue;
            for (let j = 0; j < this.parts.length; j++) {
                if (i !== j && this.parts[j].paths.length > 0 && !GeometryUtil.polyOutside(this.parts[j], this.parts[i])) {
                    // Add the inner part as a compound path to the outer part
                    this.parts[j].paths.forEach(path => {
                        this.parts[i].paths.push(path);
                        this.parts[i].childIndex.push(this.parts[j].originIndex);
                        // DEBUG: Print child path data when detected
                        // console.log(`[PARSE] Child detected - Parent originIndex: ${this.parts[i].originIndex}, Child originIndex: ${this.parts[j].originIndex}`);
                        // console.log(`[PARSE] Child d attribute:`, originalPathCache[this.parts[j].originIndex]);
                    });
                    // Merge the original path data
                    // if (this.parts[j].originIndex !== undefined) {
                    //     const innerPathData = originalPathCache[this.parts[j].originIndex];
                    //     if (innerPathData) {
                    //         originalPathCache[this.parts[i].originIndex] = originalPathCache[this.parts[i].originIndex] + ' ' + innerPathData;
                    //     }
                    // }
                    // Remove the inner part from the array
                    this.parts[j].paths = []; // we delete later
                }
            }
        }

        // Remove parts with empty paths
        this.parts = this.parts.filter(part => part.paths.length > 0);


        // Calculate total area of all parts and set sheet size
        let totalArea = 0;
        let sheets = [];
        let newparts = [];
        this.parts.forEach(part => {
            part.align();
            const bounds = part.getBounds();
            totalArea += bounds.width * bounds.height;
            part.size = bounds.width * bounds.height;
            // if (part.lcolor=="#00ff00") {
            //     sheets.push(part);
            // } else newparts.push(part);
        });
        //this.parts=newparts;
        //this.sheets=sheets;
        // Sort parts from bigger to smaller size
        this.parts.sort((a, b) => b.size - a.size);


        // Set sheet size to square root of total area, with some padding
        const padding = 2; // 20% extra space
        const side = Math.ceil(Math.sqrt(totalArea * padding) / GEOM_SCALE);
        this.sheet.width = side;
        this.sheet.height = side;
        this.sheet2.width = side;
        this.sheet2.height = side;
        if (this.hasui) {
            this.sheetWidth.value = this.sheet.width;
            this.sheetHeight.value = this.sheet.height;
            this.previewCanvas.setSheet(this.sheet.width, this.sheet.height);
            this.drawParts();
        }
        this.partsVariants = null;
    }

    collectPathsWithTransforms(element, paths, parentTransform = '') {
        // Get this element's transform
        let transform = element.getAttribute('transform') || '';
        if (parentTransform) {
            transform = parentTransform + ' ' + transform;
        }

        // If this is a path, add it to our collection
        if (element.tagName.toLowerCase() === 'path') {
            paths.push({ path: element, transform: transform.trim() });
        }

        // Recursively process all child elements
        Array.from(element.children).forEach(child => {
            this.collectPathsWithTransforms(child, paths, transform);
        });
    }

    applyTransformToPath(part, transformString) {
        const transforms = transformString.match(/\w+\([^)]+\)/g) || [];
        let allmatrix = [1, 0, 0, 1, 0, 0];
        transforms.forEach(transform => {
            const type = transform.match(/^\w+/)[0];
            const args = transform.match(/[-.\d]+/g).map(Number);

            let matrix = [1, 0, 0, 1, 0, 0]; // Identity matrix

            switch (type) {
                case 'matrix':
                    matrix = [args[0], args[1], args[2], args[3], args[4] * GEOM_SCALE, args[5] * GEOM_SCALE];
                    break;
                case 'translate':
                    const tx = (args[0] || 0) * GEOM_SCALE;
                    const ty = (args[1] || 0) * GEOM_SCALE;
                    matrix = [1, 0, 0, 1, tx, ty];
                    break;
                case 'scale':
                    const sx = args[0];
                    const sy = args.length > 1 ? args[1] : sx;
                    matrix = [sx, 0, 0, sy, 0, 0];
                    break;
                case 'rotate':
                    const angle = args[0];
                    const cx = args[1] || 0;
                    const cy = args[2] || 0;
                    const rad = angle * Math.PI / 180;
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);
                    matrix = [
                        cos, sin,
                        -sin, cos,
                        (cx - cx * cos + cy * sin) * GEOM_SCALE,
                        (cy - cx * sin - cy * cos) * GEOM_SCALE
                    ];
                    break;
            }

            allmatrix = multiplyMatrices(allmatrix, matrix);

        });
        // Apply the transformation matrix to the part
        part.paths.forEach(path => {
            path.forEach(point => {
                const x = point.x;
                const y = point.y;
                point.x = allmatrix[0] * x + allmatrix[2] * y + allmatrix[4];
                point.y = allmatrix[1] * x + allmatrix[3] * y + allmatrix[5];
            });
        });

        // Update the part's transformation matrix
        part.transformMatrix = allmatrix;

        part.invalidateBounds();
        return part;
    }

    updateSheet() {
        this.sheet.width = parseFloat(this.sheetWidth.value);
        this.sheet.height = parseFloat(this.sheetHeight.value);
        this.previewCanvas.resize();
    }
    generatePartVariants(part) {
        const variants = [];
        const rotations = this._getRotationAngles(this.lastRotationValue);
        const opart = part.clone().offset(this.lastOffset);
        //const opart=part;
        for (const rotation of rotations) {
            const variant = opart.clone();
            if (rotation !== 0) {
                variant.rotate(rotation);
            }
            variants.push(variant);
        }
        return {
            placed: false,
            color: part.color,
            lcolor: part.lcolor,
            originIndex: part.originIndex,
            childIndex: part.childIndex,
            variants: variants
        };
    }
    async runNesting(multiCPU = false) {
        this.nfp.setAllowFlip(this.lastFlipValue || false);

        let result;
        this.currentProgress = 0;
        this.drawProgress();
        if (multiCPU && window.navigator.hardwareConcurrency > 1) {
            // Create multiple workers based on CPU cores
            const numWorkers = Math.min(4, window.navigator.hardwareConcurrency - 1); // Leave one core free
            const workers = [];
            const promises = [];

            // Create and initialize workers
            for (let i = 0; i < numWorkers; i++) {
                const worker = new Worker('js/nestWorker.js');
                workers.push(worker);

                promises.push(new Promise((resolve) => {
                    worker.onmessage = (e) => {
                        if (e.data.type === 'result') {
                            // Rehydrate Path objects from plain objects
                            const rehydratedPlacements = e.data.placements.map(plainPath => {
                                const newPaths = plainPath.paths.map(p => p.map(pt => new Point(pt.x, pt.y)));
                                const newPath = new Path(newPaths, plainPath.originIndex, plainPath.color, plainPath.lcolor);
                                newPath.transformMatrix = plainPath.transformMatrix;
                                newPath.childIndex = plainPath.childIndex;
                                return newPath;
                            });
                            resolve({ placements: rehydratedPlacements, stats: e.data.stats });
                        } else if (e.data.type === 'progress') {
                            // Handle progress updates if needed
                        }
                    };
                }));

                // Each worker runs the complete algorithm
                worker.postMessage({
                    parts: this.partsVariants,
                    sheet: this.sheet,
                    gridSize: this.nfp.gridSize,
                    useNFP2: this.nfp instanceof NFP2
                });
            }

            // Wait for all workers to complete
            const workerResults = await Promise.all(promises);

            // Sum up stats and find best result
            const totalStats = {
                boundaryPointsTested: 0,
                collisionAvoided: 0,
                collisionChecks: 0
            };

            let bestPlacement = null;
            let bestArea = Infinity;

            workerResults.forEach(res => {
                // Sum stats
                if (res.stats) {
                    totalStats.boundaryPointsTested += (res.stats.boundaryPointsTested || 0);
                    totalStats.collisionAvoided += (res.stats.collisionAvoided || 0);
                    totalStats.collisionChecks += (res.stats.collisionChecks || 0);
                }

                // Check for best area
                const bounds = this.nfp.calculateTotalBounds(res.placements);
                const area = bounds.width * bounds.height;
                if (area < bestArea) {
                    bestArea = area;
                    bestPlacement = res.placements;
                }
            });

            // Update main NFP instance stats for display
            this.nfp.performanceStats = totalStats;

            // Clean up workers
            workers.forEach(worker => worker.terminate());

            result = bestPlacement;
        } else {
            // Single CPU mode
            result = this.nfp.findBestPosition(this.partsVariants, this.sheet, (a, b) => {
                this.currentProgress = a * 100 / b;
                this.drawProgress();
            }, this.nfp.gridSize);
        }

        // Calculate initial bounds and area
        const bounds = this.nfp.calculateTotalBounds(result);

        this.placedParts = result;

        // Recalculate final bounds and area
        const finalBounds = this.nfp.calculateTotalBounds(this.placedParts);
        const finalArea = (finalBounds.width * finalBounds.height) / (GEOM_SCALE * GEOM_SCALE);

        return {
            placements: this.placedParts,
            area: finalArea
        };
    }

    async startNestingWeb() {
        const startTime = performance.now();
        const currentRotation = this.rotation.value;
        const currentFlip = this.allowFlip.checked;
        const bestResult = await this.startNesting(parseFloat(this.spacing.value), parseFloat(this.sheetWidth.value), parseFloat(this.sheetHeight.value),
            parseFloat(this.gridSpacing.value), currentRotation, currentFlip, this.multiCPU.checked);
        // End timing
        const endTime = performance.now();
        const timeTaken = (endTime - startTime).toFixed(2);

        // Display performance statistics for NFP2
        this.displayPerformanceStats();
        if (this.hasui) {
            this.currentAreaDisplay.textContent = `${bestResult.area.toFixed(2)} mm² (${timeTaken}ms)`;

            // Update best solution if current is better
            if (!this.bestPlacedParts || bestResult.area < this.bestArea) {
                this.bestArea = bestResult.area;
                this.bestAreaDisplay.textContent = bestResult.area.toFixed(2) + " mm²";
                this.bestPlacedParts = bestResult.placements;
            }
        }

        // Redraw current solution
        if (bestResult.placements.length > 0 && bestResult.placements[0].lcolor == "#00ff00") {
            const b = bestResult.placements[0].getBounds();
            this.sheet2.width = b.width / GEOM_SCALE;
            this.sheet2.height = b.height / GEOM_SCALE;
        }
        this.currentSolutionCanvas.setSheet(this.sheet2.width, this.sheet2.height);
        this.bestSolutionCanvas.setSheet(this.sheet2.width, this.sheet2.height);
        this.drawResult();
    }

    async recompactCurrentSolution() {
        if (!this.placedParts || this.placedParts.length === 0) return;

        const startTime = performance.now();
        console.log("Starting manual recompaction...");

        // Run compaction logic (fine-grained sliding)
        this.placedParts = this.nfp.compactSolution(this.placedParts, this.sheet);

        // Recalculate area
        const bounds = this.nfp.calculateTotalBounds(this.placedParts);
        const area = (bounds.width * bounds.height) / (GEOM_SCALE * GEOM_SCALE);
        const timeTaken = (performance.now() - startTime).toFixed(2);

        this.currentAreaDisplay.textContent = `${area.toFixed(2)} mm² (Compacted in ${timeTaken}ms)`;

        // Update best if this compaction made it better
        if (!this.bestPlacedParts || area < this.bestArea) {
            this.bestArea = area;
            this.bestAreaDisplay.textContent = area.toFixed(2);
            this.bestPlacedParts = this.placedParts.map(part => part.clone());
        }

        this.drawResult();
    }

    async startNesting(offset, width, height, spacing = 1, rotation = [0], flip = false, multiCPU = false) {
        // Start timing
        const startTime = performance.now();

        // Update sheet dimensions
        this.sheet.width = width + offset * 4 + 10;
        this.sheet.height = height + offset * 4 + 10;
        this.nfp.setSpacing(spacing);

        // Update settings and generate variants only if parameters changed
        if (this.lastRotationValue !== rotation ||
            this.lastFlipValue !== flip || this.lastOffset !== offset || !this.partsVariants) {

            this.lastRotationValue = rotation;
            this.lastFlipValue = flip;
            this.lastOffset = offset;

            // Generate variants with the new parameters
            this.partsVariants = this.parts.map(part => this.generatePartVariants(part));
        }

        // Run nesting
        const bestResult = await this.runNesting(multiCPU);

        // End timing
        const endTime = performance.now();
        const timeTaken = (endTime - startTime).toFixed(2);

        if (this.hasui) {
            this.currentAreaDisplay.textContent = `${bestResult.area.toFixed(2)} mm² (${timeTaken}ms)`;

            // Update best solution if current is better
            if (!this.bestPlacedParts || bestResult.area < this.bestArea) {
                this.selectAsBest(false);
            }
        }

        return bestResult;
    }

    _getRotationAngles(rotationString) {
        if (!rotationString) {
            return [0];
        }

        // if it's one of the old integer values as a string
        const rotationInt = parseInt(rotationString);
        if (!rotationString.includes(',') && !isNaN(rotationInt)) {
            switch (rotationInt) {
                case 1: return [0];
                case 2: return [0, 180];
                case 3: return [0, 90];
                case 4: return [0, 90, 180, 270];
                case 8: return [0, 45, 90, 135, 180, 225, 270, 315];
            }
        }

        // Otherwise, parse as CSV
        const angles = rotationString.split(',')
            .map(s => parseFloat(s.trim()))
            .filter(n => !isNaN(n));

        return angles.length > 0 ? angles : [0];
    }

    drawParts() {
        if (!this.hasui) return;

        // Use nesting algorithm for preview layout without rotation, flip, or offset
        // Set sheet to 1x width and 3x height for vertical stacking
        const previewSheet = {
            width: this.sheet.width,
            height: this.sheet.height * 3
        };

        // Generate part variants without rotation or flip
        const partsVariants = this.parts.map(part => {
            const variant = part.clone();
            return {
                placed: false,
                color: part.color,
                lcolor: part.lcolor,
                originIndex: part.originIndex,
                childIndex: part.childIndex,
                variants: [variant]
            };
        });

        // Use nesting to position parts with grid size 4 for coarse placement
        const nestedResult = this.nfp.findBestPosition(
            partsVariants,
            previewSheet,
            () => { }, // No progress handler needed for preview
            25 * GEOM_SCALE // Grid size of 4 for coarse placement
        );

        this.previewCanvas.setParts(nestedResult);
        this.updatePathCounts();
    }

    drawResult() {
        if (!this.hasui) return;
        this.currentSolutionCanvas.setParts(this.placedParts);
        this.bestSolutionCanvas.setParts(this.bestPlacedParts);
        this.updatePathCounts();
    }

    updatePathCounts() {
        if (!this.hasui) return;

        // Update input path count
        document.getElementById('inputPathCount').textContent = this.parts.length;

        // Update current solution path count
        document.getElementById('currentPathCount').textContent = this.placedParts.length;

        // Update best solution path count
        document.getElementById('bestPathCount').textContent =
            this.bestPlacedParts ? this.bestPlacedParts.length : 0;
    }



    _generateColor(index) {
        const colors = [
            '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
            '#ff8000', '#ff0080', '#80ff00', '#00ff80', '#8000ff', '#0080ff'
        ];
        return colors[index % colors.length];
    }

    selectAsBest(redraw = false) {
        // Update best solution
        if (this.placedParts.length === 0) return;

        const bounds = this.nfp.calculateTotalBounds(this.placedParts);
        const area = (bounds.width * bounds.height) / (GEOM_SCALE * GEOM_SCALE);

        this.bestArea = area;
        this.bestAreaDisplay.textContent = area.toFixed(2) + " mm²";
        // Deep clone the current solution
        this.bestPlacedParts = this.placedParts.map(part => part.clone());

        // this.drawBestSolution();
        if (redraw) this.drawResult();
        this.copyBestSolution();
    }

    svgFromSolution(solution = this.bestPlacedParts) {
        // Create SVG content
        const bounds = this.nfp.calculateTotalBounds(solution);
        let svgContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}mm" height="${bounds.height}mm" viewBox="0 0 ${bounds.width} ${bounds.height}">`;

        // Add each part as a path
        solution.forEach((part, index) => {
            svgContent += part.toSVGPath();
        });

        svgContent += '</svg>';

        // Create download link
        return svgContent;
    }

    downloadBestSolution() {
        if (!this.bestPlacedParts || this.bestPlacedParts.length === 0) return;

        // Create SVG content
        const svgtxt = this.svgFromSolution();
        const svgContent = new Blob([svgtxt], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(svgContent);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'best_solution.svg';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    async copyBestSolution() {
        if (!this.bestPlacedParts || this.bestPlacedParts.length === 0) return;

        try {
            // Create SVG content
            const svgData = this.svgFromSolution();

            // Create FormData object
            const formData = new FormData();
            formData.append('svg_data', new Blob([svgData], { type: 'image/svg+xml' }), 'solution.svg');
            // Add formData for Inkscape
            formData.append('inkscape', 'n');

            // Send the best solution to background using multipart form data
            fetch('http://localhost:3000/upload-svg', {
                method: 'POST',
                body: formData
            })
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Failed to save solution');
                    }
                    return response.json();
                })
                .then(data => {
                    console.log('Solution saved:', data);
                    //alert('Solution saved successfully!');
                })
                .catch(error => {
                    console.error('Error saving solution:', error);
                    //alert('Failed to save solution');
                });
        } catch (error) {
            console.error('Error copying SVG:', error);
            alert('Failed to export SVG solution');
        }
    }

    drawProgress() {
        if (!this.hasui) return; // Skip 
        const progressFill = document.querySelector('.progress-fill');
        const progressText = document.querySelector('.progress-text');

        progressFill.style.width = `${this.currentProgress}%`;
        progressText.textContent = `Progress: ${Math.round(this.currentProgress)}%`;
    }

    forceUIUpdate() {
        // Force a reflow/repaint using the progress bar elements
        const progressBar = document.getElementById('progressBar');
        const progressFill = document.getElementById('progressFill');
        // progressBar.getBoundingClientRect();
        progressFill.style.width = `${this.currentProgress}%`;
    }

    startSvgCheck() {
        // Check every 1 second
        this.checkInterval = setInterval(async () => {
            try {
                const response = await fetch('http://localhost:3000/check-svg-timestamp');
                const data = await response.json();

                if (data.timestamp && data.timestamp !== this.lastSvgTimestamp) {
                    this.lastSvgTimestamp = data.timestamp;
                    await this.fetchStoredSVG();
                }
            } catch (error) {
                console.error('Error checking SVG timestamp:', error);
            }
        }, 2000);
    }

    stopSvgCheck() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }


}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new NestingApp(true);
});
