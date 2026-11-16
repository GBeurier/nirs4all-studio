/**
 * @vitest-environment jsdom
 */

import i18n from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

import "@/lib/i18n";
import type { UpdateStatus } from "@/api/updates";
import {
  getInstallerUrl,
  getWebappUpdateRowState as getWebappUpdateRowStateWithT,
} from "../UpdatesSectionLogic";

// Real English resources: the logic helpers receive the i18n `t` function.
const t = i18n.t.bind(i18n);
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
const getWebappUpdateRowState = (status: UpdateStatus | undefined) =>
  getWebappUpdateRowStateWithT({ status, t });

function createStatus(webapp: Partial<UpdateStatus["webapp"]> = {}): UpdateStatus {
  return {
    webapp: {
      current_version: "1.0.0",
      latest_version: "1.0.0",
      update_available: false,
      release_url: "https://example.test/releases/latest",
      release_notes: null,
      published_at: null,
      download_size_bytes: null,
      download_url: null,
      asset_name: null,
      checksum_sha256: null,
      is_prerelease: false,
      ...webapp,
    },
    last_check: null,
    check_interval_hours: 24,
  };
}

describe("UpdatesSectionLogic", () => {
  it("resolves the platform installer, then the release page", () => {
    expect(getInstallerUrl(createStatus())).toBe("https://example.test/releases/latest");
    expect(getInstallerUrl(createStatus({ installer_download_url: "https://example.test/app.exe" }))).toBe(
      "https://example.test/app.exe",
    );
    expect(getInstallerUrl(createStatus({ release_url: null }))).toBeNull();
    expect(getInstallerUrl(undefined)).toBeNull();
  });

  it("projects the installed and the newer version", () => {
    expect(getWebappUpdateRowState(createStatus())).toEqual({
      currentVersion: "1.0.0",
      hasUpdate: false,
      isPrerelease: false,
      targetVersion: "1.0.0",
    });
    expect(
      getWebappUpdateRowState(createStatus({ update_available: true, latest_version: "1.1.0", is_prerelease: true })),
    ).toEqual({
      currentVersion: "1.0.0",
      hasUpdate: true,
      isPrerelease: true,
      targetVersion: "1.1.0",
    });
    expect(getWebappUpdateRowState(undefined)).toMatchObject({ currentVersion: "unknown", hasUpdate: false });
  });
});
