import { describe, expect, it } from "vitest";
import { installNativeSessionAuth, isStudioDocument } from "./native-session-auth";
import type { BrowserWindow, Session } from "electron";

describe("native session document identity", () => {
  it("accepts packaged router hashes without trusting unrelated file origins", () => {
    const entry = "file:///opt/Studio%20App/dist/index.html";
    expect(isStudioDocument(`${entry}#/datasets`, entry)).toBe(true);
    expect(isStudioDocument("file:///tmp/untrusted.html", entry)).toBe(false);
    expect(isStudioDocument("https://untrusted.example/", entry)).toBe(false);
  });
  it("binds development routes to the exact configured origin", () => {
    const entry = "http://localhost:5173";
    expect(isStudioDocument(`${entry}/runs`, entry)).toBe(true);
    for (const url of ["http://localhost:5174", "http://localhost.attacker:5173", "http://user@localhost:5173", "null", "invalid"]) {
      expect(isStudioDocument(url, entry)).toBe(false);
    }
  });
});

describe("native session credential injection", () => {
  it("authenticates Windows renderer fetches whose frame URL is omitted", () => {
    const entry = "file:///C:/Studio/resources/app.asar/dist/index.html";
    let listener: (details: {
      requestHeaders: Record<string, string>;
      webContentsId: number;
      frame?: { url: string };
    }, callback: (result: { requestHeaders: Record<string, string> }) => void) => void = () => {};
    const session = { webRequest: { onBeforeSendHeaders: (handler: typeof listener) => { listener = handler; } } } as unknown as Session;
    const window = { webContents: { id: 7, getURL: () => `${entry}#/datasets` } } as unknown as BrowserWindow;
    installNativeSessionAuth(session, () => window, entry, () => ({ "X-Nirs4all-Session": "private" }));
    const headersFor = (details: Record<string, unknown>) => {
      let headers: Record<string, string> = {};
      listener({ requestHeaders: {}, webContentsId: 7, ...details }, result => { headers = result.requestHeaders; });
      return headers;
    };
    expect(headersFor({ frame: undefined })).toEqual({ "X-Nirs4all-Session": "private" });
    expect(headersFor({ frame: { url: "file:///C:/untrusted.html" } })).toEqual({});
    expect(headersFor({ frame: undefined, webContentsId: 8 })).toEqual({});
  });
});
