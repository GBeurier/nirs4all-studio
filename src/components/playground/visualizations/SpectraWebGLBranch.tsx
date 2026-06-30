import { SpectraWebGL, type SpectraWebGLProps } from './SpectraWebGL';
import { WebglIndicatorBadge } from './WebglIndicatorBadge';

export type SpectraWebGLBranchProps = Pick<
  SpectraWebGLProps,
  | 'xLabel'
  | 'spectra'
  | 'originalSpectra'
  | 'wavelengths'
  | 'y'
  | 'sampleIds'
  | 'folds'
  | 'visibleIndices'
  | 'sampleColors'
  | 'aggregatedStats'
  | 'groupedStats'
  | 'useSelectionContext'
  | 'selectedColor'
  | 'applySelectionColoring'
  | 'unselectedOpacity'
  | 'enableHover'
  | 'showHoverTooltip'
  | 'isLoading'
  | 'className'
>;

export function SpectraWebGLBranch(props: SpectraWebGLBranchProps) {
  return (
    <>
      <WebglIndicatorBadge />
      <SpectraWebGL {...props} />
    </>
  );
}
