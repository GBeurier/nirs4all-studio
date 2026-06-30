export interface SpectraWebGLAxisTick {
  position: number;
  label: number;
}

export function buildSpectraWebGLAxisTicks(
  range: [number, number],
  tickCount: number
): SpectraWebGLAxisTick[] {
  if (tickCount <= 0) return [];
  if (tickCount === 1) return [{ position: 0, label: range[0] }];

  const [min, max] = range;
  const denominator = tickCount - 1;

  return Array.from({ length: tickCount }, (_, index) => {
    const position = index / denominator;

    return {
      position,
      label: min + position * (max - min),
    };
  });
}
