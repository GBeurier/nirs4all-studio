/** @vitest-environment jsdom */
import i18n from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

import "@/lib/i18n";
import {
  canUseEnvironment,
  describeEnvironment,
  initialPackageSelection,
  packageListing,
  primaryActionKind,
} from "../pythonEnvModel";
import { envReport, newEnvPlan, recommendedPackage, requiredPackage } from "./fixtures";

const t = i18n.t.bind(i18n);
const labels = (...args: Parameters<typeof envReport>) => describeEnvironment(envReport(...args), t).map((chip) => chip.label);

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("what an environment lacks", () => {
  it("names the nirs4all change and counts the recommended gaps", () => {
    expect(labels({ required: [requiredPackage({ installedVersion: null, status: "missing" })] })).toEqual([
      "nirs4all will be installed",
      "1 recommended missing",
      "1 older than recommended",
    ]);
    expect(labels({
      required: [requiredPackage({ installedVersion: "1.4.12", status: "out_of_range" })],
      recommended: [
        recommendedPackage({ name: "a", status: "missing" }),
        recommendedPackage({ name: "b", status: "missing" }),
        recommendedPackage({ name: "c", status: "missing" }),
        recommendedPackage({ name: "d", status: "older" }),
        recommendedPackage({ name: "e", status: "older" }),
      ],
    })).toEqual(["nirs4all 1.4.12 → 1.4.16", "3 recommended missing", "2 older than recommended"]);
  });

  it("counts other required packages only when nirs4all itself is in range", () => {
    expect(labels({
      required: [
        requiredPackage(),
        requiredPackage({ name: "dag-ml", installedVersion: "0.3.0", status: "out_of_range" }),
        requiredPackage({ name: "nirs4all-io", installedVersion: null, status: "missing" }),
      ],
      recommended: [],
    })).toEqual(["2 required packages will be updated"]);
  });

  it("marks a ready environment and a read-only one", () => {
    expect(labels({ recommended: [] })).toEqual(["ready to use"]);
    const readOnly = envReport({
      writable: false,
      required: [requiredPackage({ installedVersion: "1.4.12", status: "out_of_range" })],
      recommended: [],
    });
    expect(describeEnvironment(readOnly, t)).toEqual([
      { id: "required", tone: "problem", label: "nirs4all 1.4.12 is not supported" },
      { id: "read-only", tone: "neutral", label: "read-only" },
    ]);
    expect(canUseEnvironment(readOnly)).toBe(false);
    expect(canUseEnvironment(envReport({ writable: false }))).toBe(true);
  });

  it("never offers to modify a development install", () => {
    const editable = envReport({ required: [requiredPackage({ installedVersion: "1.5.0.dev0", status: "editable" })], recommended: [] });
    expect(describeEnvironment(editable, t)).toEqual([
      { id: "editable:nirs4all", tone: "problem", label: "nirs4all 1.5.0.dev0 is a development install" },
    ]);
    expect(canUseEnvironment(editable)).toBe(false);
  });
});

describe("package preselection and the primary action", () => {
  it("preselects the default packages for a new environment only", () => {
    const source = envReport();
    const plan = newEnvPlan();
    // tabpfn is a default package the planned Python version does not support.
    expect(initialPackageSelection({ type: "new", plan })).toEqual(["xgboost", "torch"]);
    expect(initialPackageSelection({ type: "existing", report: source })).toEqual([]);
    expect(initialPackageSelection({ type: "current", report: source })).toEqual([]);
    expect(initialPackageSelection({ type: "new", plan: null })).toEqual([]);
    expect(packageListing({ type: "new", plan })).toEqual({ ...plan, writable: true });
    expect(packageListing({ type: "new", plan: null })).toBeNull();
    expect(packageListing({ type: "current", report: source })).toBe(source);
  });

  it("derives one action from the target and the ticked packages", () => {
    const report = envReport();
    expect(primaryActionKind(null, 0)).toBe("choose");
    expect(primaryActionKind({ type: "new", plan: null }, 0)).toBe("create");
    expect(primaryActionKind({ type: "existing", report }, 0)).toBe("use");
    expect(primaryActionKind({ type: "existing", report }, 3)).toBe("installAndUse");
    expect(primaryActionKind({ type: "current", report }, 2)).toBe("install");
    expect(primaryActionKind({ type: "current", report }, 0)).toBe("nothing");
    const unusableReadOnly = envReport({ writable: false, required: [requiredPackage({ installedVersion: null, status: "missing" })] });
    expect(primaryActionKind({ type: "existing", report: unusableReadOnly }, 0)).toBe("blocked");
  });
});
