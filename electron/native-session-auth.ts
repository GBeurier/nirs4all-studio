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
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "x-nirs4all-session") delete headers[key];
    }
    const window = currentWindow();
    // Windows can omit frame.url for renderer fetches from a file: document.
    // In that case the owning WebContents' current URL is the document we
    // already navigated and checked. A supplied frame URL remains authoritative
    // so an unrelated subframe cannot borrow the main document's credential.
    const documentUrl = details.frame?.url || window?.webContents.getURL() || "";
    if (window && details.webContentsId === window.webContents.id &&
        isStudioDocument(documentUrl, entrypoint)) {
      Object.assign(headers, sessionHeaders(details.url));
    }
    callback({ requestHeaders: headers });
  });
}
