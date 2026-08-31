// Internal class-name join helper for the viz domain (not part of the public
// barrel). Mirrors the same tiny helper used by the lab components so the charts
// stay free of any external `clsx` dependency.
export function cx(...parts: Array<string | false | null | undefined>): string | undefined {
  const resolved = parts.filter((p): p is string => typeof p === "string" && p.length > 0);
  return resolved.length > 0 ? resolved.join(" ") : undefined;
}
