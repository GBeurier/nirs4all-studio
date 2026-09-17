import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadFile, type DownloadOptions } from "./env/python-runtime-installer";

const require = createRequire(import.meta.url);
const cli = require("../scripts/setup-python-env.cjs") as {
  downloadFile(url: string, destination: string, options?: DownloadOptions): Promise<void>;
};
const implementations = [
  { name: "Electron provisioning", download: (url: string, destination: string, options: DownloadOptions) => downloadFile(url, destination, undefined, options) },
  { name: "release setup", download: cli.downloadFile },
];
let server: http.Server;
let directory: string;
let destination: string;

async function listen(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a loopback TCP server");
  return `http://127.0.0.1:${address.port}`;
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-runtime-download-"));
  destination = path.join(directory, "runtime.tar.gz");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe.each(implementations)("$name downloads", ({ download }) => {
  const fast: DownloadOptions = { retries: 0, timeoutMs: 100, maxDurationMs: 2000, retryDelayMs: 0 };

  it("follows relative redirects and publishes a complete closed file atomically", async () => {
    fs.writeFileSync(destination, "old cache");
    const url = await listen((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: "/archive" });
        response.end();
      } else {
        response.writeHead(200, { "Content-Length": "12" });
        response.write("complete");
        expect(fs.readFileSync(destination, "utf8")).toBe("old cache");
        setTimeout(() => response.end("file"), 10);
      }
    });
    await download(`${url}/redirect`, destination, fast);
    expect(fs.readFileSync(destination, "utf8")).toBe("completefile");
    expect(fs.readdirSync(directory)).toEqual(["runtime.tar.gz"]);
  });

  it("rejects a truncated response, removes partial bytes and preserves a previous cache", async () => {
    fs.writeFileSync(destination, "old cache");
    const url = await listen((_request, response) => {
      response.writeHead(200, { "Content-Length": "100", Connection: "close" });
      response.end("truncated");
    });
    await expect(download(url, destination, fast)).rejects.toThrow();
    expect(fs.readFileSync(destination, "utf8")).toBe("old cache");
    expect(fs.readdirSync(directory)).toEqual(["runtime.tar.gz"]);
  });

  it.each([false, true])("rejects stalled responses (headers already sent: %s) and removes partials", async (sendHeaders) => {
    const url = await listen((_request, response) => {
      if (sendHeaders) {
        response.writeHead(200, { "Content-Length": "100" });
        response.write("partial");
      }
    });
    await expect(download(url, destination, { ...fast, timeoutMs: 40 })).rejects.toThrow();
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it("retries an interrupted connection from scratch and leaves only the successful file", async () => {
    let attempts = 0;
    const url = await listen((_request, response) => {
      attempts += 1;
      if (attempts === 1) {
        response.writeHead(200, { "Content-Length": "100" });
        response.write("partial");
        setImmediate(() => response.destroy());
      } else {
        response.writeHead(200, { "Content-Length": "7" });
        response.end("success");
      }
    });
    await download(url, destination, { ...fast, retries: 1 });
    expect(attempts).toBe(2);
    expect(fs.readFileSync(destination, "utf8")).toBe("success");
    expect(fs.readdirSync(directory)).toEqual(["runtime.tar.gz"]);
  });

  it("bounds redirect loops without creating a final cache entry", async () => {
    let requests = 0;
    const url = await listen((_request, response) => {
      requests += 1;
      response.writeHead(302, { Location: "/again" });
      response.end();
    });
    await expect(download(url, destination, { ...fast, maxRedirects: 2 })).rejects.toThrow("Too many download redirects");
    expect(requests).toBe(3);
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it("bounds a continuously trickling response with the overall deadline", async () => {
    const url = await listen((_request, response) => {
      response.writeHead(200);
      const timer = setInterval(() => response.write("x"), 10);
      response.on("close", () => clearInterval(timer));
    });
    await expect(download(url, destination, { ...fast, timeoutMs: 100, maxDurationMs: 55 })).rejects.toThrow();
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it("rejects HTTP failures and disk errors without hanging or publishing a file", async () => {
    const url = await listen((request, response) => {
      if (request.url === "/missing") response.writeHead(404);
      response.end("body");
    });
    await expect(download(`${url}/missing`, destination, fast)).rejects.toThrow("404");
    await expect(download(url, path.join(directory, "missing", "runtime"), fast)).rejects.toThrow();
    expect(fs.readdirSync(directory)).toEqual([]);
  });
});
