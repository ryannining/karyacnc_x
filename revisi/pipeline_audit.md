# KaryaCNC — `prepare_line2` / `gcode_verify` cache-contract audit

**Scope (per follow-up):** (1) `prepare_line2` mutable-state inventory, (2) its return-shape
contract + array-aliasing safety, (3) whether `gcode_verify`'s tail can run without its draw loop.
Everything else from the original brief is out of scope.

## Snapshot / caveat

The working tree was being edited live during this audit (appcore.js and karyacnc.js both changed
several times). All citations below are pinned to these hashes:

| file | md5 | lines |
|---|---|---|
| `frontend/public/appcore.js` | `4790e597cb907df6bc83ae5049407c2f` | 4736 |
| `frontend/public/karyacnc.js` | `81ff0c135e04c9935784f6dd882fb1a4` | 3377 |

If either file changes again, re-anchor by function name (`prepare_line2` = appcore.js:907,
`gcode_verify` = appcore.js:3187, `sortGcodes` = appcore.js:2416, `emitGcodeOnly` = appcore.js:2916).
Noted resulting state (already landed, not findings): `sortedgcode()` = `sortGcodes(); emitGcodeOnly();`
(appcore.js:2405-2408); `sortGcodes()` idempotency prelude (appcore.js:2437-2443) with
`sty.osubchilds` captured at appcore.js:753-755; karyacnc.js Tier B/C + `refreshgcodeSort`/
`refreshgcodeFast` both call `gcode_verify(1)` (karyacnc.js:2524, 2551).

---

## 1. `prepare_line2` mutable-state inventory (appcore.js:907-1163)

Signature `prepare_line2(lenmm, lines, ofs1)`. "Implicit global" below = assigned with no `var`/`let`
in any loaded script; these scripts are non-strict, so the assignment creates a property on the
shared global object that persists between calls. I verified none of these are top-level `var`s
(grep of `frontend/public/*.js`).

### 1a. Module-level `var` globals

| Variable | Decl. | Read at | Written at | Class |
|---|---|---|---|---|
| `cuttab_manual` | 103 | (consumed in `gcodepush`) | 908 (`=[]`), 1085 `.push(cuts)` | **(a) output** → `gcodepush`:724,736 → `gcodes[i][9]` → `getcutpos`:834 |
| `starttab_manual` | 104 | (consumed in `gcodepush`) | 909 (`=[]`), 1086 `.push(starts)` | **(a) output** → same path as above |
| `centerpath` | 105 | (consumed in `gcodepush`) | 910 (`=[]`), 947 `.push`, 1083 `.push` | **(a) output** → `gcodes[i][11]` (`gcodepush`:724,736) → `sortGcodes`:2783-2834, `findnearest` virtual starts |
| `maxofs` | 100 | 922 | 922 (`Math.max(ofs,maxofs)`) | **(a) output** — canvas scale: `draw_line`:1582-1583, `drawengrave`:1187. Running max across ALL shapes; not per-shape. |
| `oldlines` | 98 | (canvas) | 1091 `.push([lines, sty.num])` | **(a) output** — `gcode_verify`:3304-3306 |
| `combinedpath` | 101 | (consumed by `gcodepushcombined`) | 994 `.push([path, clk])` | **(a) output** → `gcodepushcombined`:770-776 |
| `shapectr` | 95 | 1098 (`shapectr+""`) | 926 (`++`) | **(a) positional state** — gates `disable_ovc`; must advance once per shape even on a cache hit |
| `srl` | 89 | (consumed in `gcodepush`) | 928 (`=[]`), 1141 `.push`, 1149 `.push` | **(a) output** → `gcodes[i][5]` (`gcodepush`:724,736,751) → `lines2gcode`, `draw_line`:1889+ |
| `collapsepoint` | 96 | 933 | 923 | (b) scratch (recomputed every call) |
| `noprocess` | 97 | 1098 | 925 | (b) scratch |
| `lx`, `ly` | 186-187 | 1154-1155 | 929-930 (`=0`), 1154-1155 | (b) scratch — `draw_line`/`firstline` re-init |
| `oshapenum` | 102 | **never read** | 916 | (b) dead write |
| `sty.isPoint` | field | **never read** | 931 (`=0`), 946 (`=1`) | (b) dead write |
| `sty.S0` | field | `draw_line`:1621 | 971 | **(a) output** — canvas warn (`gcode_verify`:3305 passes `warn=1`) |
| `sty.S1` | field | `draw_line`:1621 | 1090 | **(a) output** — same |

