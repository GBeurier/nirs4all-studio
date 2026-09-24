import type { BrowserWindow, Session } from "electron";

/** Match the actual Studio document, not arbitrary pages in the same window. */
export function isStudioDocument(candidate: string, entrypoint: string): boolean {
  try {
    const document = new URL(candidate);
    const application = new URL(entrypoint);
    if (document.username || document.password) return false;
    if (application.protocol === "file:") {
      return document.protocol === "file:" && document.host === application.host &&
        document.pathname === application.pathname;
    }
    return (application.protocol === "http:" || application.protocol === "https:") &&
      document.origin === application.origin;
  } catch {
    return false;
  }
}

/** Install the credential injector once, before the Studio document is loaded. */
export function installNativeSessionAuth(
  session: Session,
  currentWindow: () => BrowserWindow | null,
  entrypoint: string,
  sessionHeaders: (url: string) => Record<string, string>,
): void {
  let smokeDiagnosticsRemaining = 4;
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "x-nirs4all-session") delete headers[key];
    }
    const window = currentWindow();
    // Electron leaves both the numeric ID and frame metadata optional. On
    // Windows file: renderers, use whichever ownership metadata it supplies,
    // while still requiring the current main document to be Studio.
    const mainDocumentIsStudio = Boolean(window &&
      isStudioDocument(window.webContents.getURL(), entrypoint));
    const sameMainFrame = Boolean(window && details.frame &&
      details.frame.processId === window.webContents.mainFrame.processId &&
      details.frame.routingId === window.webContents.mainFrame.routingId);
    const hasNumericOwner = details.webContentsId !== undefined && details.webContentsId !== 0;
    const hasOwner = hasNumericOwner || details.webContents !== undefined || sameMainFrame;
    const ownerMatches = Boolean(window && hasOwner &&
      (!hasNumericOwner || details.webContentsId === window.webContents.id) &&
      (details.webContents === undefined || details.webContents.id === window.webContents.id));
    const frameMatches = !details.frame || isStudioDocument(details.frame.url, entrypoint) ||
      (details.frame.parent === null && mainDocumentIsStudio);
    if (ownerMatches && mainDocumentIsStudio && frameMatches) {
      Object.assign(headers, sessionHeaders(details.url));
    }
    if (process.env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN &&
        smokeDiagnosticsRemaining > 0 && /\/api\//.test(details.url) &&
        !Object.keys(headers).some(key => key.toLowerCase() === "x-nirs4all-session")) {
      smokeDiagnosticsRemaining -= 1;
      // Test-only metadata: never print the credential or request URL.
      console.error("Native session authentication skipped", {
        hasOwner, ownerMatches, sameMainFrame, mainDocumentIsStudio, frameMatches,
        hasFrame: Boolean(details.frame), resourceType: details.resourceType,
        sidecarRecognized: Boolean(Object.keys(sessionHeaders(details.url)).length),
      });
    }
    callback({ requestHeaders: headers });
  });
}
