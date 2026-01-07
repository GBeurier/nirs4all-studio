/**
 * Date and time formatting utilities
 *
 * Provides common date/time formatting functions used across the application.
 */

/**
 * Format a date string to a human-readable relative time string
 *
 * @param dateString - ISO date string
 * @returns Relative time string like "Just now", "2 hours ago", "Yesterday", etc.
 *
 * @example
 * formatRelativeTime("2026-01-07T10:30:00Z") // "2 hours ago"
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return "Just now";
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes > 1 ? "s" : ""} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Format bytes to a human-readable string
 *
 * @param bytes - Number of bytes
 * @returns Formatted string like "1.5 MB", "256 KB", etc.
 *
 * @example
 * formatBytes(1536) // "1.5 KB"
 * formatBytes(1048576) // "1 MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format a date to a short date string
 *
 * @param dateString - ISO date string
 * @returns Formatted date like "Jan 7, 2026"
 */
export function formatShortDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a date to a date-time string
 *
 * @param dateString - ISO date string
 * @returns Formatted date-time like "Jan 7, 2026, 10:30 AM"
 */
export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
