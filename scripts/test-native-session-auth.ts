/** Real Electron -> authenticated Rust HTTP/CORS/WebSocket acceptance probe.
 * Bundle with esbuild (external electron), run with Electron, and provide
 * NIRS4ALL_NATIVE_SIDECAR_PATH pointing at the freshly compiled sidecar.
 */
import { app, BrowserWindow, session } from "electron";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NativeSidecarManager } from "../electron/native-sidecar-manager";
import { installNativeSessionAuth } from "../electron/native-session-auth";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-electron-auth-"));
process.env.NIRS4ALL_CONFIG = path.join(root, "config");
app.setPath("userData", path.join(root, "electron"));
const manager = new NativeSidecarManager();
let window: BrowserWindow | null = null;

app.whenReady().then(async () => {
  try {
    const info = await manager.start();
    assert.equal(info.status, "running");
    assert.ok(info.url);
    assert.equal((await fetch(`${info.url}/api/health`)).status, 401);
    assert.equal((await manager.authenticatedFetch(`${info.url}/api/health`)).status, 200);
    const document = path.join(root, "index.html");
    fs.writeFileSync(document, "<!doctype html><title>Native session authentication</title>");
    const entry = pathToFileURL(document).href;
    installNativeSessionAuth(session.defaultSession, () => window, entry, (url) => manager.sessionHeaders(url));
    session.defaultSession.webRequest.onSendHeaders((details) => {
      if (details.resourceType === "webSocket") console.log("WebSocket authentication evidence", {
        webContentsId: details.webContentsId, frameUrl: details.frame?.url, referrer: details.referrer, origin: details.requestHeaders.Origin,
        authenticated: Object.keys(details.requestHeaders).some((key) => key.toLowerCase() === "x-nirs4all-session"),
      });
    });
    window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    await window.loadFile(document);
    const url = JSON.stringify(info.url);
    assert.equal(await window.webContents.executeJavaScript(`fetch(${url} + '/api/health').then(r => r.status)`), 200);
    assert.equal(await window.webContents.executeJavaScript(`fetch(${url} + '/api/app/favorites', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pipeline_id:'auth-probe'})}).then(r => r.status)`), 200);
    assert.equal(await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const ws=new WebSocket(${url}.replace('http:','ws:')+'/ws');const timer=setTimeout(()=>reject(new Error('WebSocket timeout')),5000);ws.onopen=()=>{clearTimeout(timer);ws.close();resolve('connected')};ws.onerror=()=>{clearTimeout(timer);reject(new Error('WebSocket denied'))}})`), "connected");
    const untrusted = path.join(root, "untrusted.html");
    fs.writeFileSync(untrusted, "<!doctype html><title>Untrusted local file</title>");
    await window.loadFile(untrusted);
    const denied = await window.webContents.executeJavaScript(`fetch(${url} + '/api/health').then(r=>r.status).catch(()=>'blocked')`);
    // Chromium may expose the HTTP refusal or hide it behind its CORS error.
    assert.ok(denied === 401 || denied === "blocked", `Untrusted document unexpectedly received ${denied}`);
    console.log("PASS authenticated Electron HTTP, JSON POST, CORS, WebSocket; unauthenticated clients and unrelated documents refused");
    process.exitCode = 0;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    window?.destroy();
    await manager.stop();
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(process.exitCode ?? 1);
  }
});
