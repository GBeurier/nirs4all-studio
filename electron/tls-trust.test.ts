import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { createRequire } from "node:module";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { downloadFile } from "./env/python-runtime-installer";
import { loadNetworkTrust } from "./env/external-config";

const require = createRequire(import.meta.url);
const cli = require("../scripts/setup-python-env.cjs") as {
  downloadFile(url: string, destination: string, options?: object): Promise<void>;
};
const trust = loadNetworkTrust();
let directory: string;
let certificate: string;
let key: string;
const servers: https.Server[] = [];

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-tls-"));
  const keyPath = path.join(directory, "server.key");
  const certificatePath = path.join(directory, "server.crt");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", keyPath, "-out", certificatePath, "-subj", "/CN=localhost",
    "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { stdio: "ignore" });
  key = fs.readFileSync(keyPath, "utf8");
  certificate = fs.readFileSync(certificatePath, "utf8");
  return () => fs.rmSync(directory, { recursive: true, force: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

async function serve(): Promise<string> {
  const server = https.createServer({ key, cert: certificate }, (_request, response) => response.end("verified runtime"));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address");
  return `https://127.0.0.1:${address.port}/runtime`;
}

describe.each([
  { name: "Electron", download: (url: string, destination: string) => downloadFile(url, destination, undefined, { retries: 0 }) },
  { name: "installer", download: (url: string, destination: string) => cli.downloadFile(url, destination, { retries: 0 }) },
])("$name trusted downloads", ({ download }) => {
  it("accepts a CA trusted by the operating system and retains the default CAs", async () => {
    const bundled = [...tls.rootCertificates];
    vi.spyOn(tls, "getCACertificates").mockImplementation(type => type === "system" ? [certificate] : bundled);
    const options = trust.tlsRequestOptions();
    expect(options.ca).toContain(certificate);
    expect(options.ca).toContain(bundled[0]);
    const destination = path.join(directory, `trusted-${Math.random()}`);
    await download(await serve(), destination);
    expect(fs.readFileSync(destination, "utf8")).toBe("verified runtime");
  });

  it("rejects untrusted certificates while preserving the existing environment cache", async () => {
    vi.spyOn(tls, "getCACertificates").mockImplementation(() => [...tls.rootCertificates]);
    const destination = path.join(directory, `untrusted-${Math.random()}`);
    fs.writeFileSync(destination, "previous verified runtime");
    await expect(download(await serve(), destination)).rejects.toThrow("trusted certificates");
    expect(fs.readFileSync(destination, "utf8")).toBe("previous verified runtime");
    expect(fs.readdirSync(directory).some(name => name.endsWith(".partial"))).toBe(false);
  });
});

it("preserves unrelated errors instead of misclassifying them as certificates", () => {
  const error = new Error("Disk full");
  expect(trust.explainNetworkError(error)).toBe(error);
});
