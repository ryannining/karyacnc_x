
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
        this.attachEventListeners();
        this.resize();
    }

    attachEventListeners() {
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('mouseleave', this.onMouseUp.bind(this));
        this.canvas.addEventListener('wheel', this.onWheel.bind(this));
        window.addEventListener('resize', this.resize.bind(this));
    }

    resize() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;

        this.baseScale = Math.min(
            this.canvas.width / this.sheet.width,
            this.canvas.height / this.sheet.height
        );
        this.baseX = (this.canvas.width - this.sheet.width * this.baseScale) / 2;
        this.baseY = (this.canvas.height - this.sheet.height * this.baseScale) / 2;

        this.draw();
    }

    onMouseDown(event) {
        this.isPanning = true;
        this.lastPosition = { x: event.clientX, y: event.clientY };
    }

    onMouseMove(event) {
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

    onMouseUp() {
        this.isPanning = false;
    }

    onWheel(event) {
        event.preventDefault();
        const scaleAmount = 1.1;
        const mouseX = event.clientX - this.canvas.getBoundingClientRect().left;
        const mouseY = event.clientY - this.canvas.getBoundingClientRect().top;

        const worldX = (mouseX - this.baseX - this.x) / (this.baseScale * this.zoom);
        const worldY = (mouseY - this.baseY - this.y) / (this.baseScale * this.zoom);

        if (event.deltaY < 0) {
            // zoom in
            this.zoom *= scaleAmount;
        } else {
            // zoom out
            this.zoom /= scaleAmount;
        }

        this.x = mouseX - this.baseX - worldX * this.baseScale * this.zoom;
        this.y = mouseY - this.baseY - worldY * this.baseScale * this.zoom;

        this.draw();
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
        this.context.beginPath();
        this.context.strokeStyle = '#f0f0f0';
        const gridSize = 20;

        const left = -this.x / this.zoom;
        const right = left + this.canvas.width / (this.baseScale * this.zoom);
        const top = -this.y / this.zoom;
        const bottom = top + this.canvas.height / (this.baseScale * this.zoom);

        for (let x = Math.floor(left / gridSize) * gridSize; x < right; x += gridSize) {
            this.context.moveTo(x, top);
            this.context.lineTo(x, bottom);
        }
        for (let y = Math.floor(top / gridSize) * gridSize; y < bottom; y += gridSize) {
            this.context.moveTo(left, y);
            this.context.lineTo(right, y);
        }
        this.context.stroke();
    }

    drawContent() {
        if (this.parts) {
            this.parts.forEach(part => {
                this.drawPath(this.context, part, part.lcolor, part.lcolor != "#00ff00" ? "#ffffff" : "#ccffcc");
            });
        }
    }

    drawPath(ctx, path, stroke, fill) {
        if (!path || path.paths.length === 0) return;
        this.drawPathPolygon(ctx, path, stroke, fill);
    }

    drawPathPolygon(ctx, path, stroke, fill) {
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
        ctx.lineWidth = 1 / (this.baseScale * this.zoom);
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
        this.sheet.width = width;
        this.sheet.height = height;
        this.resize();
    }
}
