export const CANDLESTICK_EMPTY_MESSAGE = 'No box plot data available.';

export function getCandlestickEmptyMessage(): string {
  return CANDLESTICK_EMPTY_MESSAGE;
}

export function formatCandlestickLabel(label: string, maxLength = 20): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 2)}\u2026` : label;
}

export function formatCandlestickTick(value: number): string {
  return value.toFixed(3);
}

export function formatCandlestickScore(value: number): string {
  return value.toFixed(4);
}

export function formatCandlestickIqr(q25: number, q75: number): string {
  return formatCandlestickScore(q75 - q25);
}

export function formatCandlestickCount(count: number): string {
  return `n = ${count}`;
}
