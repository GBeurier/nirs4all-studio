/**
 * Shared radial geometry for the chain sunburst / hub navigators.
 *
 * Pure, framework-free SVG path + angle helpers, so {@link ChainNodeOrbit} and
 * {@link ChainNodeHub} render from one tested source.
 */

import { round } from "../viz/geometry.js";
import type { FlowNode } from "./types.js";

export const TAU = Math.PI * 2;
/** 12 o'clock — where every ring starts, sweeping clockwise. */
export const START = -Math.PI / 2;

/** Cartesian point on a circle of radius `r` at `angle` (radians). */
export function polar(cx0: number, cy0: number, r: number, angle: number): [number, number] {
  return [cx0 + r * Math.cos(angle), cy0 + r * Math.sin(angle)];
}

/** Donut segment between two radii and two angles (clockwise). */
export function annularSector(cx0: number, cy0: number, rInner: number, rOuter: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0o, y0o] = polar(cx0, cy0, rOuter, a0);
  const [x1o, y1o] = polar(cx0, cy0, rOuter, a1);
  const [x1i, y1i] = polar(cx0, cy0, rInner, a1);
  const [x0i, y0i] = polar(cx0, cy0, rInner, a0);
  return [
    `M${round(x0o)} ${round(y0o)}`,
    `A${round(rOuter)} ${round(rOuter)} 0 ${large} 1 ${round(x1o)} ${round(y1o)}`,
    `L${round(x1i)} ${round(y1i)}`,
    `A${round(rInner)} ${round(rInner)} 0 ${large} 0 ${round(x0i)} ${round(y0i)}`,
    "Z",
  ].join(" ");
}

/** Full pie slice from the centre to `rOuter`. */
export function pieSector(cx0: number, cy0: number, rOuter: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx0, cy0, rOuter, a0);
  const [x1, y1] = polar(cx0, cy0, rOuter, a1);
  return `M${round(cx0)} ${round(cy0)} L${round(x0)} ${round(y0)} A${round(rOuter)} ${round(rOuter)} 0 ${large} 1 ${round(x1)} ${round(y1)} Z`;
}

/** Deepest level with nodes in a flow tree. */
export function treeDepth(nodes: readonly FlowNode[]): number {
  let depth = 0;
  for (const node of nodes) depth = Math.max(depth, 1 + treeDepth(node.children));
  return depth;
}

/** Tangential label rotation (degrees) at a mid-angle, flipped to stay upright. */
export function labelRotation(mid: number): number {
  let deg = (mid * 180) / Math.PI + 90;
  deg = ((deg % 360) + 360) % 360;
  if (deg > 90 && deg < 270) deg -= 180;
  return round(deg);
}
