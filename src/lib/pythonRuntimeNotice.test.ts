/**
 * @vitest-environment jsdom
 */

import i18n from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import "@/lib/i18n";

import type { DesktopEnvInfo } from "@/types/pythonRuntime";
import { buildPythonRuntimeNotice } from "./pythonRuntimeNotice";

const t = i18n.t.bind(i18n);
const envInfo: DesktopEnvInfo = {
  status: "ready", envDir: "/env", pythonPath: "/env/bin/python",
  sitePackages: null, pythonVersion: "3.11.9", isCustom: true,
};
const broken = { controlReady: true, mlReady: false, mlLoading: false, mlError: "executor_not_selected" };
const ready = { controlReady: true, mlReady: true, mlLoading: false, mlError: null };

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("Python runtime notice", () => {
  it("keeps a broken runtime visible after setup was deferred", () => {
    const notice = buildPythonRuntimeNotice({ ...envInfo, setupDeferred: true }, broken, t);
    expect(notice?.kind).toBe("unavailable");
    expect(notice?.title).toBe("Scientific features are unavailable");
    expect(notice?.message).not.toContain("executor_not_selected");
  });

  it("prefers the environment's own cause over the readiness reason", () => {
    const notice = buildPythonRuntimeNotice(
      { ...envInfo, setupDeferred: true, error: "nirs4all 1.0.3 is installed; 1.4.14 is required" },
      broken,
      t,
    );
    expect(notice?.message).toBe("nirs4all 1.0.3 is installed; 1.4.14 is required");
  });

  it("stays hidden while the runtime loads, once it is ready, or when the setup gate handles it", () => {
    expect(buildPythonRuntimeNotice({ ...envInfo, setupDeferred: true }, { ...broken, mlLoading: true, mlError: null }, t)).toBeNull();
    expect(buildPythonRuntimeNotice({ ...envInfo, setupDeferred: true }, ready, t)).toBeNull();
    expect(buildPythonRuntimeNotice(envInfo, broken, t)).toBeNull();
  });

  it("explains an included-runtime fallback even when analyses work", () => {
    const notice = buildPythonRuntimeNotice({
      ...envInfo,
      runtimeFallback: { reason: "missing", selectedPythonPath: "D:\\envs\\old\\python.exe", issues: [] },
    }, ready, t);
    expect(notice).toEqual({
      kind: "fallback",
      title: "Studio is using its included Python environment",
      message: "The selected environment D:\\envs\\old\\python.exe could not be found. Studio started with its included environment so analyses keep working.",
    });
  });
});
