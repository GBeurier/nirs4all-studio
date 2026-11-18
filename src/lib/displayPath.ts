/**
 * Show a Windows extended-length path (`\\?\C:\…`, `\\?\UNC\server\…`) in its
 * ordinary form. Display only: requests keep the original value.
 */
export function displayPath(path: string): string;
export function displayPath(path: string | undefined): string | undefined;
export function displayPath(path: string | undefined): string | undefined {
  if (path === undefined) return path;
  if (path.startsWith("\\\\?\\UNC\\")) return `\\\\${path.slice(8)}`;
  if (/^\\\\\?\\[A-Za-z]:\\/.test(path)) return path.slice(4);
  return path;
}
