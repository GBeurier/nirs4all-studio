import type { SpectraWebGLLineData } from './spectraWebGLLines';

export interface SpectraWebGLLinePartition {
  normalLines: SpectraWebGLLineData[];
  originalLines: SpectraWebGLLineData[];
  selectedLines: SpectraWebGLLineData[];
  pinnedLines: SpectraWebGLLineData[];
}

export function partitionSpectraWebGLLines(
  lines: SpectraWebGLLineData[],
  selectedIndices?: ReadonlySet<number>,
  pinnedIndices?: ReadonlySet<number>
): SpectraWebGLLinePartition {
  const normalLines: SpectraWebGLLineData[] = [];
  const originalLines: SpectraWebGLLineData[] = [];
  const selectedLines: SpectraWebGLLineData[] = [];
  const pinnedLines: SpectraWebGLLineData[] = [];

  for (const line of lines) {
    const isPinned = pinnedIndices?.has(line.index) ?? false;
    const isSelected = selectedIndices?.has(line.index) ?? false;

    if (isPinned) {
      pinnedLines.push(line);
    } else if (isSelected) {
      selectedLines.push(line);
    } else if (line.isOriginal) {
      originalLines.push(line);
    } else {
      normalLines.push(line);
    }
  }

  return { normalLines, originalLines, selectedLines, pinnedLines };
}
