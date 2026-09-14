/**
 * Optimized Algorithm (Bottom-Left Fill + SAT)
 *
 * NFPOptimized extends NFP and inherits its shared placement loop,
 * spatial hash, lazy-clone tryPlacement and renest/compact logic.
 * The difference vs. the plain NFP ("Grid") algorithm:
 *
 *   1. tryPlacement() adds a small random noise term to the score so
 *      repeated runs (infinite nesting) explore different layouts.
 */
class NFPOptimized extends NFP {
    tryPlacement(variant, px, py, placedParts, placedParts2, sheet, checkchild = true) {
        // Bounds of the translated clone = cached variant bounds + offset.
        // Cheap O(1): getBounds() is cached, so we avoid cloning the variant
        // unless a bbox-overlapping candidate actually requires an exact test.
        const vb = variant.getBounds();
        const bx = vb.x + px;
        const by = vb.y + py;
        const bw = vb.width;
        const bh = vb.height;
        if (!this.hascustomsheet) {
            if (bx < 0 || by < 0 || bx + bw > sheet.width || by + bh > sheet.height) {
                return null;
            }
        }

        // Always reset so variant.insideBonus never holds a stale value from a
        // previous candidate, even on the no-candidate fast path.
        variant.insideBonus = 0;
        let insideBonus = 0;
        const cand1 = placedParts ? this._collectCandidates(bx, by, bw, bh, placedParts) : null;
        const cand2 = this._collectCandidates(bx, by, bw, bh, placedParts2);
        if (cand1 !== null || cand2 !== null) {
            // NOTE: polygonsIntersectAt may raise variant.insideBonus as a side
            // effect (variant fits inside a hole), so read it after the checks.
            if (cand1 !== null && this._conflictsWithList(variant, px, py, cand1, true, checkchild)) return null;
            if (cand2 !== null && this._conflictsWithList(variant, px, py, cand2, false, true)) return null;
            insideBonus = variant.insideBonus;
        }

        const heightScore = by + bh * 2;
        const complexityPenalty = variant.paths.length > 1 ? 1000 * GEOM_SCALE : 0;
        // Small random noise breaks ties differently on each run, so the
        // infinite-loop mode keeps exploring and improving the layout.
        const noise = (Math.random() - 0.5) * GEOM_SCALE * 0.5;
        return (heightScore * 2 + complexityPenalty + noise) - insideBonus;
    }
}
