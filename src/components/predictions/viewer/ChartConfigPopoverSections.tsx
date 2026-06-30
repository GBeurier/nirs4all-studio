/**
 * Public export surface for the chart-config popover sections.
 *
 * The focused section implementations live in sibling ChartConfigPopover*
 * modules; keep these re-exports stable for existing imports.
 */

export { ConfusionSection } from "./ChartConfigPopoverConfusionSection";
export { DistributionSection } from "./ChartConfigPopoverDistributionSection";
export { GlobalSection } from "./ChartConfigPopoverGlobalSection";
export {
  PointsSection,
  ResidualsSection,
  ScatterSection,
} from "./ChartConfigPopoverRegressionSections";
