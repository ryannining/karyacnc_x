importScripts('geometry.js', 'nfp.js', 'nfp2.js', 'nfp_optimized.js', 'nfp_ga.js');

// Handle messages from main thread
self.onmessage = function (e) {
    const { parts, sheet, gridSize, algorithm, initialPlacements, gaParams, seedOrder } = e.data;

    // Create NFP instance based on algorithm
    let nfp;
    if (algorithm === 'nfp2') {
        nfp = new NFP2();
    } else if (algorithm === 'optimized') {
        nfp = new NFPOptimized();
    } else if (algorithm === 'ga') {
        nfp = new NFPGA();
        if (gaParams) nfp.setGAParams(gaParams.popSize, gaParams.generations, gaParams.mutationRate);
    } else {
        nfp = new NFP();
    }
    nfp.gridSize = gridSize;

    // Rehydrate initial placements
    const rehydratedInitial = (initialPlacements || []).map(plainPath => {
        const newPaths = plainPath.paths.map(p => p.map(pt => new Point(pt.x, pt.y)));
        const newPath = new Path(newPaths, plainPath.originIndex, plainPath.color, plainPath.lcolor);
        newPath.transformMatrix = plainPath.transformMatrix;
        newPath.childIndex = plainPath.childIndex;
        return newPath;
    });

    parts.forEach(part => {
        part.variants = part.variants.map(variant => {
            const variantPath = new Path(
                variant.paths,
                variant.originIndex,
                variant.color,
                variant.lcolor
            );
            variantPath.childIndex = variant.childIndex;
            variantPath.transformMatrix = variant.transformMatrix;
            return variantPath;
        })
    });

    // Add progress handler
    const progressHandler = (placedCount, totalParts) => {
        self.postMessage({
            type: 'progress',
            progress: (placedCount / totalParts) * 100
        });
    };

    const bestPlacements = (algorithm === 'ga')
        ? nfp.findBestPosition(parts, sheet, progressHandler, gridSize, rehydratedInitial, seedOrder || null)
        : nfp.findBestPosition(parts, sheet, progressHandler, gridSize, rehydratedInitial);

    // Calculate total area for this solution
    const bounds = nfp.calculateTotalBounds(bestPlacements);
    const area = bounds.width * bounds.height;

    // Convert placements to transferable format
    const transferablePlacements = bestPlacements.map(part => {
        const result = {
            paths: part.paths.map(p => p.map(pt => ({ x: pt.x, y: pt.y }))),
            color: part.color,
            lcolor: part.lcolor,
            originIndex: part.originIndex,
            childIndex: part.childIndex,
            transformMatrix: [...part.transformMatrix]
        };
        return result;
    });

    // Send back final results
    self.postMessage({
        type: 'result',
        placements: transferablePlacements,
        area: area / (GEOM_SCALE * GEOM_SCALE),
        stats: nfp.getPerformanceStats(),
        bestOrder: nfp.bestOrder || null
    });
};
