// Log helpers for the RunProgress page: context parsing for log badges and
// text-file export utilities.

// Parse log entry for context indicators (fold, branch, variant)
export function parseLogContext(log: string): { foldInfo?: string; branchInfo?: string; variantInfo?: string } {
  const result: { foldInfo?: string; branchInfo?: string; variantInfo?: string } = {};

  // Match fold patterns: "Fold 3/5", "fold 3 of 5"
  const foldMatch = log.match(/[Ff]old\s*(\d+)\s*[/of]+\s*(\d+)/i);
  if (foldMatch) {
    result.foldInfo = `F${foldMatch[1]}/${foldMatch[2]}`;
  }

  // Match branch patterns: "Branch [0]:", "Branch: SNV -> PLS"
  const branchMatch = log.match(/[Bb]ranch\s*\[?(\d+)\]?\s*[:|-]\s*([^,]+)/);
  if (branchMatch) {
    result.branchInfo = branchMatch[2].trim().substring(0, 20);
  }

  // Match variant patterns: "Variant 2/6", "Config 3 of 10"
  const variantMatch = log.match(/[Vv]ariant\s*(\d+)\s*[/of]+\s*(\d+)/i) ||
                       log.match(/[Cc]onfig(?:uration)?\s*(\d+)\s*[/of]+\s*(\d+)/i);
  if (variantMatch) {
    result.variantInfo = `V${variantMatch[1]}/${variantMatch[2]}`;
  }

  return result;
}

export function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function sanitizeFilename(value: string | null | undefined): string {
  return (value || "run")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "run";
}
