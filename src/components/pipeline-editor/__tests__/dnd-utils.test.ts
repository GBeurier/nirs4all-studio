import { describe, expect, it } from "vitest";
import {
  getAdjustedInsertIndex,
  getStepItemDropIndicator,
  pathsEqual,
} from "../dnd-utils";

describe("dnd-utils", () => {
  describe("pathsEqual", () => {
    it("matches identical paths", () => {
      expect(pathsEqual(["branch", "0"], ["branch", "0"])).toBe(true);
    });

    it("rejects different paths", () => {
      expect(pathsEqual(["branch", "0"], ["branch", "1"])).toBe(false);
    });
  });

  describe("getStepItemDropIndicator", () => {
    it("targets before the node when hovering in the upper half", () => {
      expect(
        getStepItemDropIndicator(
          { path: ["step-a", "branch", "0"], index: 2 },
          { top: 100, height: 40 },
          { top: 90, height: 20 }
        )
      ).toEqual({
        path: ["step-a", "branch", "0"],
        index: 2,
        position: "before",
      });
    });

    it("targets after the node when hovering in the lower half", () => {
      expect(
        getStepItemDropIndicator(
          { path: ["step-a", "branch", "0"], index: 2 },
          { top: 100, height: 40 },
          { top: 130, height: 20 }
        )
      ).toEqual({
        path: ["step-a", "branch", "0"],
        index: 3,
        position: "after",
      });
    });

    it("falls back to dropping after when rects are unavailable", () => {
      expect(getStepItemDropIndicator({ path: [], index: 0 }, null, null)).toEqual({
        path: [],
        index: 1,
        position: "after",
      });
    });
  });

  describe("getAdjustedInsertIndex", () => {
    it("decrements the target index when moving down in the same list", () => {
      expect(getAdjustedInsertIndex(["root"], 1, ["root"], 4)).toBe(3);
    });

    it("keeps the target index when moving up in the same list", () => {
      expect(getAdjustedInsertIndex(["root"], 4, ["root"], 1)).toBe(1);
    });

    it("keeps the target index for cross-list moves", () => {
      expect(getAdjustedInsertIndex(["root"], 1, ["branch", "0"], 2)).toBe(2);
    });
  });
});