`sty` is `gcstyle[shapenum]` (915), falling back to `defaultsty` if undefined (917).

### 1b. Implicit globals (shared, persist across calls)

| Variable | Read at | Written at | Class |
|---|---|---|---|
| `dodrill` | 934 | 924 | (b) scratch |
| `vec1`, `vec2` | 1136 | via `sharp()` 359-376 | (b) scratch (set by the `sharp()` call at 1132, consumed 1136) |
| `cross` | 1133 | via `sharp()` 378; decl 83 | (b) scratch |
| `overcut` (array) | 1143-1144 | via `sharp()` 383-384; decl 82 | (b) scratch |
| `sharpv` | 1133 | 1099 | (b) scratch (`draw_line` sets its own at 1682) |
| `ov` | 1143-1144 | 1100, 1109 | (b) scratch |
| `sr` | 1133 | 1132 | (b) scratch (separate use in `emitGcodeOnly`:3146) |
| `x`, `y` | 961, 1012, 1039, 1076-1077, 1125-1126 | 962-963, 1008-1009, 1123-1124 | (b) scratch (initialised inside the loop at i=-1 before first read) |
| `cxt`, `cyt`, `cnt` | 1125-1127, 1141, 1149 | 1111-1113, 1151-1153 | (b) scratch (no external readers found) |
| `tl2` | 1120 | 1120 | (b) scratch |
| `cenx`, `ceny` | 1083 | 1000-1001, 1076-1077 | (b) scratch |

Note: `sharp()` (appcore.js:342-386) writes `ci,nci,pci,cur,d1,d2,l,prev,vec1,vec2,next,dot,cross,overcut`
as implicit globals. `prepare_line2` depends on this side effect for `vec1/vec2/cross/overcut` at
1133/1136/1143-1144. `getcutpos`:857 also calls `sharp()` and clobbers the same globals, so they must
be treated as scratch only *within* a call.

### 1c. Locals (not state to replay)

`detail` (911), `ovmore` (912), `f2` (913), `ofs` (914), `sty` (915, the reference; the object it
points at is shared state), `newlines` (927), `glines` (951), `clk` (952), `path/paths/scale/S/s/ds/ox/oy`
(954-988), `newline` (990, 1117), `cuts/starts` (998-999), `cektab` (1002), `dogboneMode/dogbone/
isnotcutting/ro` (1101-1106), `cxt…` are implicit, `tl` (1114), `gline` (1116), `loopPts/midPt` (1136-1140).

### 1d. What a cache hit MUST replay (net)

A cache hit on `(lenmm, line, ofs)` that only returns the paths array will leave these stale and
change output. Restore/replay at minimum:

1. `maxofs` — it is a running **max over all shapes** (922), so a per-shape memo cannot just store
   "the shape's ofs": the driver must recompute `maxofs = max(all shapes' ofs)` (or store per-shape
   `ofs` and take the max after the loop). Skipping it under-scales `draw_line` (1582-1583).
2. `shapectr` — must be incremented once per cached shape too, or the positional `disable_ovc`
   test (1098) misfires for every later shape.
3. `cuttab_manual`, `starttab_manual`, `centerpath`, `srl` — `gcodepush` reads these globals
   **after** `prepare_line2` returns (724/736/751), so the cache must restore the exact arrays for
   that call (not just the paths).
4. `oldlines.push([lines, sty.num])` (1091) when `ofs > 0`.
5. `combinedpath.push([path, clk])` (994) for `sty.dovcarve` shapes.
6. `sty.S0` (971) and `sty.S1` (1090) — consumed by the `warn` overlay in `draw_line`.
7. `sty.isPoint`, `oshapenum`, `cxt/cyt/cnt/tl2/sr/sharpv/ov/cenx/ceny/x/y` are scratch/dead —
   safe to skip.

`sty.subchilds`/`sty.osubchilds`/`sty.exchilds` are **not** touched by `prepare_line2`; they are set
in `gcodepush` (715, 729, 741, 755).

