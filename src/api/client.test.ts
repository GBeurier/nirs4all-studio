import { describe, expect, it } from "vitest";

import { formatApiErrorDetail } from "./client";

describe("formatApiErrorDetail", () => {
  it("formats FastAPI validation arrays into readable messages", () => {
    const detail = [
      {
        type: "string_too_long",
        loc: ["body", "config", "name"],
        msg: "String should have at most 100 characters",
      },
    ];

    expect(formatApiErrorDetail(detail, 422)).toBe(
      "config.name: String should have at most 100 characters",
    );
  });

  it("passes string details through unchanged", () => {
    expect(formatApiErrorDetail("Dataset not found", 404)).toBe("Dataset not found");
  });
});
