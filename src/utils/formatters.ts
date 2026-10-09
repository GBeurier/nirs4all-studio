/**
 * Date and time formatting utilities
 *
 * Provides common date/time formatting functions used across the application.
 */

import i18next from "i18next";
import { getActiveLocale } from "@/lib/activeLocale";

/**
 * Format a date string to a human-readable relative time string
 *
 * @param dateString - ISO date string
 * @returns Localised relative time string like "Just now", "2 hours ago", "Yesterday", etc.
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
    return i18next.t("time.justNow");
  } else if (diffMinutes < 60) {
    return i18next.t("time.minutesAgo", { count: diffMinutes });
  } else if (diffHours < 24) {
    return i18next.t("time.hoursAgo", { count: diffHours });
  } else if (diffDays === 1) {
    return i18next.t("time.yesterday");
  } else if (diffDays < 7) {
    return i18next.t("time.daysAgo", { count: diffDays });
  } else {
    return date.toLocaleDateString(getActiveLocale());
  }
}

/**
 * Format bytes to a human-readable string
 *
 * @param bytes - Number of bytes
 * @returns Localised formatted string like "1.5 MB", "256 KB" (en) or "1,5 Mo", "256 Ko" (fr)
 *
 * @example
 * formatBytes(1536) // "1.5 KB" (en), "1,5 Ko" (fr)
 * formatBytes(1048576) // "1 MB" (en), "1 Mo" (fr)
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return `0 ${i18next.t("common.format.byteUnit.b")}`;
  const k = 1024;
  const units = ["b", "kb", "mb", "gb", "tb"] as const;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const value = new Intl.NumberFormat(getActiveLocale(), { maximumFractionDigits: 1 }).format(bytes / Math.pow(k, i));
  return `${value} ${i18next.t(`common.format.byteUnit.${units[i]}`)}`;
}

/**
 * Format a date to a short date string
 *
 * @param dateString - ISO date string
 * @returns Formatted date like "Jan 7, 2026"
 */
export function formatShortDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(getActiveLocale(), {
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
  return date.toLocaleString(getActiveLocale(), {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