`xmin2/xmax2/ymin2/ymax2` are **not** written by `prepare_line2`; they are accumulated by `linepush`
(664-672) and consumed by `xarea()` (449-458) from `gcodepush`:690. `warningpath` is also not written
by `prepare_line2` (`gcodepush`:743, `draw_line`:1624). `cuttabz` is not written here
(`getcutpos`:`cuttabz=0`, `draw_line`:1608).

---

## 2. Return-shape contract of `prepare_line2`

It returns a **2-element array `[pathsArray, clk]`**. `clk` is `isClockwise(lines)` (952), except the
CNC-drill branch which hardcodes `false` (949).

### 2a. Reachable returns

| # | Condition | Return value | `pathsArray` contents |
|---|---|---|---|
| 1 | 933 `cmd==CMD_CNC && lenmm<collapsepoint`; `dodrill` true | `[newlines, false]` (949) | `newlines` = one path: `[[ [feed, sx, sy, 0, 0] ]]` (943-945); `sty.isPoint=1`; `centerpath=[centroid]` (947) |
| 1b | same, `dodrill` false | `[newlines, false]` (949) | `newlines` stays `[]` (927); `srl`/`cuttab_manual`/`starttab_manual` stay `[]` |
| 2 | 993 `sty.dovcarve` | `[newlines, clk]` (1096) | **`[]`** — every Clipper path went to `combinedpath` (994); dogbone block never runs |
| 3 | 1098 `disable_ovc` contains `shapectr` OR `lenmm<noprocess` | `[glines, clk]` (1098) | offset paths, **no dogbone** |
| 4 | otherwise (normal) | `[newlines, clk]` (1161) | offset paths with dogbone insertions |

The `else` at 1092-1093 (`glines.push(lines)`) is unreachable because of the literal `if (1)` at 953.

### 2b. Aliasing safety — may a cache return the same object?

**Outer array and inner path arrays: yes, safe.** `newlines` (927) and `glines` (951) are freshly
allocated per call, and every vertex row is either freshly built (`newline.push([f2,x,y,s,ds])`:1080)
or, in the dogbone path, a reference to a row of the *same call's* `glines`
(1134/1156/1157). No vertex object crosses calls, so returning one cached array by reference is
safe as long as no downstream code mutates it.

