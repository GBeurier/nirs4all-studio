import type { DropIndicator } from "./types";

interface StepItemDropData {
  path?: string[];
  index?: number;
}

interface RectLike {
  top: number;
  height: number;
}

export function pathsEqual(left: string[] = [], right: string[] = []): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

export function getStepItemDropIndicator(
  overData: StepItemDropData,
  overRect?: RectLike | null,
  activeRect?: RectLike | null
): DropIndicator {
  const path = overData.path ?? [];
  const baseIndex = overData.index ?? 0;
  const activeMidpoint = activeRect ? activeRect.top + activeRect.height / 2 : null;
  const overMidpoint = overRect ? overRect.top + overRect.height / 2 : null;
  const insertAfter =
    activeMidpoint !== null && overMidpoint !== null
      ? activeMidpoint >= overMidpoint
      : true;

  return {
    path,
    index: baseIndex + (insertAfter ? 1 : 0),
    position: insertAfter ? "after" : "before",
  };
}

export function getAdjustedInsertIndex(
  sourcePath: string[] | undefined,
  sourceIndex: number,
  targetPath: string[],
  targetIndex: number
): number {
  if (sourceIndex < 0) {
    return targetIndex;
  }

  if (pathsEqual(sourcePath ?? [], targetPath) && sourceIndex < targetIndex) {
    return targetIndex - 1;
  }

  return targetIndex;
}
