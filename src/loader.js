/**
 * KaryaCNC Module Loader
 * Loads all JavaScript modules in the correct order
 * 
 * Structure:
 * 1. Constants
 * 2. Utilities (DOM, Math)
 * 3. Parsers (Inkscape format)
 * 4. Geometry operations
 * 5. Processors (Offset, V-carve, Pocket)
 * 6. Generators (G-code)
 * 7. Machine communication
 * 8. UI (Canvas)
 * 9. Main application
 */

(function() {
    'use strict';
    
    const modules = [
        // Utils - Core utilities first
        'src/utils/constants.js',
        'src/utils/dom.js',
        'src/utils/math-utils.js',
        
        // Parser - Handle input formats
        'src/parser/inkscape-parser.js',
        
        // Geometry - Basic geometric operations
        'src/processor/geometry.js',
        
        // Processors - Vector operations
        'src/processor/offset.js',
        'src/processor/vcarve.js',
        'src/processor/pocket.js',
        'src/processor/engrave.js',
        'src/processor/sorter.js',
        
        // Generators - Output generation
        'src/generator/gcode-core.js',
        'src/generator/laser-gcode.js',
        'src/generator/cnc-gcode.js',
        'src/generator/plasma-gcode.js',
        
        // Machine - Communication
        'src/machine/sender.js',
        
        // UI - Display
        'src/ui/canvas.js',
        'src/ui/editor.js',
        
        // Main application logic
        'src/app.js'
    ];
    
    let loadedCount = 0;
    const totalModules = modules.length;
    
    function loadModule(index) {
        if (index >= modules.length) {
            console.log('All modules loaded successfully!');
            if (window.onModulesLoaded) {
                window.onModulesLoaded();
            }
            return;
        }
        
        const script = document.createElement('script');
        script.src = modules[index];
        script.type = 'text/javascript';
        
        script.onload = function() {
            loadedCount++;
            console.log(`Loaded ${loadedCount}/${totalModules}: ${modules[index]}`);
            loadModule(index + 1);
        };
        
        script.onerror = function() {
            console.error(`Failed to load: ${modules[index]}`);
            // Continue loading other modules even if one fails
            loadModule(index + 1);
        };
        
        document.head.appendChild(script);
    }
    
    // Start loading modules
    loadModule(0);
})();
