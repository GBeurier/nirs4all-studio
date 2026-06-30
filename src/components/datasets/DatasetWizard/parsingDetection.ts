export interface DetectedParsingFormat {
  delimiter: string;
  decimal: string;
}

const CANDIDATE_DELIMITERS = [";", ",", "\t", "|"];
const DEFAULT_DETECTED_FORMAT: DetectedParsingFormat = {
  delimiter: ";",
  decimal: ".",
};

function countOccurrences(value: string, token: string): number {
  return value.split(token).length - 1;
}

function scoreDelimiter(lineCounts: number[]): number {
  const avg = lineCounts.reduce((sum, count) => sum + count, 0) / lineCounts.length;
  const variance = lineCounts.reduce((sum, count) => sum + Math.pow(count - avg, 2), 0) / lineCounts.length;
  return avg > 0 ? avg / (1 + variance) : 0;
}

export function detectDelimiterFromContent(content: string): DetectedParsingFormat {
  const lines = content.split("\n").slice(0, 10).filter((line) => line.trim());
  if (lines.length === 0) return DEFAULT_DETECTED_FORMAT;

  let delimiter = DEFAULT_DETECTED_FORMAT.delimiter;
  let bestScore = 0;

  for (const candidate of CANDIDATE_DELIMITERS) {
    const score = scoreDelimiter(lines.map((line) => countOccurrences(line, candidate)));
    if (score > bestScore) {
      bestScore = score;
      delimiter = candidate;
    }
  }

  const numericPattern = /\d+[.,]\d+/g;
  let dotCount = 0;
  let commaCount = 0;

  for (const line of lines) {
    const matches = line.match(numericPattern) || [];
    for (const match of matches) {
      if (match.includes(".")) dotCount++;
      if (match.includes(",") && delimiter !== ",") commaCount++;
    }
  }

  return {
    delimiter,
    decimal: commaCount > dotCount ? "," : ".",
  };
}
