**Findings**

1. `points -> []` leaves stale pixels and stale picking in both 2D renderers. In [ScatterPureWebGL2D.tsx](/home/delete/nirs4all/nirs4all-studio/src/components/playground/visualizations/scatter/ScatterPureWebGL2D.tsx:817), the dirty flag is consumed before `render()`, but `render()` returns on empty data at [line 708](/home/delete/nirs4all/nirs4all-studio/src/components/playground/visualizations/scatter/ScatterPureWebGL2D.tsx:708) without clearing the visible canvas or picking buffer. Same issue in [ScatterRegl2D.tsx](/home/delete/nirs4all/nirs4all-studio/src/components/playground/visualizations/scatter/ScatterRegl2D.tsx:633) and [line 528](/home/delete/nirs4all/nirs4all-studio/src/components/playground/visualizations/scatter/ScatterRegl2D.tsx:528). Result: old points can remain visible/clickable after data clears.

2. DPR-only changes are not invalidated in the static scatter renderers. The new `ResizeObserver` paths only catch element-size changes: [2D pure](/home/delete/nirs4all/nirs4all-studio/src/components/playground/visualizations/scatter/ScatterPureWebGL2D.tsx:804), [2D regl](/home/delete/nirs4all/nirs4all-studio/src/components/playground/visualizations/scatter/ScatterRegl2D.tsx:620), [3D](/home/delete/nirs4all/nirs4all-studio/src/components/playground/visualizations/scatter/ScatterPureWebGL3D.tsx:823). Since render and picking coordinates read `window.devicePixelRatio`, moving between displays or DPR changes without a content resize can leave the backing canvas/picking buffer stale until some unrelated invalidation.

**Looks Correct**

Spectra invalidation coverage looks OK for normal immutable updates: `lines`, `yRange`, `xViewRange`, hover, grid, aggregated/grouped wrappers are in [SceneInvalidator](/home/delete/nirs4all/nirs4all-studio/src/components/playground/visualizations/SpectraWebGL.tsx:1275). Selection/pinned/color/y/sampleColors/quality max-points flow through `lines`.

`invalidate` is obtained correctly from `useThree`; native wheel/pan/hover handlers explicitly invalidate. Click selection redraw relies on selection state changing `lines`, not r3f pointer auto-invalidation.

3D orbit rendering looks covered: `onChange` marks dirty, `isAnimating()` covers drag plus damping velocity, and reset calls `onChange`.

`React.memo` is safe with immutable props, but it will skip changed-but-same-reference mutations. It is also partly defeated in aggregated/grouped modes by fresh props from the caller, notably the `[]` spectra literal and grouped `sampleColors` array.