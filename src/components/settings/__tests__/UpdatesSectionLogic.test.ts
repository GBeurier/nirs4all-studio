/**
 * @vitest-environment jsdom
 */

import i18n from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

import "@/lib/i18n";
import type { UpdateStatus } from "@/api/updates";
import {
  canApplyWebappUpdateInPlace,
  getInstallerUrl,
  getWebappDialogCopy as getWebappDialogCopyWithT,
  getWebappUpdateRowState as getWebappUpdateRowStateWithT,
} from "../UpdatesSectionLogic";

// Real English resources: the logic helpers receive the i18n `t` function.
const t = i18n.t.bind(i18n);
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
const getWebappDialogCopy = (args: Omit<Parameters<typeof getWebappDialogCopyWithT>[0], "t">) =>
  getWebappDialogCopyWithT({ ...args, t });
const getWebappUpdateRowState = (args: Omit<Parameters<typeof getWebappUpdateRowStateWithT>[0], "t">) =>
  getWebappUpdateRowStateWithT({ ...args, t });

type StatusOverrides = Omit<Partial<UpdateStatus>, "webapp"> & {
  webapp?: Partial<UpdateStatus["webapp"]>;
};

function createStatus(overrides: StatusOverrides = {}): UpdateStatus {
  const { webapp, ...statusOverrides } = overrides;

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
    ...statusOverrides,
  };
}

describe("UpdatesSectionLogic", () => {
  it("resolves the installer link and the installer capability", () => {
    const status = createStatus({
      webapp: { update_available: true, latest_version: "1.1.0" },
    });

    expect(getInstallerUrl(status)).toBe("https://example.test/releases/latest");
    expect(getInstallerUrl(createStatus({ webapp: { installer_download_url: "https://example.test/app.exe" } }))).toBe(
      "https://example.test/app.exe",
    );
    expect(canApplyWebappUpdateInPlace(createStatus())).toBe(true);
    expect(
      canApplyWebappUpdateInPlace(
        createStatus({
          update_capability: {
            can_apply_in_place: false,
            channel: "installer",
            reason: "packaged installer",
            install_kind: "deb",
          },
        }),
      ),
    ).toBe(false);
  });

  it("keeps webapp row actions mutually exclusive", () => {
    const updateAvailable = createStatus({
      webapp: { update_available: true, latest_version: "1.1.0", is_prerelease: true },
    });
    const installerOnly = createStatus({
      webapp: { update_available: true, latest_version: "1.1.0" },
      update_capability: {
        can_apply_in_place: false,
        channel: "installer",
        reason: "native package",
        install_kind: "appimage",
      },
    });
    const idleDownload = { isDownloading: false, downloadProgress: 0, readyToApply: false };

    expect(
      getWebappUpdateRowState({
        status: updateAvailable,
        stagedUpdate: undefined,
        download: { isDownloading: true, downloadProgress: 42.6, readyToApply: false },
      }),
    ).toMatchObject({
      action: "downloading",
      downloadProgressPercent: 43,
      isPrerelease: true,
    });

    expect(
      getWebappUpdateRowState({
        status: createStatus(),
        stagedUpdate: { has_staged_update: true, version: "1.0.1" },
        download: idleDownload,
      }),
    ).toMatchObject({
      action: "apply",
      showTargetVersion: true,
      targetVersion: "1.0.1",
    });

    expect(
      getWebappUpdateRowState({
        status: updateAvailable,
        stagedUpdate: undefined,
        download: idleDownload,
      }).action,
    ).toBe("update");
    expect(
      getWebappUpdateRowState({
        status: installerOnly,
        stagedUpdate: undefined,
        download: idleDownload,
      }).action,
    ).toBe("installer");
    expect(
      getWebappUpdateRowState({
        status: createStatus(),
        stagedUpdate: undefined,
        download: idleDownload,
      }).action,
    ).toBe("up-to-date");
  });

  it("preserves the installer-only stale staged-update state with no CTA", () => {
    const state = getWebappUpdateRowState({
      status: createStatus({
        update_capability: {
          can_apply_in_place: false,
          channel: "installer",
          reason: "native package",
          install_kind: "dmg",
        },
      }),
      stagedUpdate: { has_staged_update: true, version: "1.0.1" },
      download: { isDownloading: false, downloadProgress: 0, readyToApply: false },
    });

    expect(state.action).toBeNull();
    expect(state.showTargetVersion).toBe(true);
    expect(state.targetVersion).toBe("1.0.1");
  });

  it("derives webapp dialog copy from download state", () => {
    expect(
      getWebappDialogCopy({
        download: {
          downloadMessage: "Downloading archive",
          isDownloading: true,
          readyToApply: true,
          stagedVersion: "1.1.0",
        },
        latestVersion: "1.2.0",
      }),
    ).toEqual({
      title: "Update Ready to Apply",
      description: "Version 1.1.0 is ready to install",
    });
    expect(
      getWebappDialogCopy({
        download: {
          downloadMessage: "",
          isDownloading: true,
          readyToApply: false,
        },
        latestVersion: "1.2.0",
      }),
    ).toEqual({
      title: "Downloading Update...",
      description: "Downloading...",
    });
    expect(
      getWebappDialogCopy({
        download: {
          downloadMessage: "",
          isDownloading: false,
          readyToApply: false,
        },
        latestVersion: "1.2.0",
      }),
    ).toEqual({
      title: "Webapp Update Available",
      description: "Version 1.2.0 is available",
    });
  });
});
