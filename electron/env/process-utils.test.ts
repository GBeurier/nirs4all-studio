// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runCommand } from "./process-utils";
import { getInstallLog } from "./install-log";

describe("installation subprocess output", () => {
  it("drains more than pipe capacity on stdout and stderr, including UTF-8 and carriage returns", async () => {
    await runCommand(process.execPath, ["-e", `
      process.stdout.write('x'.repeat(8 * 1024 * 1024) + '\\n');
      process.stderr.write('download progress\\r');
      process.stdout.write(Buffer.from([0xc3]));
      setTimeout(() => process.stdout.write(Buffer.from([0xa9, 10])), 20);
    `], { timeoutMs: 3000 });
    const log = getInstallLog();
    expect(log.status).toBe("complete");
    expect(log.lines.some(line => line.text === "é")).toBe(true);
    expect(log.lines.some(line => line.text === "download progress")).toBe(true);
    expect(log.lines.map(line => line.text).join("").length).toBeLessThanOrEqual(64000);
  });

  it("times out a silent process independently of output", async () => {
    const start = Date.now();
    await expect(runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 100 })).rejects.toThrow("timed out");
    expect(Date.now() - start).toBeLessThan(2000);
    expect(getInstallLog().status).toBe("error");
  });

  it("retains the error and redacts private-index credentials before history and error text", async () => {
    await expect(runCommand(process.execPath, ["-e", `process.stderr.write('https://user:private_password@example.test/simple?token=private_token\\n'); process.exit(7);`]))
      .rejects.toThrow("code 7");
    const text = JSON.stringify(getInstallLog());
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("private_password");
    expect(text).not.toContain("private_token");
    expect(getInstallLog().status).toBe("error");
  });
});
