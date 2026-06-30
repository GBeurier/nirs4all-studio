export interface RepetitionsDataBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface RepetitionsZoomInfo {
  level: number;
  visible: number;
  total: number;
}

export interface RepetitionsXAxisViewport {
  effectiveXDomain: [number, number];
  visibleStart: number;
  visibleEnd: number;
  visibleCount: number;
  xTicks: number[];
}

function getDefaultRepetitionsXDomain(groupCount: number): [number, number] {
  return [-0.5, groupCount - 0.5];
}

export function buildRepetitionsDataBounds(
  xDomain: [number, number] | null,
  groupCount: number,
  yDomain: [number, number]
): RepetitionsDataBounds {
  const effectiveDomain = xDomain ?? getDefaultRepetitionsXDomain(groupCount);
  return {
    minX: effectiveDomain[0],
    maxX: effectiveDomain[1],
    minY: yDomain[0],
    maxY: yDomain[1],
  };
}

export function buildRepetitionsZoomInfo(
  xDomain: [number, number] | null,
  groupCount: number
): RepetitionsZoomInfo {
  if (groupCount === 0) return { level: 100, visible: 0, total: 0 };

  const effectiveDomain = xDomain ?? getDefaultRepetitionsXDomain(groupCount);
  const visibleRange = effectiveDomain[1] - effectiveDomain[0];
  const visibleSamples = Math.round(visibleRange);
  const zoomPercent = Math.round((visibleSamples / groupCount) * 100);
  return { level: zoomPercent, visible: visibleSamples, total: groupCount };
}

export function buildRepetitionsXAxisViewport(
  xDomain: [number, number] | null,
  groupCount: number,
  maxTicks = 18
): RepetitionsXAxisViewport {
  const effectiveXDomain: [number, number] = xDomain ?? getDefaultRepetitionsXDomain(groupCount);
  const visibleStart = Math.max(0, Math.floor(effectiveXDomain[0]));
  const visibleEnd = Math.min(groupCount - 1, Math.ceil(effectiveXDomain[1]));
  const visibleCount = visibleEnd >= visibleStart ? visibleEnd - visibleStart + 1 : 0;
  const xTickStep = Math.max(1, Math.ceil(Math.max(visibleCount, 1) / maxTicks));
  const xTicks: number[] = [];

  for (let index = visibleStart; index <= visibleEnd; index += xTickStep) {
    xTicks.push(index);
  }
  if (visibleEnd >= visibleStart && (xTicks.length === 0 || xTicks[xTicks.length - 1] !== visibleEnd)) {
    xTicks.push(visibleEnd);
  }

  return {
    effectiveXDomain,
    visibleStart,
    visibleEnd,
    visibleCount,
    xTicks,
  };
}

export function zoomRepetitionsXDomain({
  xDomain,
  groupCount,
  deltaY,
}: {
  xDomain: [number, number] | null;
  groupCount: number;
  deltaY: number;
}): [number, number] | null {
  if (groupCount === 0) return null;

  const currentDomain = xDomain ?? getDefaultRepetitionsXDomain(groupCount);
  const range = currentDomain[1] - currentDomain[0];
  const center = (currentDomain[0] + currentDomain[1]) / 2;
  const zoomFactor = deltaY > 0 ? 1.2 : 0.8;
  const newRange = Math.min(Math.max(range * zoomFactor, 1), groupCount);
  const newStart = Math.max(-0.5, center - newRange / 2);
  const newEnd = Math.min(groupCount - 0.5, center + newRange / 2);

  return [newStart, newEnd];
}

export function panRepetitionsXDomain({
  xDomain,
  groupCount,
  chartWidth,
  deltaX,
}: {
  xDomain: [number, number] | null;
  groupCount: number;
  chartWidth: number;
  deltaX: number;
}): [number, number] | null {
  if (groupCount === 0 || chartWidth <= 0) return null;

  const currentDomain = xDomain ?? getDefaultRepetitionsXDomain(groupCount);
  const range = currentDomain[1] - currentDomain[0];
  const deltaSamples = -(deltaX / chartWidth) * range;
  let newStart = currentDomain[0] + deltaSamples;
  let newEnd = currentDomain[1] + deltaSamples;

  if (newStart < -0.5) {
    newEnd -= newStart + 0.5;
    newStart = -0.5;
  }
  if (newEnd > groupCount - 0.5) {
    newStart -= newEnd - (groupCount - 0.5);
    newEnd = groupCount - 0.5;
  }

  return [Math.max(-0.5, newStart), Math.min(groupCount - 0.5, newEnd)];
}
