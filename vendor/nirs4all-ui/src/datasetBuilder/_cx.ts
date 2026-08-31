// Internal class-name join helper (not exported from the package barrel).
export function cx(...parts: Array<string | false | null | undefined>): string | undefined {
  const resolved = parts.filter((p): p is string => typeof p === "string" && p.length > 0);
  return resolved.length > 0 ? resolved.join(" ") : undefined;
}
