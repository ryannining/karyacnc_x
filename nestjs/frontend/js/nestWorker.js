importScripts('geometry.js', 'nfp.js', 'nfp2.js');
let insideBonus = 0;
// Handle messages from main thread
self.onmessage = function (e) {
    const { parts, sheet, gridSize, useNFP2 } = e.data;

    // Create NFP instance
    const nfp = useNFP2 ? new NFP2() : new NFP();
    nfp.gridSize = gridSize;

    // console.log('Worker received first point:', JSON.stringify(parts[0].variants[0].points[0]));

    // // Convert parts to Path objects with children
    // const convertedParts = parts.map(partData => ({
    //     placed: false,
    //     variants: partData.variants.map(variant => {
    //         const variantPath = new Path(
    //             variant.paths,
    //             variant.color,
    //             variant.lcolor
    //         );
    //         return variantPath;
    //     })
    // }));

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
            // if (variant.originIndex==8)console.log("translate",variant.transformMatrix[4],variant.transformMatrix[5]);

            return variantPath;
        })
    });
    // console.log('Worker received first point:', convertedParts);

    // Add progress handler
    const progressHandler = (placedCount, totalParts) => {
        self.postMessage({
            type: 'progress',
            progress: (placedCount / totalParts) * 100
        });
    };

    const bestPlacements = nfp.findBestPosition(parts, sheet, progressHandler, gridSize);

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
        stats: nfp.getPerformanceStats()
    });
};
