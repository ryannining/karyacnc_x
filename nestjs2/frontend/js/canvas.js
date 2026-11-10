
class Canvas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.context = this.canvas.getContext('2d');
        this.zoom = 1;
        this.x = 0;
        this.y = 0;
        this.isPanning = false;
        this.lastPosition = { x: 0, y: 0 };
        this.parts = [];
        this.sheet = { width: 1000, height: 1000 };
        this.baseScale = 1;
        this.baseX = 0;
        this.baseY = 0;
        this.resizeObserver = null;
        this.resizeAttempts = 0;
        
        // Drag and drop state
        this.dragEnabled = false;
        this.draggedPart = null;
        this.dragOffset = { x: 0, y: 0 };
        this.dragValid = false;
        this.onDragEnd = null;
        this.dragStartPos = null;
        this.lastValidPos = null;   // last position where dragValid was true
        this.lastDragWorldPos = null;
        this.collidingParts = new Set(); // parts that collide with dragged part

        // Callbacks
        this.onRotateDrag = null; // called when R key pressed during drag
        
        this.attachEventListeners();
        this.setupResizeObserver();
        // Redraw saat tema diganti dari shell KaryaCNC
        window.addEventListener('karyacnc-theme-changed', () => this.draw());
        // Delay initial resize to ensure iframe layout is ready
        setTimeout(() => this.resize(), 50);
    }

    setupResizeObserver() {
        const container = this.canvas.parentElement;
        if (container && typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                this.resize();
            });
            this.resizeObserver.observe(container);
        }
    }

    resize() {
        const container = this.canvas.parentElement;
        if (!container) return;

        const width = container.clientWidth;
        const height = container.clientHeight;

        const sheetWidth = this.sheet.width || 1000;
        const sheetHeight = this.sheet.height || 1000;

        if (width === 0 || height === 0) {
            this.resizeAttempts++;
            if (this.resizeAttempts < 20) {
                setTimeout(() => this.resize(), 100);
            } else {
                const fallbackWidth = window.innerWidth || 800;
                const fallbackHeight = window.innerHeight || 600;
                this.canvas.width = fallbackWidth;
                this.canvas.height = fallbackHeight;
                this.baseScale = Math.min(
                    this.canvas.width / sheetWidth,
                    this.canvas.height / sheetHeight
                );
                this.baseX = (this.canvas.width - sheetWidth * this.baseScale) / 2;
                this.baseY = (this.canvas.height - sheetHeight * this.baseScale) / 2;
                this.draw();
            }
            return;
        }

        this.resizeAttempts = 0;
        this.canvas.width = width;
        this.canvas.height = height;

        this.baseScale = Math.min(
            this.canvas.width / sheetWidth,
            this.canvas.height / sheetHeight
        );
        this.baseX = (this.canvas.width - sheetWidth * this.baseScale) / 2;
        this.baseY = (this.canvas.height - sheetHeight * this.baseScale) / 2;

        this.draw();
    }

    attachEventListeners() {
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));
        this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
        window.addEventListener('resize', this.resize.bind(this));
        window.addEventListener('keydown', this.onKeyDown.bind(this));
    }

    setDragEnabled(enabled) {
        this.dragEnabled = enabled;
        if (!enabled) {
            this.draggedPart = null;
            this.draw();
        }
    }

    screenToWorld(screenX, screenY) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = screenX - rect.left;
        const canvasY = screenY - rect.top;
        
        const worldX = (canvasX - this.baseX - this.x) / (this.baseScale * this.zoom);
        const worldY = (canvasY - this.baseY - this.y) / (this.baseScale * this.zoom);
        
        return { x: worldX, y: worldY };
    }

    findPartAt(worldX, worldY) {
        // worldX/worldY are in mm, but bounds are in scaled units
        const sx = worldX * GEOM_SCALE;
        const sy = worldY * GEOM_SCALE;
        // Search in reverse order (top-most part first)
        for (let i = this.parts.length - 1; i >= 0; i--) {
            const part = this.parts[i];
            if (part.lcolor === "#00ff00") continue; // Skip sheet
            
            const bounds = part.getBounds();
            if (sx >= bounds.x && sx <= bounds.x + bounds.width &&
                sy >= bounds.y && sy <= bounds.y + bounds.height) {
                return { part, index: i };
            }
        }
        return null;
    }

    onMouseDown(event) {
        if (this.dragEnabled && event.button === 0) {
            const worldPos = this.screenToWorld(event.clientX, event.clientY);
            const found = this.findPartAt(worldPos.x, worldPos.y);
            
            if (found) {
                this.draggedPart = found.part;
                this.dragIndex = found.index;
                const bounds = found.part.getBounds();
                this.dragStartPos = {
                    x: bounds.x,
                    y: bounds.y
                };
                // dragOffset in scaled units
                this.dragOffset = {
                    x: (worldPos.x * GEOM_SCALE) - bounds.x,
                    y: (worldPos.y * GEOM_SCALE) - bounds.y
                };
                this.lastDragWorldPos = worldPos;
                this.lastValidPos = { x: bounds.x, y: bounds.y }; // start pos is initially valid
                this.isPanning = false;
                // Notify app to reset variant state for this new drag
                if (this.onDragStart) this.onDragStart(found.part);
                this.draw();
                return;
            }
        }
        
        this.isPanning = true;
        this.lastPosition = { x: event.clientX, y: event.clientY };
    }

    onMouseMove(event) {
        if (this.draggedPart) {
            const worldPos = this.screenToWorld(event.clientX, event.clientY);
            this.lastDragWorldPos = worldPos;

            // Target position in scaled units
            const targetX = worldPos.x * GEOM_SCALE - this.dragOffset.x;
            const targetY = worldPos.y * GEOM_SCALE - this.dragOffset.y;
            
            // Move part to target position FIRST
            const bounds = this.draggedPart.getBounds();
            const dx = targetX - bounds.x;
            const dy = targetY - bounds.y;
            this.draggedPart.translate(dx, dy);

            // Then check collision at current position
            if (this.onDragEnd) {
                this.dragValid = this.onDragEnd(this.draggedPart, targetX / GEOM_SCALE, targetY / GEOM_SCALE, true);
            }

            // Remember last valid position
            if (this.dragValid) {
                const nb = this.draggedPart.getBounds();
                this.lastValidPos = { x: nb.x, y: nb.y };
            }
            
            this.draw();
            return;
        }
        
        if (!this.isPanning) {
            return;
        }
        const dx = event.clientX - this.lastPosition.x;
        const dy = event.clientY - this.lastPosition.y;
        this.x += dx;
        this.y += dy;
        this.lastPosition = { x: event.clientX, y: event.clientY };
        this.draw();
    }

    onMouseUp(event) {
        if (this.draggedPart) {
            const bounds = this.draggedPart.getBounds();
            let success = true;
            if (this.onDragEnd) {
                success = this.onDragEnd(this.draggedPart, bounds.x / GEOM_SCALE, bounds.y / GEOM_SCALE, false);
            }

            if (!success && this.lastValidPos) {
                // If final position is invalid, revert to last known valid drag position
                const currentBounds = this.draggedPart.getBounds();
                this.draggedPart.translate(this.lastValidPos.x - currentBounds.x, this.lastValidPos.y - currentBounds.y);
            }

            // Reset all drag-related states including colliding parts
            this.draggedPart = null;
            this.lastValidPos = null;
            this.collidingParts.clear();
            this.dragValid = true;
            this.draw();
        }
        this.isPanning = false;
    }

    onKeyDown(event) {
        if (!this.draggedPart || !this.dragEnabled) return;
        if (event.key === 'r' || event.key === 'R') {
            event.preventDefault();
            if (this.onRotateDrag && this.lastDragWorldPos) {
                const newPart = this.onRotateDrag(this.draggedPart, this.lastDragWorldPos);
                if (newPart) {
                    this.draggedPart = newPart;
                    // Re-check validity at new position
                    if (this.onDragEnd) {
                        this.dragValid = this.onDragEnd(
                            this.draggedPart,
                            this.lastDragWorldPos.x,
                            this.lastDragWorldPos.y,
                            true
                        );
                    }
                    this.draw();
                }
            }
        }
    }

    onWheel(event) {
        event.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(20, this.zoom * zoomFactor));

        // Adjust translation to zoom towards mouse position
        this.x = mouseX - (mouseX - this.x) * (newZoom / this.zoom);
        this.y = mouseY - (mouseY - this.y) * (newZoom / this.zoom);

        this.zoom = newZoom;
        this.draw();
    }

    onDoubleClick(event) {
        const worldPos = this.screenToWorld(event.clientX, event.clientY);
        const found = this.findPartAt(worldPos.x, worldPos.y);
        
        if (found) {
            const part = found.part;
            // Toggle force outside
            part.isForcedOutside = !part.isForcedOutside;
            
            if (part.isForcedOutside) {
                // Move it far to the right of current sheet
                const bounds = part.getBounds();
                const sheetWidth = (this.parts.find(p => p.lcolor === "#00ff00")?.getBounds().width || 2000 * GEOM_SCALE);
                const targetX = sheetWidth + 50 * GEOM_SCALE;
                part.translate(targetX - bounds.x, 0);
            }
            
            if (this.onDoubleClickPart) {
                this.onDoubleClickPart(part);
            }
            this.draw();
        }
    }

    draw() {
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.context.save();

        this.context.translate(this.baseX, this.baseY);
        this.context.scale(this.baseScale, this.baseScale);

        this.context.translate(this.x / this.baseScale, this.y / this.baseScale);
        this.context.scale(this.zoom, this.zoom);

        this.drawGrid();
        this.drawContent();
        this.context.restore();
    }

    drawGrid() {
        const left = -this.x / this.zoom;
        const right = left + this.canvas.width / (this.baseScale * this.zoom);
        const top = -this.y / this.zoom;
        const bottom = top + this.canvas.height / (this.baseScale * this.zoom);

        // Warna grid diseragamkan dengan MiniSketch (major lebih terang dari minor)
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        const majorColor = dark ? '#242c36' : '#e4e8ee';
        const minorColor = dark ? '#1b222a' : '#eef1f5';

        // Major grid lines every 100mm
        this.context.beginPath();
        this.context.strokeStyle = majorColor;
        this.context.lineWidth = 1 / (this.baseScale * this.zoom);
        const majorGrid = 100;
        for (let x = Math.floor(left / majorGrid) * majorGrid; x < right; x += majorGrid) {
            this.context.moveTo(x, top);
            this.context.lineTo(x, bottom);
        }
        for (let y = Math.floor(top / majorGrid) * majorGrid; y < bottom; y += majorGrid) {
            this.context.moveTo(left, y);
            this.context.lineTo(right, y);
        }
        this.context.stroke();

        // Minor grid lines every 20mm
        this.context.beginPath();
        this.context.strokeStyle = minorColor;
        this.context.lineWidth = 0.5 / (this.baseScale * this.zoom);
        const minorGrid = 20;
        for (let x = Math.floor(left / minorGrid) * minorGrid; x < right; x += minorGrid) {
            if (x % majorGrid === 0) continue; // skip major lines
            this.context.moveTo(x, top);
            this.context.lineTo(x, bottom);
        }
        for (let y = Math.floor(top / minorGrid) * minorGrid; y < bottom; y += minorGrid) {
            if (y % majorGrid === 0) continue;
            this.context.moveTo(left, y);
            this.context.lineTo(right, y);
        }
        this.context.stroke();
    }

    drawContent() {
        if (this.parts) {
            this.parts.forEach(part => {
                if (part.isForcedOutside) {
                    this.drawPath(this.context, part, '#FF9800', 'rgba(255, 152, 0, 0.1)', 3);
                } else if (part === this.draggedPart) {
                    const stroke = this.dragValid ? '#00cc00' : '#ff0000';
                    const fill = this.dragValid ? 'rgba(0, 200, 0, 0.2)' : 'rgba(255, 0, 0, 0.2)';
                    this.drawPath(this.context, part, stroke, fill, !this.dragValid ? 2 : 1);
                } else if (this.collidingParts.has(part)) {
                    this.drawPath(this.context, part, '#ff0000', 'rgba(255, 0, 0, 0.15)', 2);
                } else {
                    const stroke = part.lcolor === "#00ff00" ? "#00bb00" : "#333333";
                    const fill = part.lcolor === "#00ff00" ? "#e6ffe6" : "#f8f8f8";
                    this.drawPath(this.context, part, stroke, fill, 1);
                }
            });
        }
    }

    drawPath(ctx, path, stroke, fill, lineWidth = 1) {
        if (!path || path.paths.length === 0) return;
        this.drawPathPolygon(ctx, path, stroke, fill, lineWidth);
    }

    drawPathPolygon(ctx, path, stroke, fill, lineWidth = 1) {
        if (path.paths.length == 0) return;
        ctx.beginPath();
        path.paths.forEach(p => {
            ctx.moveTo(p[0].x / GEOM_SCALE, p[0].y / GEOM_SCALE);
            for (let i = 1; i < p.length; i++) {
                ctx.lineTo(p[i].x / GEOM_SCALE, p[i].y / GEOM_SCALE);
            }
            ctx.lineTo(p[0].x / GEOM_SCALE, p[0].y / GEOM_SCALE);
            ctx.closePath();
        });
        ctx.lineWidth = lineWidth / (this.baseScale * this.zoom);
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.fill('evenodd');
        ctx.stroke();
    }

    setParts(parts) {
        this.parts = parts;
        this.draw();
    }

    setSheet(width, height) {
        this.sheet.width = width || 1000;
        this.sheet.height = height || 1000;
        this.resize();
    }
}
