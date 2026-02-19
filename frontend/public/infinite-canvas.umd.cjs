(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.InfiniteCanvas = factory());
})(this, function () {
    'use strict';

    function InfiniteCanvas(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this._transformation = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        this.viewBox = { transformation: this._transformation };
        this._width = canvas.width;
        this._height = canvas.height;
        this._scale = 1;
        this._offsetX = 0;
        this._offsetY = 0;
        this.canvas.style.cursor = 'grab';
        
        // Store all drawing operations
        this._drawOperations = [];
        this._isRecording = true;
        
        // Enable anti-aliasing for smooth rendering
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        
        // Apply initial transform
        this._applyTransform();
        
        this._setupProxyContext();
        this._setupEvents();
    }

    Object.defineProperty(InfiniteCanvas.prototype, 'transformation', {
        get: function () {
            return this._transformation;
        },
        set: function (t) {
            this._transformation = t;
            this._scale = t.a;
            this._offsetX = t.e;
            this._offsetY = t.f;
            this._applyTransform();
        }
    });

    Object.defineProperty(InfiniteCanvas.prototype, 'width', {
        get: function () {
            return this._width;
        }
    });

    Object.defineProperty(InfiniteCanvas.prototype, 'height', {
        get: function () {
            return this._height;
        }
    });

    // Apply current transform to context
    InfiniteCanvas.prototype._applyTransform = function () {
        this.ctx.setTransform(
            this._scale, 0, 0, this._scale, 
            this._offsetX, this._offsetY
        );
    };

    // Proxy context methods to record all drawing operations
    InfiniteCanvas.prototype._setupProxyContext = function () {
        var self = this;
        var originalCtx = this.ctx;
        
        // Extended list of methods to proxy
        var methods = [
            'beginPath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'bezierCurveTo', 'quadraticCurveTo',
            'rect', 'closePath', 'stroke', 'fill', 'fillRect', 'strokeRect', 'clearRect',
            'save', 'restore', 'translate', 'rotate', 'scale', 'transform', 'setTransform',
            'fillText', 'strokeText', 'drawImage', 'setLineDash', 'getLineDash', 'clip',
            'ellipse', 'isPointInPath', 'isPointInStroke', 'measureText', 'putImageData',
            'getImageData', 'createLinearGradient', 'createRadialGradient', 'createPattern'
        ];
        
        // Extended list of properties to proxy
        var properties = [
            'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit',
            'lineDashOffset', 'globalAlpha', 'globalCompositeOperation', 'font', 'textAlign', 
            'textBaseline', 'direction', 'shadowColor', 'shadowBlur', 'shadowOffsetX', 
            'shadowOffsetY', 'imageSmoothingEnabled', 'imageSmoothingQuality'
        ];
        
        // Create proxied context
        this._proxiedCtx = {};
        
        methods.forEach(function(method) {
            if (typeof originalCtx[method] === 'function') {
                self._proxiedCtx[method] = function() {
                    var args = Array.prototype.slice.call(arguments);
                    if (self._isRecording) {
                        self._drawOperations.push({ type: 'method', name: method, args: args });
                    }
                    return originalCtx[method].apply(originalCtx, args);
                };
            }
        });
        
        // Special handling for reset method
        self._proxiedCtx['reset'] = function() {
            if (typeof originalCtx.reset === 'function') {
                return originalCtx.reset.apply(originalCtx, arguments);
            }
            // Fallback for browsers without reset
            originalCtx.setTransform(1, 0, 0, 1, 0, 0);
            originalCtx.clearRect(0, 0, self.canvas.width, self.canvas.height);
        };
        
        properties.forEach(function(prop) {
            Object.defineProperty(self._proxiedCtx, prop, {
                get: function() {
                    return originalCtx[prop];
                },
                set: function(value) {
                    if (self._isRecording) {
                        self._drawOperations.push({ type: 'property', name: prop, value: value });
                    }
                    originalCtx[prop] = value;
                }
            });
        });
        
        // Special handling for canvas property - should return InfiniteCanvas, not HTMLCanvasElement
        Object.defineProperty(self._proxiedCtx, 'canvas', {
            get: function() {
                return self;
            }
        });
        
        // Forward any other properties/methods not explicitly handled
        var allProps = Object.getOwnPropertyNames(Object.getPrototypeOf(originalCtx));
        allProps.forEach(function(prop) {
            if (!(prop in self._proxiedCtx) && prop !== 'constructor') {
                try {
                    var desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(originalCtx), prop);
                    if (desc && typeof originalCtx[prop] === 'function') {
                        self._proxiedCtx[prop] = function() {
                            var args = Array.prototype.slice.call(arguments);
                            if (self._isRecording) {
                                self._drawOperations.push({ type: 'method', name: prop, args: args });
                            }
                            return originalCtx[prop].apply(originalCtx, args);
                        };
                    }
                } catch(e) {
                    // Skip properties that can't be accessed
                }
            }
        });
    };

    InfiniteCanvas.prototype.getContext = function (type) {
        if (type === '2d') {
            // Always apply current transform before returning context
            this._applyTransform();
            return this._proxiedCtx;
        }
        return null;
    };

    InfiniteCanvas.prototype.clearDrawOperations = function () {
        this._drawOperations = [];
    };

    InfiniteCanvas.prototype._redraw = function () {
        var self = this;
        
        // Get current stroke width setting
        var strokeWidth = 1;
        if (typeof getnumber === 'function') {
            var sw = getnumber("strokewidth");
            if (sw > 0) strokeWidth = sw;
        }
        
        // Clear canvas with identity transform to clear entire area
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this._width, this._height);
        this.ctx.restore();
        
        // Apply current transform
        this._applyTransform();
        
        // Apply stroke width (adjusted for zoom)
        this.ctx.lineWidth = strokeWidth / this._scale;
        
        // Replay all drawing operations
        this._isRecording = false;
        try {
            this._drawOperations.forEach(function(op) {
                if (op.type === 'method') {
                    if (typeof self.ctx[op.name] === 'function') {
                        self.ctx[op.name].apply(self.ctx, op.args);
                    }
                } else if (op.type === 'property') {
                    // Skip lineWidth from stored operations, use our calculated value
                    if (op.name !== 'lineWidth') {
                        self.ctx[op.name] = op.value;
                    }
                }
            });
        } catch(e) {
            console.error('Error during redraw:', e);
        }
        this._isRecording = true;
    };

    InfiniteCanvas.prototype._setupEvents = function () {
        var self = this;
        var isDragging = false;
        var startX, startY;

        // Mouse wheel for zoom
        this.canvas.addEventListener('wheel', function (e) {
            e.preventDefault();
            e.stopPropagation();
            
            var rect = self.canvas.getBoundingClientRect();
            var mouseX = e.clientX - rect.left;
            var mouseY = e.clientY - rect.top;
            
            // Convert mouse position to canvas coordinates
            var canvasX = (mouseX - self._offsetX) / self._scale;
            var canvasY = (mouseY - self._offsetY) / self._scale;
            
            var zoom = e.deltaY > 0 ? 0.9 : 1.1;
            self._scale *= zoom;
            
            // Calculate new offset to zoom towards mouse position
            self._offsetX = mouseX - canvasX * self._scale;
            self._offsetY = mouseY - canvasY * self._scale;
            
            self._transformation = {
                a: self._scale,
                b: 0,
                c: 0,
                d: self._scale,
                e: self._offsetX,
                f: self._offsetY
            };
            self.viewBox.transformation = self._transformation;
            
            // Redraw using stored operations (fast!)
            self._redraw();
        }, { passive: false });

        // Mouse down for pan start
        this.canvas.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            e.preventDefault();
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            self.canvas.style.cursor = 'grabbing';
        });

        // Mouse move for panning
        window.addEventListener('mousemove', function (e) {
            if (!isDragging) return;
            e.preventDefault();
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            startX = e.clientX;
            startY = e.clientY;
            
            self._offsetX += dx;
            self._offsetY += dy;
            
            self._transformation = {
                a: self._scale,
                b: 0,
                c: 0,
                d: self._scale,
                e: self._offsetX,
                f: self._offsetY
            };
            self.viewBox.transformation = self._transformation;
            
            // Redraw using stored operations (fast!)
            self._redraw();
        });

        // Mouse up for pan end
        window.addEventListener('mouseup', function () {
            isDragging = false;
            self.canvas.style.cursor = 'grab';
        });
        
        // Prevent context menu on right click
        this.canvas.addEventListener('contextmenu', function (e) {
            e.preventDefault();
        });
    };

    return InfiniteCanvas;
});
