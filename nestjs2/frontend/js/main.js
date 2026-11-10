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
        this.lastSvgTimestamp = null;
        this.checkInterval = null;
        this.algorithm = 'optimized';  // Default algorithm
        this.isNesting = false;     // Whether a nesting run is currently in progress
        this.nestingStopRequested = false; // Set when Stop is pressed; breaks infinite loop
        this.abortController = null; // Controller for the current running run (cancellation)
        // GA hyper-parameters (defaults: kecil biar 1 iterasi terasa ringan).
        this.gaParams = { popSize: 6, generations: 5, mutationRate: 0.1 };
        // Cache for parsed rotation angle lists (keyed by rotation input string)
        this._rotationAnglesCache = new Map();
        // Map of originIndex -> source part (rebuilt whenever this.parts changes)
        this.partsByOriginIndex = new Map();

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
        this.stopButton = document.getElementById('stopNest');
        this.useNFP2Checkbox = document.getElementById('algorithm');
        this.gaParamsBox = document.getElementById('gaParams');
        this.gaPopSize = document.getElementById('gaPopSize');
        this.gaGenerations = document.getElementById('gaGenerations');
        this.gaMutation = document.getElementById('gaMutation');
        this.selectAsBestButton = document.getElementById('selectAsBest');
        this.downloadBestButton = document.getElementById('downloadBest');
        this.loadBestButton = document.getElementById('loadBestToCurrent');
        this.recompactCurrentButton = document.getElementById('recompactCurrent');
        this.renestOutsideButton = document.getElementById('renestOutside');
        this.currentAreaDisplay = document.getElementById('currentArea');
        this.bestAreaDisplay = document.getElementById('bestArea');
        this.enableDragDrop = document.getElementById('enableDragDrop');
        this.rKeyHint = document.getElementById('rKeyHint');
        this.infiniteNestingCheckbox = document.getElementById('infiniteNesting');

        // Cache frequently-updated DOM elements (avoids per-frame querySelector lookups)
        this.progressFillEl = document.querySelector('.progress-fill');
        this.progressTextEl = document.querySelector('.progress-text');
        this.inputPathCountEl = document.getElementById('inputPathCount');
        this.currentPathCountEl = document.getElementById('currentPathCount');
        this.bestPathCountEl = document.getElementById('bestPathCount');

        // Initialize drag variant state
        this.dragVariants = [];       // all possible variants for dragged part
        this.dragVariantIndex = 0;    // current cycle index
        this.dragOriginalPart = null; // original part reference in placedParts

        // Initialize canvases
        this.previewCanvas = new Canvas('previewCanvas');
        this.currentSolutionCanvas = new Canvas('currentSolutionCanvas');
        this.bestSolutionCanvas = new Canvas('bestSolutionCanvas');

        // Set up event listeners
        this.svgInput.addEventListener('change', this.handleSVGUpload.bind(this));
        this.startButton.addEventListener('click', this.startNestingWeb.bind(this));
        if (this.stopButton) {
            this.stopButton.addEventListener('click', this.stopNesting.bind(this));
        }
        this.sheetWidth.addEventListener('change', this.updateSheet.bind(this));
        this.sheetHeight.addEventListener('change', this.updateSheet.bind(this));
        this.spacing.addEventListener('change', () => {
            this.nfp.setSpacing(parseFloat(this.spacing.value));
        });
        this.allowFlip.addEventListener('change', () => {
            this.nfp.setAllowFlip(this.allowFlip.checked);
            this.partsVariants = null;
        });
        this.rotation.addEventListener('change', () => {
            this.partsVariants = null;
        });
        this.selectAsBestButton.addEventListener('click', this.selectAsBest.bind(this));
        this.downloadBestButton.addEventListener('click', this.downloadBestSolution.bind(this));
        this.loadBestButton.addEventListener('click', this.loadBestToCurrent.bind(this));
        this.useNFP2Checkbox.addEventListener('change', this.toggleNFPAlgorithm.bind(this));
        this.updateGAParamsVisibility();
        for (const el of [this.gaPopSize, this.gaGenerations, this.gaMutation]) {
            if (el) el.addEventListener('change', () => {
                this.readGAParams();
                this.saveLastUsedSettings();
            });
        }
        this.recompactCurrentButton.addEventListener('click', this.recompactCurrentSolution.bind(this));
        this.renestOutsideButton.addEventListener('click', this.startRenestingWeb.bind(this));
        this.enableDragDrop.addEventListener('change', this.toggleDragDrop.bind(this));

        // Set up drag-drop and R-key callbacks
        this.currentSolutionCanvas.onDragEnd = this.handleDragDrop.bind(this);
        this.currentSolutionCanvas.onDoubleClickPart = this.onPartDoubleClick.bind(this);
        this.currentSolutionCanvas.onRotateDrag = this.handleRotateDrag.bind(this);
        this.currentSolutionCanvas.onDragStart = (part) => {
            // Reset variant state so R key rebuilds variants for the newly dragged part
            this.dragVariants = [];
            this.dragVariantIndex = 0;
        };

        // Show R-key hint when drag is enabled
        this.enableDragDrop.addEventListener('change', () => {
            if (this.rKeyHint) {
                this.rKeyHint.style.display = this.enableDragDrop.checked ? 'inline' : 'none';
            }
        });

        // Init panel resizers
        this.initResizers();

        // Presets UI elements
        this.presetSelect = document.getElementById('presetSelect');
        this.presetNameInput = document.getElementById('presetNameInput');
        this.savePresetButton = document.getElementById('savePreset');
        this.deletePresetButton = document.getElementById('deletePreset');

        if (this.presetSelect && this.presetNameInput && this.savePresetButton && this.deletePresetButton) {
            this.savePresetButton.addEventListener('click', this.savePreset.bind(this));
            this.deletePresetButton.addEventListener('click', this.deletePreset.bind(this));
            this.presetSelect.addEventListener('change', this.onPresetSelectChange.bind(this));
            this.updatePresetDropdown();
            this.loadLastUsedSettings();

            const inputsToTrack = [
                this.sheetWidth, this.sheetHeight, this.rotation,
                this.spacing, this.gridSpacing, this.allowFlip,
                this.multiCPU, this.useNFP2Checkbox,
                this.gaPopSize, this.gaGenerations, this.gaMutation
            ];
            inputsToTrack.forEach(input => {
                if (input) {
                    input.addEventListener('change', () => this.saveLastUsedSettings());
                }
            });
        }
    }

    /**
     * Calculate comparison score for solution quality
     * Lower score = better solution
     * Considers both area (lower is better) and object count (higher is better)
     * n = 10 * 10^(digits-1) where digits = number of digits in area
     * score = area - (objectCount * n)
     */
    calculateSolutionScore(area, objectCount) {
        if (area <= 0 || objectCount <= 0) return Infinity;
        const digits = Math.floor(Math.log10(area)) + 1;
        const n = 10 * Math.pow(10, digits - 1);
        return area - (objectCount * n);
    }

    /**
     * Check if new solution is better than current best
     */
    isBetterSolution(newArea, newCount, bestArea, bestCount) {
        if (bestArea === Infinity) return true;
        const newScore = this.calculateSolutionScore(newArea, newCount);
        const bestScore = this.calculateSolutionScore(bestArea, bestCount);
        return newScore < bestScore;
    }

    toggleDragDrop() {
        this.currentSolutionCanvas.setDragEnabled(this.enableDragDrop.checked);
    }

    initResizers() {
        // Vertical resizer (left panel width)
        const resizerV = document.getElementById('resizerV');
        const leftPanel = document.getElementById('leftPanel');
        if (resizerV && leftPanel) {
            let dragging = false;
            resizerV.addEventListener('mousedown', (e) => {
                dragging = true;
                resizerV.classList.add('dragging');
                document.body.style.userSelect = 'none';
                document.body.style.cursor = 'col-resize';
                e.preventDefault();
            });
            document.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                const containerRect = document.querySelector('.container').getBoundingClientRect();
                const newWidth = Math.max(160, Math.min(e.clientX - containerRect.left, containerRect.width * 0.6));
                leftPanel.style.width = newWidth + 'px';
                leftPanel.style.flex = 'none';
            });
            document.addEventListener('mouseup', () => {
                if (dragging) {
                    dragging = false;
                    resizerV.classList.remove('dragging');
                    document.body.style.userSelect = '';
                    document.body.style.cursor = '';
                    // Trigger canvas resize
                    this.currentSolutionCanvas.resize();
                    this.bestSolutionCanvas.resize();
                    this.previewCanvas.resize();
                }
            });
        }

        // Horizontal resizer (current vs best solution height)
        const resizerH = document.getElementById('resizerH');
        const currentPanel = document.getElementById('currentPanel');
        const bestPanel = document.getElementById('bestPanel');
        if (resizerH && currentPanel && bestPanel) {
            let dragging = false;
            resizerH.addEventListener('mousedown', (e) => {
                dragging = true;
                resizerH.classList.add('dragging');
                document.body.style.userSelect = 'none';
                document.body.style.cursor = 'row-resize';
                e.preventDefault();
            });
            document.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                const solutionsEl = document.querySelector('.solutions');
                const rect = solutionsEl.getBoundingClientRect();
                const totalH = rect.height;
                const relY = e.clientY - rect.top;
                const clamped = Math.max(60, Math.min(relY, totalH - 60));
                currentPanel.style.flex = 'none';
                currentPanel.style.height = clamped + 'px';
                bestPanel.style.flex = '1';
                bestPanel.style.height = '';
            });
            document.addEventListener('mouseup', () => {
                if (dragging) {
                    dragging = false;
                    resizerH.classList.remove('dragging');
                    document.body.style.userSelect = '';
                    document.body.style.cursor = '';
                    this.currentSolutionCanvas.resize();
                    this.bestSolutionCanvas.resize();
                }
            });
        }
    }

    /**
     * Called by canvas when R key is pressed during drag.
     * Cycles through all available variant orientations for the dragged part.
     * @param {Path} currentPart - The part currently being dragged (may be a temp clone)
     * @param {Object} worldPos - Current drag mouse position {x, y}
     * @returns {Path} The new variant to use as the dragged part
     */
    handleRotateDrag(currentPart, worldPos) {
        if (!this.dragVariants || this.dragVariants.length === 0) {
            // Build variants list for this part on first R press
            const originIndex = currentPart.originIndex;
            const originalSource = this.partsByOriginIndex.get(originIndex);
            if (!originalSource) return null;

            const rotations = this._getRotationAngles(this.rotation.value);
            const flip = this.allowFlip.checked;

            this.dragVariants = [];
            for (const angle of rotations) {
                const v = originalSource.clone();
                if (angle !== 0) v.rotate(angle); else v.align();
                this.dragVariants.push({ part: v, label: `${angle}°` });
                if (flip) {
                    const vf = originalSource.clone();
                    if (angle !== 0) vf.rotate(angle); else vf.align();
                    vf.flip();
                    this.dragVariants.push({ part: vf, label: `${angle}°F` });
                }
            }

            this.dragVariantIndex = 0;
        }

        // Cycle to next variant
        this.dragVariantIndex = (this.dragVariantIndex + 1) % this.dragVariants.length;
        const nextVariant = this.dragVariants[this.dragVariantIndex].part.clone();

        // Position the new variant so its centre aligns with current drag position
        const vBounds = nextVariant.getBounds();
        const targetX = worldPos.x * GEOM_SCALE - vBounds.width / 2;
        const targetY = worldPos.y * GEOM_SCALE - vBounds.height / 2;
        nextVariant.translate(targetX - vBounds.x, targetY - vBounds.y);

        // Replace current part in placedParts with the new variant
        const idx = this.placedParts.indexOf(currentPart);
        if (idx !== -1) {
            nextVariant.color = currentPart.color;
            nextVariant.lcolor = currentPart.lcolor;
            this.placedParts[idx] = nextVariant;
            this.currentSolutionCanvas.parts = this.placedParts;
        }

        return nextVariant;
    }

    readGAParams() {
        const pop = parseInt(this.gaPopSize && this.gaPopSize.value, 10);
        const gen = parseInt(this.gaGenerations && this.gaGenerations.value, 10);
        const mut = parseFloat(this.gaMutation && this.gaMutation.value);
        this.gaParams = {
            popSize: Math.min(50, Math.max(2, pop || 6)),
            generations: Math.min(200, Math.max(1, gen || 5)),
            mutationRate: Math.min(1, Math.max(0, isNaN(mut) ? 0.1 : mut))
        };
    }

    updateGAParamsVisibility() {
        if (!this.gaParamsBox || !this.useNFP2Checkbox) return;
        this.gaParamsBox.style.display = this.useNFP2Checkbox.value === 'ga' ? '' : 'none';
    }

    getSettingsData() {
        return {
            sheetWidth: parseFloat(this.sheetWidth.value) || 1000,
            sheetHeight: parseFloat(this.sheetHeight.value) || 1000,
            rotation: this.rotation.value || "0,90,180,270",
            spacing: parseFloat(this.spacing.value) || 0,
            gridSpacing: parseFloat(this.gridSpacing.value) || 4,
            allowFlip: this.allowFlip.checked,
            multiCPU: this.multiCPU.checked,
            algorithm: this.useNFP2Checkbox.value || "optimized",
            gaPopSize: parseInt(this.gaPopSize && this.gaPopSize.value, 10) || 6,
            gaGenerations: parseInt(this.gaGenerations && this.gaGenerations.value, 10) || 5,
            gaMutation: parseFloat(this.gaMutation && this.gaMutation.value) || 0.1
        };
    }

    applySettingsData(data) {
        if (!data) return;
        if (data.sheetWidth !== undefined) this.sheetWidth.value = data.sheetWidth;
        if (data.sheetHeight !== undefined) this.sheetHeight.value = data.sheetHeight;
        if (data.rotation !== undefined) this.rotation.value = data.rotation;
        if (data.spacing !== undefined) this.spacing.value = data.spacing;
        if (data.gridSpacing !== undefined) this.gridSpacing.value = data.gridSpacing;
        if (data.allowFlip !== undefined) this.allowFlip.checked = data.allowFlip;
        if (data.multiCPU !== undefined) this.multiCPU.checked = data.multiCPU;
        if (data.algorithm !== undefined) this.useNFP2Checkbox.value = data.algorithm;
        if (data.gaPopSize !== undefined && this.gaPopSize) this.gaPopSize.value = data.gaPopSize;
        if (data.gaGenerations !== undefined && this.gaGenerations) this.gaGenerations.value = data.gaGenerations;
        if (data.gaMutation !== undefined && this.gaMutation) this.gaMutation.value = data.gaMutation;

        // Trigger updates in nesting classes & canvas
        this.updateSheet();
        this.initializeNFP();
        this.nfp.setSpacing(parseFloat(this.spacing.value));
        this.nfp.setAllowFlip(this.allowFlip.checked);
        this.updateGAParamsVisibility();
        this.readGAParams();
        this.partsVariants = null; // Cache needs to be reset
    }

    saveLastUsedSettings() {
        const data = this.getSettingsData();
        localStorage.setItem('nestjs_last_params', JSON.stringify(data));
    }

    loadLastUsedSettings() {
        try {
            const raw = localStorage.getItem('nestjs_last_params');
            if (raw) {
                const data = JSON.parse(raw);
                this.applySettingsData(data);
            }
        } catch (e) {
            console.error('Error loading last used settings:', e);
        }
    }

    getPresets() {
        try {
            const raw = localStorage.getItem('nestjs_presets');
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.error('Error reading presets:', e);
            return {};
        }
    }

    savePresets(presets) {
        localStorage.setItem('nestjs_presets', JSON.stringify(presets));
    }

    savePreset() {
        const name = this.presetNameInput.value.trim();
        if (!name) {
            alert('Please enter a preset name');
            return;
        }
        const presets = this.getPresets();
        presets[name] = this.getSettingsData();
        this.savePresets(presets);
        this.presetNameInput.value = '';
        this.updatePresetDropdown(name);
    }

    deletePreset() {
        const name = this.presetSelect.value;
        if (!name) {
            alert('Please select a preset to delete');
            return;
        }
        const presets = this.getPresets();
        delete presets[name];
        this.savePresets(presets);
        this.updatePresetDropdown();
    }

    onPresetSelectChange() {
        const name = this.presetSelect.value;
        if (!name) return;
        const presets = this.getPresets();
        const data = presets[name];
        if (data) {
            this.applySettingsData(data);
            this.saveLastUsedSettings();
        }
    }

    updatePresetDropdown(selectedName = '') {
        const presets = this.getPresets();
        this.presetSelect.innerHTML = '<option value="">-- Select Preset --</option>';
        Object.keys(presets).sort().forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            if (name === selectedName) {
                option.selected = true;
            }
            this.presetSelect.appendChild(option);
        });
    }

    handleDragDrop(part, x, y, isDragging) {
        if (!this.placedParts || this.placedParts.length === 0) return false;

        // If part is forced outside, we skip ALL collision and boundary checks
        if (part.isForcedOutside) {
            if (!isDragging) {
                this.updateCurrentSolutionArea();
            }
            return true;
        }

        if (isDragging) {
            // Part is already at target position (canvas moves before checking)
            const isValid = this.nfp.checkDragPlacement(
                part, x, y, this.placedParts, this.sheet
            );

            // Track which parts collide with dragged part
            this.currentSolutionCanvas.collidingParts.clear();
            if (!isValid) {
                this._findCollidingParts(part);
            }
            return isValid;
        } else {
            // On release: just perform final validation at current position
            const bounds = part.getBounds();
            const currentX = bounds.x / GEOM_SCALE;
            const currentY = bounds.y / GEOM_SCALE;

            const isValid = this.nfp.checkDragPlacement(
                part, currentX, currentY, this.placedParts, this.sheet
            );

            if (isValid) {
                this.updateCurrentSolutionArea();
                return true;
            }

            // If current position is invalid, canvas.js will revert to lastValidPos
            return false;
        }
    }

    _findCollidingParts(draggedPart) {
        const bounds = draggedPart.getBounds();
        const bx = bounds.x;
        const by = bounds.y;
        const bw = bounds.width;
        const bh = bounds.height;

        for (const placed of this.placedParts) {
            if (placed === draggedPart) continue;

            const pb = placed.getBounds();
            // AABB check
            if (bx > pb.x + pb.width || bx + bw < pb.x ||
                by > pb.y + pb.height || by + bh < pb.y) {
                continue;
            }

            // Precise check
            if (placed.lcolor === "#00ff00") {
                if (GeometryUtil.polyOutside(draggedPart, placed)) {
                    this.currentSolutionCanvas.collidingParts.add(placed);
                }
            } else if (draggedPart.polygonsIntersect(placed, true)) {
                this.currentSolutionCanvas.collidingParts.add(placed);
            }
        }
    }

    /**
     * Material utilization of a solution: total part outline area divided by
     * the bounding-box area. Pure read of existing data (shoelace via
     * getSignedArea + calculateTotalBounds) — no geometry is modified.
     * Returns 0 when there is nothing to measure.
     */
    calculateUtilization(solution) {
        if (!solution || solution.length === 0) return 0;
        const bounds = this.nfp.calculateTotalBounds(solution);
        const boxArea = (bounds.width * bounds.height) / (GEOM_SCALE * GEOM_SCALE);
        if (!(boxArea > 0)) return 0;
        let partArea = 0;
        for (const p of solution) {
            if (p.lcolor === "#00ff00") continue;
            if (!p.paths || p.paths.length === 0) continue;
            partArea += Math.abs(Path.getSignedArea(p.paths[0])) / (GEOM_SCALE * GEOM_SCALE);
        }
        return partArea / boxArea;
    }

    updateCurrentSolutionArea() {
        if (!this.placedParts || this.placedParts.length === 0) return;

        const bounds = this.nfp.calculateTotalBounds(this.placedParts);
        const area = (bounds.width * bounds.height) / (GEOM_SCALE * GEOM_SCALE);
        const util = this.calculateUtilization(this.placedParts);
        this.currentAreaDisplay.textContent = `${area.toFixed(2)} mm² (${(util * 100).toFixed(1)}%)`;

        // Update best if better (considering both area and object count)
        const newCount = this.placedParts.filter(p => p.lcolor !== "#00ff00").length;
        const bestCount = this.bestPlacedParts ? this.bestPlacedParts.filter(p => p.lcolor !== "#00ff00").length : 0;
        if (!this.bestPlacedParts || this.isBetterSolution(area, newCount, this.bestArea, bestCount)) {
            this.bestArea = area;
            this.bestAreaDisplay.textContent = `${area.toFixed(2)} mm² (${(util * 100).toFixed(1)}%)`;
            this.bestPlacedParts = this.placedParts.map(p => p.clone());
            this.bestSolutionCanvas.setParts(this.bestPlacedParts);
        }
    }

    /**
     * Initialize the NFP algorithm based on UI selection
     */
    initializeNFP() {
        const algorithm = this.useNFP2Checkbox ? this.useNFP2Checkbox.value : this.algorithm;
        this.algorithm = algorithm;

        if (algorithm === 'nfp2') {
            this.nfp = new NFP2();
            console.log('Using True NFP Algorithm (NFP2)');
        } else if (algorithm === 'optimized') {
            this.nfp = new NFPOptimized();
            console.log('Using Optimized Algorithm (Bottom-Left Fill + SAT)');
        } else if (algorithm === 'ga') {
            this.nfp = new NFPGA();
            console.log('Using GA + NFP2 Algorithm');
        } else {
            this.nfp = new NFP();
            console.log('Using Original Grid Algorithm');
        }
    }

    /**
     * Toggle between NFP algorithms when selector changes
     */
    toggleNFPAlgorithm() {
        this.initializeNFP();
        // Reset parts variants cache when algorithm changes
        this.partsVariants = null;
        this.gaSeedOrder = null;
        this.updateGAParamsVisibility();
        this.readGAParams();
        this.saveLastUsedSettings();
        console.log(`Algorithm switched to: ${this.algorithm}`);
    }

    /**
     * Display performance statistics for current algorithm
     */
    displayPerformanceStats() {
        const stats = this.nfp.getPerformanceStats();
        if (!stats) return;

        if (this.nfp instanceof NFPGA) {
            console.log('GA Statistics:', {
                'Generations': stats.generations,
                'Evaluations': stats.evaluations,
                'Collision Checks': stats.collisionChecks
            });
        } else if (this.nfp instanceof NFP2) {
            console.log('NFP2 Performance Statistics:', {
                'Boundary Points Tested': stats.boundaryPointsTested,
                'Collisions Avoided': stats.collisionAvoided,
                'Actual Intersection Checks': stats.collisionChecks
            });
        } else if (this.nfp instanceof NFPOptimized) {
            console.log('Optimized Algorithm Performance:', {
                'Collision Checks': stats.collisionChecks
            });
        } else {
            console.log('Grid Performance Statistics:', {
                'Actual Intersection Checks': stats.collisionChecks
            });
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
                    });
                    // Remove the inner part from the array
                    this.parts[j].paths = []; // we delete later
                }
            }
        }

        // Remove parts with empty paths
        this.parts = this.parts.filter(part => part.paths.length > 0);


        // Calculate total area of all parts and set sheet size
        let totalArea = 0;
        for (const part of this.parts) {
            part.align();
            const bounds = part.getBounds();
            totalArea += bounds.width * bounds.height;
            part.size = bounds.width * bounds.height;
        }
        // Sort parts from bigger to smaller size
        this.parts.sort((a, b) => b.size - a.size);

        // Rebuild originIndex -> source part lookup map (used by renest / rotate-drag)
        this.partsByOriginIndex = new Map();
        for (const part of this.parts) this.partsByOriginIndex.set(part.originIndex, part);

        // Set sheet size to square root of total area, with some padding
        const padding = 2; // 20% extra space
        const side = Math.max(100, Math.ceil(Math.sqrt(totalArea * padding) / GEOM_SCALE));
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
        this.gaSeedOrder = null;
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
        this.sheet.width = Math.max(100, parseFloat(this.sheetWidth.value) || 1000);
        this.sheet.height = Math.max(100, parseFloat(this.sheetHeight.value) || 1000);
        this.sheet2.width = this.sheet.width;
        this.sheet2.height = this.sheet.height;
        this.previewCanvas.setSheet(this.sheet.width, this.sheet.height);
    }
    generatePartVariants(part) {
        const variants = [];
        const rotations = this._getRotationAngles(this.lastRotationValue);
        const opart = part.clone().offset(this.lastOffset);
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
    /**
     * Toggle the UI between "nesting" and "idle" states.
     * Disables the Start button and shows the Stop button while running,
     * so the user cannot start a second run while one is in progress and
     * can abort a long-running run.
     */
    setNestingRunning(running) {
        this.isNesting = running;
        if (!this.hasui) return;
        if (running) {
            if (this.startButton) {
                this.startButton.disabled = true;
                this.startButton.textContent = '⏳ Nesting...';
            }
            if (this.stopButton) {
                this.stopButton.style.display = '';
                this.stopButton.disabled = false;
            }
        } else {
            if (this.startButton) {
                this.startButton.disabled = false;
                this.startButton.textContent = '▶ Start Nesting';
            }
            if (this.stopButton) {
                this.stopButton.style.display = 'none';
                this.stopButton.disabled = true;
            }
        }
    }

    /**
     * Abort the currently running nesting run.
     * Terminates the active workers and rejects any still-pending worker
     * promises so the awaiting runNesting() call short-circuits cleanly.
     */
    stopNesting() {
        if (!this.isNesting) return;
        this.nestingStopRequested = true;
        const controller = this.abortController;
        if (controller) {
            controller.aborted = true;
            // Terminate all live workers so they stop consuming CPU immediately
            if (controller.workers) {
                controller.workers.forEach(w => {
                    try { w.terminate(); } catch (e) { /* ignore */ }
                });
                controller.workers = [];
            }
            // Reject any still-pending worker promises
            if (controller.abortCallbacks) {
                controller.abortCallbacks.forEach(cb => {
                    try { cb(); } catch (e) { /* ignore */ }
                });
                controller.abortCallbacks = [];
            }
        }
    }

    _rehydratePlacements(plainPlacements) {
        if (!plainPlacements) return [];
        return plainPlacements.map(plainPath => {
            const newPaths = plainPath.paths.map(p => p.map(pt => new Point(pt.x, pt.y)));
            const newPath = new Path(newPaths, plainPath.originIndex, plainPath.color, plainPath.lcolor);
            newPath.transformMatrix = plainPath.transformMatrix;
            newPath.childIndex = plainPath.childIndex;
            return newPath;
        });
    }

    async runNesting(multiCPU = false, initialPlacements = []) {
        this.nfp.setAllowFlip(this.lastFlipValue || false);
        if (this.algorithm === 'ga') this.readGAParams();

        this.currentProgress = 0;
        this.drawProgress();

        // Clear last-placements state; a fresh Start nesting rebuilds everything.
        this.nfp.lastPlacements = [];

        // Convert initialPlacements to transferable format for workers
        const transferableInitial = initialPlacements.map(part => ({
            paths: part.paths.map(p => p.map(pt => ({ x: pt.x, y: pt.y }))),
            color: part.color,
            lcolor: part.lcolor,
            originIndex: part.originIndex,
            childIndex: part.childIndex,
            transformMatrix: [...part.transformMatrix]
        }));

        // Always run the actual nesting inside Web Workers so the main thread
        // (and therefore the UI / Stop button) stays responsive. When multiCPU
        // is enabled we still spread the work across several workers and keep
        // the best result; otherwise a single worker is used.
        const numWorkers = (multiCPU && window.navigator.hardwareConcurrency > 1)
            ? Math.min(4, window.navigator.hardwareConcurrency - 1)
            : 1;

        const workerPayload = {
            parts: this.partsVariants,
            sheet: this.sheet,
            gridSize: this.nfp.gridSize,
            algorithm: this.algorithm,
            gaParams: this.algorithm === 'ga' ? this.gaParams : undefined,
            seedOrder: this.algorithm === 'ga' ? (this.gaSeedOrder || null) : undefined,
            initialPlacements: transferableInitial
        };

        // Fresh abort controller for this run
        const controller = this.abortController = {
            aborted: false,
            workers: [],
            abortCallbacks: [],
            latestPartial: null
        };

        const workers = [];
        const promises = [];
        const rehydrate = this._rehydratePlacements.bind(this);

        for (let i = 0; i < numWorkers; i++) {
            const worker = new Worker('js/nestWorker.js');
            workers.push(worker);
            controller.workers.push(worker);

            promises.push(new Promise((resolve, reject) => {
                let settled = false;
                worker.onmessage = (e) => {
                    if (settled) return;
                    const data = e.data;
                    if (data.type === 'progress') {
                        if (this.hasui) {
                            this.currentProgress = data.progress;
                            this.drawProgress();
                        }
                    } else if (data.type === 'partial') {
                        // Snapshot the latest partial placements in case the run is aborted
                        controller.latestPartial = data.placements;
                    } else if (data.type === 'result') {
                        settled = true;
                        if (data.bestOrder) this.gaSeedOrder = data.bestOrder;
                        resolve({ placements: rehydrate(data.placements), stats: data.stats });
                    }
                };
                worker.onerror = (err) => {
                    if (settled) return;
                    settled = true;
                    reject(err);
                };
                // Allow stopNesting to reject this still-pending promise
                controller.abortCallbacks.push(() => {
                    if (settled) return;
                    settled = true;
                    reject(new Error('aborted'));
                });
            }));

            worker.postMessage(workerPayload);
        }

        let workerResults;
        try {
            workerResults = await Promise.all(promises);
        } catch (e) {
            // Make sure no workers are left running regardless of why we got here
            workers.forEach(w => { try { w.terminate(); } catch (err) { /* ignore */ } });
            if (controller.aborted) {
                // On user-initiated abort, prefer the latest partial snapshot if any
                const partial = controller.latestPartial;
                if (partial) {
                    this.placedParts = rehydrate(partial);
                    this.nfp.lastPlacements = this.placedParts;
                    const bounds = this.nfp.calculateTotalBounds(this.placedParts);
                    return {
                        placements: this.placedParts,
                        area: (bounds.width * bounds.height) / (GEOM_SCALE * GEOM_SCALE),
                        aborted: true
                    };
                }
                return { placements: [], area: Infinity, aborted: true };
            }
            throw e;
        }

        // Clean up workers (already finished)
        workers.forEach(w => w.terminate());

        // Sum stats across all workers and pick the best (lowest bounding area) result
        const totalStats = {
            boundaryPointsTested: 0,
            collisionAvoided: 0,
            collisionChecks: 0,
            generations: 0,
            evaluations: 0
        };
        let bestPlacement = null;
        let bestArea = Infinity;

        for (const res of workerResults) {
            if (res.stats) {
                totalStats.boundaryPointsTested += (res.stats.boundaryPointsTested || 0);
                totalStats.collisionAvoided += (res.stats.collisionAvoided || 0);
                totalStats.collisionChecks += (res.stats.collisionChecks || 0);
                totalStats.generations += (res.stats.generations || 0);
                totalStats.evaluations += (res.stats.evaluations || 0);
                if (res.stats.bestFitness !== undefined && res.stats.bestFitness !== Infinity) {
                    if (totalStats.bestFitness === undefined || res.stats.bestFitness < totalStats.bestFitness) {
                        totalStats.bestFitness = res.stats.bestFitness;
                    }
                }
            }
            const bounds = this.nfp.calculateTotalBounds(res.placements);
            const area = bounds.width * bounds.height;
            if (area < bestArea) {
                bestArea = area;
                bestPlacement = res.placements;
            }
        }
        this.nfp.performanceStats = totalStats;

        this.placedParts = bestPlacement || [];

        // Persist the last full-nest result so renesting can reuse it as
        // fixed obstacles (this happens on the main-thread nfp instance,
        // which is what startRenestingWeb drives directly).
        this.nfp.lastPlacements = this.placedParts;

        // Deduplicate by originIndex to guard against any duplicate initialPlacements
        // that may have leaked into the worker output (safety net for past or future bugs).
        if (initialPlacements && initialPlacements.length > 0) {
            const seen = new Set();
            const deduped = [];
            for (const p of this.placedParts) {
                if (!seen.has(p.originIndex)) {
                    seen.add(p.originIndex);
                    deduped.push(p);
                }
            }
            this.placedParts = deduped;

            // Ensure every initialPlacement is present (worker may have dropped some)
            for (const initPart of initialPlacements) {
                if (!seen.has(initPart.originIndex)) {
                    this.placedParts.push(initPart);
                    seen.add(initPart.originIndex);
                }
            }
        }

        const finalBounds = this.nfp.calculateTotalBounds(this.placedParts);
        const finalArea = (finalBounds.width * finalBounds.height) / (GEOM_SCALE * GEOM_SCALE);

        return { placements: this.placedParts, area: finalArea };
    }

    async startNestingWeb() {
        if (this.isNesting) return; // Re-entrancy guard: already running
        if (!this.parts || this.parts.length === 0) return;

        const infinite = this.infiniteNestingCheckbox ? this.infiniteNestingCheckbox.checked : false;
        this.nestingStopRequested = false;
        this.setNestingRunning(true);
        const currentRotation = this.rotation.value;
        const currentFlip = this.allowFlip.checked;
        try {
            do {
                const iterStart = performance.now();
                const bestResult = await this.startNesting(parseFloat(this.spacing.value), parseFloat(this.sheetWidth.value), parseFloat(this.sheetHeight.value),
                    parseFloat(this.gridSpacing.value), currentRotation, currentFlip, this.multiCPU.checked);
                // End timing
                const timeTaken = (performance.now() - iterStart).toFixed(2);

                // Aborted run (Stop pressed): keep the previous solution, refresh the view and exit
                if (!bestResult || bestResult.aborted) {
                    if (this.hasui) {
                        this.currentAreaDisplay.textContent = `(Stopped after ${timeTaken}ms)`;
                        this.drawResult();
                    }
                    break;
                }

                // Display performance statistics for NFP2
                this.displayPerformanceStats();
                if (this.hasui) {
                    this.currentAreaDisplay.textContent = `${bestResult.area.toFixed(2)} mm² (${timeTaken}ms, ${(this.calculateUtilization(bestResult.placements) * 100).toFixed(1)}%)`;

                    // Update best solution if current is better (considering area + object count)
                    const newCount = bestResult.placements.filter(p => p.lcolor !== "#00ff00").length;
                    const bestCount = this.bestPlacedParts ? this.bestPlacedParts.filter(p => p.lcolor !== "#00ff00").length : 0;
                    if (!this.bestPlacedParts || this.isBetterSolution(bestResult.area, newCount, this.bestArea, bestCount)) {
                        this.bestArea = bestResult.area;
                        this.bestAreaDisplay.textContent = bestResult.area.toFixed(2) + " mm² (" + (this.calculateUtilization(bestResult.placements) * 100).toFixed(1) + "%)";
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
            } while (infinite && !this.nestingStopRequested);
        } finally {
            this.setNestingRunning(false);
        }
    }

    async recompactCurrentSolution() {
        if (this.isNesting) return;
        if (!this.placedParts || this.placedParts.length === 0) return;

        const startTime = performance.now();
        console.log("Starting manual recompaction...");

        // Run compaction logic (fine-grained sliding)
        this.placedParts = this.nfp.compactSolution(this.placedParts, this.sheet);

        // Recalculate area
        const bounds = this.nfp.calculateTotalBounds(this.placedParts);
        const area = (bounds.width * bounds.height) / (GEOM_SCALE * GEOM_SCALE);
        const timeTaken = (performance.now() - startTime).toFixed(2);

        this.currentAreaDisplay.textContent = `${area.toFixed(2)} mm² (Compacted in ${timeTaken}ms, ${(this.calculateUtilization(this.placedParts) * 100).toFixed(1)}%)`;

        // Update best if this compaction made it better (considering area + object count)
        const newCount = this.placedParts.filter(p => p.lcolor !== "#00ff00").length;
        const bestCount = this.bestPlacedParts ? this.bestPlacedParts.filter(p => p.lcolor !== "#00ff00").length : 0;
        if (!this.bestPlacedParts || this.isBetterSolution(area, newCount, this.bestArea, bestCount)) {
            this.bestArea = area;
            this.bestAreaDisplay.textContent = area.toFixed(2) + " mm² (" + (this.calculateUtilization(this.placedParts) * 100).toFixed(1) + "%)";
            this.bestPlacedParts = this.placedParts.map(part => part.clone());
        }

        this.drawResult();
    }

    async startRenestingWeb() {
        if (this.isNesting) return;
        if (!this.placedParts || this.placedParts.length === 0) return;
        // Renesting reuses the already-placed objects in memory as fixed obstacles,
        // so it must run on the main thread (the placement loop mutates these
        // in-memory objects). Going through a Web Worker would require serializing
        // every placed part back and forth, which previously caused the fixed
        // (non-marked) parts to be ignored and the renested parts to overlap.
        if (!this.partsVariants || this.partsVariants.length === 0) return;

        const startTime = performance.now();
        console.log("Starting partial renesting for marked or outside parts...");

        // 1. Identify parts to renest (marked with dblclick OR outside sheet).
        //    Everything else stays put and is reused as a fixed obstacle (its
        //    last placement is read from this.nfp.lastPlacements).
        const markedSet = new Set();
        const scaledSheet = {
            width: this.sheet.width * GEOM_SCALE,
            height: this.sheet.height * GEOM_SCALE
        };
        const EPS = 0.01 * GEOM_SCALE;

        for (const part of this.placedParts) {
            if (part.lcolor === "#00ff00") continue; // sheet holes always stay
            const b = part.getBounds();
            const isOutside = b.x < -EPS || b.y < -EPS ||
                (b.x + b.width) > scaledSheet.width + EPS ||
                (b.y + b.height) > scaledSheet.height + EPS;
            if (part.isForcedOutside || isOutside) {
                markedSet.add(part.originIndex);
                part.isForcedOutside = false; // reset once we start renesting
            }
        }

        if (markedSet.size === 0) {
            console.log("No parts found to renest (none marked and none outside).");
            return;
        }

        this.setNestingRunning(true);
        try {
            // 2. Mark the in-memory part objects: placed=false => re-nest,
            //    placed=true => fixed obstacle (its prior position is kept in
            //    this.nfp.lastPlacements). Marked parts get fresh, un-placed
            //    variants so they start from scratch.
            this.nfp.setAllowFlip(this.lastFlipValue || false);
            for (const v of this.partsVariants) {
                if (markedSet.has(v.originIndex)) {
                    const originalSource = this.partsByOriginIndex.get(v.originIndex);
                    const fresh = this.generatePartVariants(originalSource);
                    v.variants = fresh.variants;
                    v.placed = false;
                } else {
                    v.placed = true;
                }
            }

            // 3. Run the shared placement loop directly on the main thread.
            //    Fixed parts act as collision obstacles; only marked parts are
            //    actually re-placed. Reuse the grid size / spacing from the last
            //    full nest (do NOT reset it, otherwise the grid becomes far too
            //    fine and slow).
            const result = this.nfp.renest(
                this.partsVariants,
                this.sheet,
                null,
                Math.ceil(this.nfp.gridSize / 3)
            );

            if (!result || result.length === 0) {
                console.log("Renesting produced no result; keeping previous solution");
                if (this.hasui) {
                    this.currentAreaDisplay.textContent = `(Renest failed - kept previous)`;
                    this.drawResult();
                }
                return;
            }

            this.placedParts = result;
            const timeTaken = (performance.now() - startTime).toFixed(2);
            const bounds = this.nfp.calculateTotalBounds(result);
            const area = (bounds.width * bounds.height) / (GEOM_SCALE * GEOM_SCALE);

            // Safety validation: ensure no re-nested part overlaps a fixed part.
            // Fixed parts are real obstacles during placement, so this should
            // never trip — but keep it as a guard.
            const fixedParts = this.placedParts.filter(p => p.lcolor !== "#00ff00" && !markedSet.has(p.originIndex));
            const newlyPlaced = result.filter(p => markedSet.has(p.originIndex));
            let hasOverlap = false;
            for (const np of newlyPlaced) {
                for (const fp of fixedParts) {
                    if (np.polygonsIntersect(fp, true)) {
                        console.warn("Renesting overlap detected:", np.originIndex, "vs", fp.originIndex);
                        hasOverlap = true;
                        break;
                    }
                }
                if (hasOverlap) break;
            }

            if (hasOverlap) {
                console.log("Rejecting renesting result due to overlaps; keeping previous solution");
                if (this.hasui) {
                    this.currentAreaDisplay.textContent = `(Overlap detected - kept previous)`;
                    this.drawResult();
                }
                return;
            }

            if (this.hasui) {
                this.currentAreaDisplay.textContent = `${area.toFixed(2)} mm² (Renested in ${timeTaken}ms, ${(this.calculateUtilization(result) * 100).toFixed(1)}%)`;
            }
            this.drawResult();
        } finally {
            this.setNestingRunning(false);
        }
    }

    onPartDoubleClick(part) {
        console.log("Part double clicked:", part);
        this.updateCurrentSolutionArea();
    }

    async startNesting(offset, width, height, spacing = 1, rotation = [0], flip = false, multiCPU = false) {
        // Start timing
        const startTime = performance.now();

        // Update sheet dimensions with minimum size
        const minWidth = Math.max(100, width || 1000);
        const minHeight = Math.max(100, height || 1000);
        this.sheet.width = minWidth + offset * 4 + 10;
        this.sheet.height = minHeight + offset * 4 + 10;
        this.nfp.setSpacing(spacing);

        // Update settings and generate variants only if parameters changed
        if (this.lastRotationValue !== rotation ||
            this.lastFlipValue !== flip || this.lastOffset !== offset || !this.partsVariants) {

            this.lastRotationValue = rotation;
            this.lastFlipValue = flip;
            this.lastOffset = offset;

            // Generate variants with the new parameters
            this.partsVariants = this.parts.map(part => this.generatePartVariants(part));

            // Variant set changed -> old GA chromosome no longer valid
            this.gaSeedOrder = null;
        }

        // Run nesting
        const bestResult = await this.runNesting(multiCPU);

        // End timing
        const endTime = performance.now();
        const timeTaken = (endTime - startTime).toFixed(2);

        // Aborted run: leave UI/solution alone; caller handles the message
        if (!bestResult || bestResult.aborted) {
            return bestResult;
        }

        if (this.hasui) {
            this.currentAreaDisplay.textContent = `${bestResult.area.toFixed(2)} mm² (${timeTaken}ms)`;

            // Update best solution if current is better (considering area + object count)
            const newCount = bestResult.placements.filter(p => p.lcolor !== "#00ff00").length;
            const bestCount = this.bestPlacedParts ? this.bestPlacedParts.filter(p => p.lcolor !== "#00ff00").length : 0;
            if (!this.bestPlacedParts || this.isBetterSolution(bestResult.area, newCount, this.bestArea, bestCount)) {
                this.selectAsBest(false);
            }
        }

        return bestResult;
    }

    _getRotationAngles(rotationString) {
        if (!rotationString) {
            return [0];
        }

        // Cache hit: avoid re-parsing the same rotation string on every variant generation
        const cache = this._rotationAnglesCache;
        if (cache && cache.has(rotationString)) {
            return cache.get(rotationString);
        }

        // if it's one of the old integer values as a string
        const rotationInt = parseInt(rotationString);
        if (!rotationString.includes(',') && !rotationString.includes('-') && !isNaN(rotationInt)) {
            let preset;
            switch (rotationInt) {
                case 1: preset = [0]; break;
                case 2: preset = [0, 180]; break;
                case 3: preset = [0, 90]; break;
                case 4: preset = [0, 90, 180, 270]; break;
                case 8: preset = [0, 45, 90, 135, 180, 225, 270, 315]; break;
            }
            if (preset) {
                if (cache) cache.set(rotationString, preset);
                return preset;
            }
        }

        // Parse comma-separated items, each can be a number or range
        const items = rotationString.split(',').map(s => s.trim());
        const angleSet = new Set();

        for (const item of items) {
            // Check if it's a range notation: "start-end:step"
            const rangeMatch = item.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
            if (rangeMatch) {
                const start = parseFloat(rangeMatch[1]);
                const end = parseFloat(rangeMatch[2]);
                const step = parseFloat(rangeMatch[3]);

                if (step > 0) {
                    for (let angle = start; angle <= end; angle += step) {
                        // Normalize to 0-360 and remove duplicates
                        const normalized = ((angle % 360) + 360) % 360;
                        // Round to avoid floating point issues
                        const rounded = Math.round(normalized * 100) / 100;
                        angleSet.add(rounded);
                    }
                }
            } else {
                // Single angle value
                const angle = parseFloat(item);
                if (!isNaN(angle)) {
                    const normalized = ((angle % 360) + 360) % 360;
                    const rounded = Math.round(normalized * 100) / 100;
                    angleSet.add(rounded);
                }
            }
        }

        // Convert to sorted array
        const angles = Array.from(angleSet).sort((a, b) => a - b);
        const result = angles.length > 0 ? angles : [0];
        if (cache) cache.set(rotationString, result);
        return result;
    }

    drawParts() {
        if (!this.hasui) return;
        const t0 = performance.now();

        // Preview pakai shelf-packing bounding-box (O(n), tanpa cek tabrakan):
        // cuma buat nampilin isi file dengan cepat, bukan hasil nesting.
        // Jadi preview tidak pernah kena lambatnya GA/NFP2 yang sedang dipilih.
        const packW = this.sheet.width * GEOM_SCALE;
        const GAP = 2 * GEOM_SCALE;

        const sheetEntries = [];
        const normalEntries = [];
        for (const pv of this.parts.map(part => {
            const variant = part.clone();
            return {
                placed: false,
                color: part.color,
                lcolor: part.lcolor,
                originIndex: part.originIndex,
                childIndex: part.childIndex,
                variants: [variant]
            };
        })) {
            if (pv.lcolor === "#00ff00") sheetEntries.push(pv);
            else normalEntries.push(pv);
        }

        const nestedResult = [];
        let sheetW = packW;
        if (sheetEntries.length > 0) {
            const sv = sheetEntries[0].variants[0].clone();
            const sb = sv.getBounds();
            sv.translate(-sb.x, -sb.y);
            sv.childIndex = sheetEntries[0].childIndex;
            nestedResult.push(sv);
            sheetW = sb.width;
        }

        normalEntries.sort((a, b) => {
            const ba = a.variants[0].getBounds();
            const bb = b.variants[0].getBounds();
            return (bb.height - ba.height) || (bb.width - ba.width);
        });

        let cx = 0, cy = 0, rowH = 0;
        for (const entry of normalEntries) {
            const v = entry.variants[0].clone();
            const b = v.getBounds();
            v.translate(-b.x, -b.y);
            if (cx > 0 && cx + b.width > sheetW) {
                cx = 0;
                cy += rowH + GAP;
                rowH = 0;
            }
            v.translate(cx, cy);
            v.childIndex = entry.childIndex;
            nestedResult.push(v);
            cx += b.width + GAP;
            if (b.height > rowH) rowH = b.height;
        }

        console.log(`[preview] shelf layout ${normalEntries.length} part dalam ${(performance.now() - t0).toFixed(1)}ms (fast mode, tanpa nesting)`);

        this.previewCanvas.setSheet(this.sheet.width, this.sheet.height);
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
        if (this.inputPathCountEl) this.inputPathCountEl.textContent = this.parts.length;

        // Update current solution path count
        if (this.currentPathCountEl) this.currentPathCountEl.textContent = this.placedParts.length;

        // Update best solution path count
        if (this.bestPathCountEl) {
            this.bestPathCountEl.textContent =
                this.bestPlacedParts ? this.bestPlacedParts.length : 0;
        }
    }

    _generateColor(index) {
        const colors = [
            '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
            '#ff8000', '#ff0080', '#80ff00', '#00ff80', '#8000ff', '#0080ff'
        ];
        return colors[index % colors.length];
    }

    selectAsBest(redraw = false) {
        if (this.placedParts.length === 0) return;

        const bounds = this.nfp.calculateTotalBounds(this.placedParts);
        const area = (bounds.width * bounds.height) / (GEOM_SCALE * GEOM_SCALE);

        this.bestArea = area;
        this.bestAreaDisplay.textContent = area.toFixed(2) + " mm² (" + (this.calculateUtilization(this.placedParts) * 100).toFixed(1) + "%)";
        this.bestPlacedParts = this.placedParts.map(part => part.clone());

        if (redraw) this.drawResult();
        this.copyBestSolution();
    }

    loadBestToCurrent() {
        if (!this.bestPlacedParts || this.bestPlacedParts.length === 0) return;

        this.placedParts = this.bestPlacedParts.map(part => part.clone());
        this.currentSolutionCanvas.setParts(this.placedParts);
        this.updateCurrentSolutionArea();
        this.updatePathCounts();
    }

    getUnplacedParts(solution = this.bestPlacedParts) {
        if (!this.parts || this.parts.length === 0) return [];
        const placed = new Set(
            (solution || []).filter(p => p.lcolor !== "#00ff00").map(p => p.originIndex)
        );
        return this.parts.filter(p =>
            p.lcolor !== "#00ff00" && p.paths.length > 0 && !placed.has(p.originIndex)
        );
    }

    layoutUnplacedToRight(solution, unplaced) {
        if (!unplaced || unplaced.length === 0) return [];
        const bounds = this.nfp.calculateTotalBounds(solution);
        const GAP = 10 * GEOM_SCALE;
        const hasNested = solution && solution.some(p => p.lcolor !== "#00ff00");
        let cursorX = hasNested ? (bounds.x + bounds.width + GAP) : 0;
        let cursorY = hasNested ? bounds.y : 0;
        const sorted = [...unplaced].sort((a, b) => {
            const ba = a.getBounds();
            const bb = b.getBounds();
            return (bb.height - ba.height) || (bb.width - ba.width);
        });
        const extras = [];
        for (const src of sorted) {
            const clone = src.clone();
            const b = clone.getBounds();
            clone.translate(cursorX - b.x, cursorY - b.y);
            extras.push(clone);
            cursorY += b.height + GAP;
        }
        return extras;
    }

    svgFromSolution(solution = this.bestPlacedParts) {
        const unplaced = this.getUnplacedParts(solution);
        const extras = this.layoutUnplacedToRight(solution, unplaced);
        if (unplaced.length > 0) {
            console.log(`[download] ${unplaced.length} part tidak ternesting, diletakkan di kanan:`, unplaced.map(p => p.originIndex));
        }
        const combined = [...(solution || []), ...extras];
        const bounds = this.nfp.calculateTotalBounds(combined.length > 0 ? combined : solution);
        let svgContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}mm" height="${bounds.height}mm" viewBox="0 0 ${bounds.width} ${bounds.height}">`;

        combined.forEach((part) => {
            svgContent += part.toSVGPath();
        });

        svgContent += '</svg>';
        return svgContent;
    }

    downloadBestSolution() {
        if (!this.bestPlacedParts || this.bestPlacedParts.length === 0) return;

        const unplaced = this.getUnplacedParts(this.bestPlacedParts);
        if (unplaced.length > 0) {
            alert(`Peringatan: ${unplaced.length} dari ${this.parts.length} part tidak muat di hasil nesting!\nPart tersebut tetap disertakan di sebelah kanan file SVG agar tidak hilang.`);
        }

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
            const svgData = this.svgFromSolution();

            const formData = new FormData();
            formData.append('svg_data', new Blob([svgData], { type: 'image/svg+xml' }), 'solution.svg');
            formData.append('inkscape', 'n');

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
                })
                .catch(error => {
                    console.error('Error saving solution:', error);
                });
        } catch (error) {
            console.error('Error copying SVG:', error);
            alert('Failed to export SVG solution');
        }
    }

    drawProgress() {
        if (!this.hasui) return;
        // Use cached DOM elements (this method is called very frequently during nesting)
        const progressFill = this.progressFillEl;
        const progressText = this.progressTextEl;
        if (progressFill) progressFill.style.width = `${this.currentProgress}%`;
        if (progressText) progressText.textContent = `Progress: ${Math.round(this.currentProgress)}%`;
    }

    forceUIUpdate() {
        if (this.progressFillEl) this.progressFillEl.style.width = `${this.currentProgress}%`;
    }

    startSvgCheck() {
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
