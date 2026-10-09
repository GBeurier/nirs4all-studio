/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/lib/i18n";
import { formatBytes, formatRelativeTime } from "./formatters";
import { formatBytes as formatBytesLib, formatNumber, formatRelativeDate } from "@/lib/utils";

const NOW = new Date("2026-10-09T12:00:00Z");

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  vi.useRealTimers();
  await i18n.changeLanguage("en");
});

describe("formatRelativeTime", () => {
  it("renders English relative times with plurals", () => {
    expect(formatRelativeTime(ago(10_000))).toBe("Just now");
    expect(formatRelativeTime(ago(MINUTE))).toBe("1 minute ago");
    expect(formatRelativeTime(ago(5 * MINUTE))).toBe("5 minutes ago");
    expect(formatRelativeTime(ago(HOUR))).toBe("1 hour ago");
    expect(formatRelativeTime(ago(DAY))).toBe("Yesterday");
    expect(formatRelativeTime(ago(3 * DAY))).toBe("3 days ago");
  });

  it("renders French relative times with plurals", async () => {
    await i18n.changeLanguage("fr");
    expect(formatRelativeTime(ago(10_000))).toBe("À l'instant");
    expect(formatRelativeTime(ago(MINUTE))).toBe("Il y a 1 minute");
    expect(formatRelativeTime(ago(5 * MINUTE))).toBe("Il y a 5 minutes");
    expect(formatRelativeTime(ago(DAY))).toBe("Hier");
    expect(formatRelativeTime(ago(3 * DAY))).toBe("Il y a 3 jours");
  });

  it("falls back to a date in the active locale after a week", async () => {
    const iso = ago(20 * DAY);
    expect(formatRelativeTime(iso)).toBe(new Date(iso).toLocaleDateString("en"));
    await i18n.changeLanguage("fr");
    expect(formatRelativeTime(iso)).toBe(new Date(iso).toLocaleDateString("fr"));
  });
});

describe("formatRelativeDate", () => {
  it("localises day, week, month and year buckets", async () => {
    expect(formatRelativeDate(new Date(NOW.getTime() - HOUR))).toBe("Today");
    expect(formatRelativeDate(ago(2 * DAY))).toBe("2 days ago");
    expect(formatRelativeDate(ago(14 * DAY))).toBe("2 weeks ago");
    expect(formatRelativeDate(ago(400 * DAY))).toBe("1 year ago");
    await i18n.changeLanguage("fr");
    expect(formatRelativeDate(new Date(NOW.getTime() - HOUR))).toBe("Aujourd'hui");
    expect(formatRelativeDate(ago(DAY))).toBe("Hier");
    expect(formatRelativeDate(ago(60 * DAY))).toBe("Il y a 2 mois");
    expect(formatRelativeDate(ago(800 * DAY))).toBe("Il y a 2 ans");
  });
});

describe("formatBytes", () => {
  it("uses English units and decimal point", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1_048_576)).toBe("1 MB");
    expect(formatBytesLib(1536)).toBe("1.5 KB");
  });

  it("uses French units and decimal comma", async () => {
    await i18n.changeLanguage("fr");
    expect(formatBytes(0)).toBe("0 o");
    expect(formatBytes(1536)).toBe("1,5 Ko");
    expect(formatBytes(1_048_576)).toBe("1 Mo");
    expect(formatBytesLib(1536)).toBe("1,5 Ko");
  });
});

describe("formatNumber", () => {
  it("formats compact numbers for the active locale", async () => {
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(1500)).toBe("1.5K");
    await i18n.changeLanguage("fr");
    expect(formatNumber(1500)).toMatch(/^1,5\s?k$/);
  });
});