**Downstream mutation:** `gcodepush` stores `lines[i]` / `linesx[i]` into `gcodes` by reference
(724, 736). I found no in-place writes to those vertex rows after Stage A: `lines2gcode` reads
`[1]`,`[2]`,`[4]` (2225-2257); `draw_line` reads; `getcutpos` reads `[4]`; `emitGcodeOnly`:3081
writes `sgcodes[j][0][0]` (the *gcodes entry's* length slot), not the vertex row. Caveat: this was a
targeted grep, not an exhaustive proof — flag for runtime confirmation.

**Caller mismatch (pre-existing, flag):** `gcodepush`:698 is
`var linesx = prepare_line2(...)[0];` then `var clk = linesx[1];`. Here `linesx` is the
`pathsArray`, so `clk` is actually `pathsArray[1]` (the second path / `undefined`), **not** the
returned `clk` boolean. The second call at 704-706 assigns the whole pair to `lines2` and does
`clk = lines2[1]`, which *is* correct. So the two call sites disagree on how to unpack the result;
`clk` at 702 is effectively truthiness of `pathsArray[1]`. Confirm intended semantics before relying
on `clk`.

**Two-call aliasing that the cache must reproduce:** for a closed shape,
`gcodepush` calls `prepare_line2` twice when `usefinish` applies — first with `ofs1=0` (698), then
with `ofs1=finishline` (704). The globals `srl`, `cuttab_manual`, `starttab_manual`, `centerpath`
are reassigned by *each* call (928/908/909/910). `centerpath` from the first call is preserved via
`var centerpath2 = centerpath` (699) and used for the `"F"` pass (736), but the first call's
`srl`/`cuttab_manual`/`starttab_manual` are overwritten by the second call and the first call's
values are lost; the `"F"` pass (730-737) therefore emits with the **second** call's
`srl`/`cuttab_manual`/`starttab_manual` and the **first** call's `centerpath`. A memo keyed by
`(lenmm, line, ofs)` must return a side-effect bundle per call and let `gcodepush` interleave them
exactly as today, or the produced G-code changes.

---

## 3. Can `gcode_verify`'s tail (3302-3382) run without the draw loop?

**No, not faithfully.** Several tail inputs are produced only inside the per-`sgcodes` draw loop
(3265-3297) or by functions the loop feeds. Line-by-line producer map:

| Tail input | Producer | Needs draw loop? |
|---|---|---|
| `xmax`, `xmin`, `ymax`, `ymin` | reset by `sortGcodes`:2426-2429; repopulated **only** by `draw_line`:1786-1789 (called from the loop 3265-3297) | **YES** |
| `w`, `h` (3309-3310) | derived from the bbox above; used 3362, 3373 | **YES** |
| `sfinal` (local, 3239) | `+=` inside the loop (3279) + `+= jmltravel` (3303) | **YES** |
| `jmltravel` (84) | incremented only in `draw_line`:1852; reset 3224 | **YES** |
| `travtime` (3302) | `jmltravel/speedtravel` | **YES** (transitively) |
| `engrave` map (118) | reset 3248; filled only by `draw_line`:1784 → `engraveline`/`newengraveline`/`addengrave` (1520-1564). No other producer: `addengrave` has exactly one caller chain rooted at `draw_line`:1784 | **YES** |
| `engravetime` (122) | reset 3245; incremented in `doengrave`:1483, 1500 | **YES** (transitively — `doengrave`:3299 needs `engrave`) |
| `pockettime` (cnc.js:23) | set by `drawvcarve`/`dopocketengrave` (called post-loop 3332-3333) | no (post-loop) |
| `carvetime` | reset `sortGcodes`:2423 **and now `gcode_verify`:3288 (fix)**; set in `cnc.js:584` (`vcarve()`, called via `dobtvcarve()`) | no (post-loop) |
| `totaltime` (190) | reset `sortGcodes`:2422 **and now `emitGcodeOnly`:2933 (fix)**; incremented in `lines2gcode`:2313 | no (emit) |
| `bitmaptime` (123) | reset 3246; set in cnc.js (1970, 2542) by `imagedither`/`cncengrave` called before the loop (3251-3258) | no |
| `menit` (3336) | depends on `travtime` + `engravetime` (loop) + `pockettime`/`carvetime`/`totaltime`/`bitmaptime` | **partially YES** |
| `ctx` (3231), `theme` (3241) | before loop | no (canvas only) |
| `pup1` (3320) | `getvalue("pup")` | no |
| `finishgcode` (3321-3325) | `pup1`, `fz` (3213, pre-loop), `f1` (3214, pre-loop), `getspindleoff()`, `finalz` | **no** — can run standalone |
| `startgcode` (3164-3165) | `emitGcodeOnly` | no |
| `e1` (27) | `gcoden` (614) during emit | no |
| `mat` (3312-3318) | DOM `$("material")` + `namamaterial` | no |
| `harga` (3208), `hargacut` (3209) | `getvalue` | no |
| `pgcode` (3326-3330) | `xmin/ymin/xmax/ymax` | **YES** |
| `gcodecarve` / `g` (3341) | `dobtvcarve`/`dopocketengrave`/`drawvcarve` (post-loop 3332-3334) → cnc.js; plus `engcode` may already contain `doengrave` raster output | `gcodecarve`: no; raster part: **YES** (transitively) |
| `gcodeinfo` / `area_dimension` (3362-3375) | `w`,`h`,`sfinal`,`menit` | **YES** |

### Conclusion for Tier C

`gcode_verify(1)`'s draw loop is **load-bearing**, not cosmetic:

- Skipping it leaves `xmax/xmin/ymax/ymin` at the `sortGcodes` reset sentinels (-10000 / 100000), so
  `w`,`h`,`pgcode` and the cost panel become garbage — and the *next* `sortGcodes` will copy that
  garbage into `sxmax/symax` (`sortGcodes`:2422-2425), poisoning the canvas scale and the
  `flipx`/`rotate` math in `lines2gcode`:2079/2088.
- Skipping it leaves `engrave` empty (it is reset at 3248), so `doengrave`:3299 early-returns
  (`if (!Object.keys(engrave).length) return;` 1199): the entire raster-engrave stream is dropped
  from `engcode`, not merely stale.
- `sfinal`/`travtime`/`menit` are zero/short because `jmltravel` is only accumulated in
  `draw_line`:1852.

Only a narrow late subset is loop-independent: `finishgcode` (3321-3325), `startgcode` (from emit),
`e1`, `mat`, `harga`/`hargacut`, and the post-loop `gcodecarve` generators. A "minimal finalize"
that omits the loop would therefore have to re-implement at least a bbox pass over
`sgcodes[·][0][4]` plus travel-length accumulation plus the `engrave` map build — i.e. it would
reinstate the loop. **Keeping `gcode_verify(1)` in Tier C (as `refreshgcodeFast` now does at
karyacnc.js:2524) is the correct call**; Tier C cannot safely skip it unless raster/engrave styles
and the size/length/time UI are declared out of scope.

---

## 3b. Tier C leaked the time accumulators → service price rose on every Process click (FIXED)

**Symptom:** clicking **Process** repeatedly without changing any parameter made the
`CNC Cost` / `TOTAL` panel (`appcore.js:3416`) climb on every click; only the *service* part grew,
Material (`w*h*matprice`) stayed put. The `Est: … minute` label (`appcore.js:3406`) rose with it.

**Root cause:** `menit` (`gcode_verify`:3379) sums six accumulators, but two of them were reset only
inside `sortGcodes()` — which the Tier C path never calls:

| Accumulator | Reset | Incremented by | Reset runs on Tier C? |
|---|---|---|---|
| `totaltime` | `sortGcodes`:2422 | `lines2gcode`:2313 (via `emitGcodeOnly`:3126/3185) | **no** → grew one full job time per click |
| `carvetime` | `sortGcodes`:2423 | `cnc.js:584` `vcarve()` (via `dobtvcarve()` ← `gcode_verify`:3375) | **no** → same leak when the job has V-carve paths |

`engravetime`/`bitmaptime` (reset in `gcode_verify`), `jmltravel` (`:3263` → `travtime`) and
`pockettime` (reset inside `pocketgcode()`, `cnc.js:1421`) were already idempotent — which is exactly
the pattern the two stragglers were missing.

`smartProcess()` (`karyacnc.js:1256`) routes an unchanged click to Tier C (`refreshgcodeFast`,
`karyacnc.js:2521`), so every extra click added one full contribution to both accumulators, and
`menit *= 2` (CNC mode, `:3381`) doubled the visible effect.

**Fix (2 lines, arithmetic untouched):** reset each accumulator at the entry of the function that
produces it — `totaltime = 0;` at the top of `emitGcodeOnly` (`appcore.js:2933`), `carvetime = 0;`
next to `engravetime = 0; bitmaptime = 0;` in `gcode_verify` (`appcore.js:3288`). The `sortGcodes`
resets stay (redundant but harmless, and still needed for a sort-only refresh).

**Regression test:** `node tools/price_probe.js` (live copy) must PASS; `--dir <pre-patch copy>`
must FAIL with the price climbing Rp810 → 1590 → 2400 → 3210 on identical input. The probe slices
the real increment/`menit` lines by anchor and asserts the reset sites, so it detects the bug's
return rather than trusting the patch.

---

## Uncertain / needs testing

- **Vertex arrays are never mutated after Stage A** — argued from targeted greps, not exhaustively
  proven. If a future emitter writes into `sgcodes[i][0][4][k]`, returning cached arrays by
  reference becomes unsafe. Add a runtime assertion or deep-freeze in dev.
- **`gcodepush`:698/700 `clk = linesx[1]`** looks like a latent unpacking bug (see 2b). I did not
  runtime-test whether the wrong `clk` changes output; it only gates the `usefinish` length
  threshold (702), so the blast radius may be small.
- **`maxofs` under a per-shape cache**: I recommend recomputing the max across all shapes after the
  geometry loop. If instead the cache stores/restores a per-shape `ofs`, confirm no shape is skipped
  and that `maxofs` is reset exactly as `myFunction`:3437 does.
- **`sortGcodes` idempotency** was not runtime-verified; the prelude (2437-2443) addresses the two
  destructive marks I can see (`gcodes[·][6]` sign, `sty.subchilds`), but the bbox reset noted in
  section 3 is a separate hazard if a sort-only refresh is ever run without a following
  `gcode_verify` redraw.
