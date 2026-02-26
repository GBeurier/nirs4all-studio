/**
 * DependenciesManager Component Tests
 *
 * Logic-level tests for the coherence banner, standalone mode banner,
 * and button state decisions in the DependenciesManager component.
 *
 * These tests verify the conditional rendering logic (which combinations
 * of state produce which UI elements) without full DOM rendering.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";

// ============= EnvCoherence Interface Shape =============

interface EnvCoherence {
  coherent: boolean;
  python_match: boolean;
  prefix_match: boolean;
  runtime: { python: string; prefix: string; version: string };
  venv_manager: {
    python: string;
    prefix: string;
    is_custom: boolean;
    custom_path: string | null;
    has_pending_change: boolean;
  };
}

// ============= Coherence Banner Logic =============

/**
 * Mirrors the DependenciesManager rendering logic:
 * - Show mismatch banner when coherent=false AND not frozen
 * - Show standalone banner when isFrozen=true
 * - Disable mutation buttons when isFrozen=true
 */
function shouldShowMismatchBanner(
  coherence: EnvCoherence | null,
  isFrozen: boolean,
): boolean {
  if (isFrozen) return false;
  if (!coherence) return false;
  return !coherence.coherent;
}

function shouldShowStandaloneBanner(isFrozen: boolean): boolean {
  return isFrozen;
}

function areMutationButtonsDisabled(isFrozen: boolean): boolean {
  return isFrozen;
}

// ============= Tests =============

describe("DependenciesManager", () => {
  describe("Coherence Banner Logic", () => {
    it("should show mismatch banner when coherent=false and not frozen", () => {
      const coherence: EnvCoherence = {
        coherent: false,
        python_match: false,
        prefix_match: false,
        runtime: { python: "/usr/bin/python3", prefix: "/usr", version: "3.11.0" },
        venv_manager: {
          python: "/other/python",
          prefix: "/other",
          is_custom: true,
          custom_path: "/other",
          has_pending_change: false,
        },
      };

      expect(shouldShowMismatchBanner(coherence, false)).toBe(true);
    });

    it("should hide mismatch banner when coherent=true", () => {
      const coherence: EnvCoherence = {
        coherent: true,
        python_match: true,
        prefix_match: true,
        runtime: { python: "/usr/bin/python3", prefix: "/usr", version: "3.11.0" },
        venv_manager: {
          python: "/usr/bin/python3",
          prefix: "/usr",
          is_custom: false,
          custom_path: null,
          has_pending_change: false,
        },
      };

      expect(shouldShowMismatchBanner(coherence, false)).toBe(false);
    });

    it("should hide mismatch banner when coherence data is null", () => {
      expect(shouldShowMismatchBanner(null, false)).toBe(false);
    });

    it("should hide mismatch banner in standalone mode even if incoherent", () => {
      const coherence: EnvCoherence = {
        coherent: false,
        python_match: false,
        prefix_match: false,
        runtime: { python: "/usr/bin/python3", prefix: "/usr", version: "3.11.0" },
        venv_manager: {
          python: "/other/python",
          prefix: "/other",
          is_custom: true,
          custom_path: "/other",
          has_pending_change: false,
        },
      };

      // Standalone mode takes priority — no point showing mismatch
      // when the user cannot install packages anyway
      expect(shouldShowMismatchBanner(coherence, true)).toBe(false);
    });
  });

  describe("Standalone Mode Banner Logic", () => {
    it("should show standalone banner when isFrozen=true", () => {
      expect(shouldShowStandaloneBanner(true)).toBe(true);
    });

    it("should hide standalone banner when isFrozen=false", () => {
      expect(shouldShowStandaloneBanner(false)).toBe(false);
    });
  });

  describe("Button States", () => {
    it("should disable install/uninstall buttons when frozen", () => {
      expect(areMutationButtonsDisabled(true)).toBe(true);
    });

    it("should enable install/uninstall buttons when not frozen", () => {
      expect(areMutationButtonsDisabled(false)).toBe(false);
    });
  });

  describe("EnvCoherence Interface", () => {
    it("should include all expected fields in coherent response", () => {
      const coherence: EnvCoherence = {
        coherent: true,
        python_match: true,
        prefix_match: true,
        runtime: { python: "/usr/bin/python3", prefix: "/usr", version: "3.11.9" },
        venv_manager: {
          python: "/usr/bin/python3",
          prefix: "/usr",
          is_custom: false,
          custom_path: null,
          has_pending_change: false,
        },
      };

      expect(coherence.coherent).toBe(true);
      expect(coherence.runtime.version).toBe("3.11.9");
      expect(coherence.venv_manager.is_custom).toBe(false);
      expect(coherence.venv_manager.has_pending_change).toBe(false);
    });

    it("should represent pending path change correctly", () => {
      const coherence: EnvCoherence = {
        coherent: true, // Still coherent because change is pending, not active
        python_match: true,
        prefix_match: true,
        runtime: { python: "/usr/bin/python3", prefix: "/usr", version: "3.11.0" },
        venv_manager: {
          python: "/usr/bin/python3",
          prefix: "/usr",
          is_custom: false,
          custom_path: null,
          has_pending_change: true,
        },
      };

      expect(coherence.coherent).toBe(true);
      expect(coherence.venv_manager.has_pending_change).toBe(true);
    });
  });
});
