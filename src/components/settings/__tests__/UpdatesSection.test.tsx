/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "i18next";

import "@/lib/i18n";

const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock("@/api/transport", () => ({ api: transport }));

import { UpdatesSection } from "../UpdatesSection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const INSTALLER_URL = "https://github.com/GBeurier/nirs4all-studio/releases/download/1.1.0/nirs4all-Studio-1.1.0-linux-amd64.deb";

function status(updateAvailable: boolean) {
  return {
    webapp: {
      current_version: "1.0.0",
      latest_version: updateAvailable ? "1.1.0" : "1.0.0",
      update_available: updateAvailable,
      release_url: "https://github.com/GBeurier/nirs4all-studio/releases/tag/1.1.0",
      release_notes: null,
      published_at: null,
      download_size_bytes: null,
      download_url: updateAvailable ? INSTALLER_URL : null,
      asset_name: null,
      checksum_sha256: null,
      is_prerelease: false,
      installer_download_url: updateAvailable ? INSTALLER_URL : null,
      installer_asset_name: null,
    },
    update_capability: { can_apply_in_place: false, channel: "installer", reason: "managed_install", install_kind: "deb" },
    last_check: null,
    check_interval_hours: 24,
  };
}

function serve(updateAvailable: boolean) {
  transport.get.mockImplementation(async (path: string) => {
    if (path === "/updates/status") return status(updateAvailable);
    if (path === "/updates/settings") return { auto_check: true, prerelease_channel: false, offline_mode: "auto" };
    if (path.startsWith("/updates/webapp/changelog")) {
      return { entries: [{ version: "1.1.0", date: null, body: "Faster dataset loading.", prerelease: false }] };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

let root: Root | null = null;

async function settled(assertion: () => void) {
  await act(async () => {
    await vi.waitFor(assertion);
  });
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root?.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <UpdatesSection />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settled(() => expect(container.textContent).toContain("Current: 1.0.0"));
  return container;
}

function button(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(label));
  if (!match) throw new Error(`No button labelled "${label}"`);
  return match;
}

const requestedPaths = () => [
  ...transport.get.mock.calls,
  ...transport.post.mock.calls,
  ...transport.put.mock.calls,
  ...transport.delete.mock.calls,
].map(([path]) => path as string);

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  delete (window as unknown as { electronApi?: unknown }).electronApi;
});

describe("UpdatesSection", () => {
  it("reads only the update status and settings when it mounts", async () => {
    serve(false);
    const container = await mount();

    expect(container.textContent).toContain("Current: 1.0.0");
    expect(container.textContent).toContain("Up to date");
    expect(requestedPaths().sort()).toEqual(["/updates/settings", "/updates/status"]);
  });

  it("shows the changelog and opens the installer download in the browser", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { electronApi?: unknown }).electronApi = { openExternal };
    serve(true);
    const container = await mount();

    expect(container.textContent).toContain("Current: 1.0.0 → 1.1.0");
    await act(async () => button("Get installer").click());
    await settled(() => expect(document.body.textContent).toContain("Faster dataset loading."));

    expect(transport.get).toHaveBeenCalledWith("/updates/webapp/changelog?current_version=1.0.0");
    expect(document.body.textContent).toContain("download it, close Studio, then run it");

    await act(async () => button("Download Installer").click());

    expect(openExternal).toHaveBeenCalledExactlyOnceWith(INSTALLER_URL);
    expect(requestedPaths().sort()).toEqual([
      "/updates/settings",
      "/updates/status",
      "/updates/webapp/changelog?current_version=1.0.0",
    ]);
  });
});
