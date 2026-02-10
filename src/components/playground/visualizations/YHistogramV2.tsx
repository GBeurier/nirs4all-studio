/**
 * YHistogramV2 - Re-export from histogram/ sub-components.
 *
 * This file preserves backward compatibility for existing imports.
 * The component has been split into sub-components for better code splitting:
 *   - histogram/types.ts         - Shared types and interfaces
 *   - histogram/utils.ts         - Pure utility functions (KDE, bin calculation)
 *   - histogram/useHistogramData.ts - Shared hook for all histogram state
 *   - histogram/HistogramBase.tsx - Shared header/footer/legend layout
 *   - histogram/HistogramSimple.tsx - Simple (non-stacked) mode
 *   - histogram/HistogramByPartition.tsx - Stacked by train/test
 *   - histogram/HistogramByFold.tsx - Stacked by fold
 *   - histogram/HistogramByMetadata.tsx - Stacked by metadata category
 *   - histogram/HistogramBySelection.tsx - Stacked by selection state
 *   - histogram/HistogramClassification.tsx - Classification bar chart
 *   - histogram/index.tsx        - Mode router with React.lazy()
 */

export { YHistogramV2 } from './histogram';
export type { BinCountOption } from './histogram/types';
export { default } from './histogram';
