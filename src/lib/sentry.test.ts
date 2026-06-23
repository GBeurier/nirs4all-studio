import { describe, expect, it } from "vitest";
import type { Event, EventHint } from "@sentry/react";

import { isUnhandledApiErrorRejection } from "./sentry";

const unhandledRejectionEvent: Event = {
  exception: {
    values: [
      {
        type: "UnhandledRejection",
        value: "Object captured as promise rejection with keys: detail, status",
        mechanism: { type: "onunhandledrejection", handled: false },
      },
    ],
  },
};

describe("isUnhandledApiErrorRejection", () => {
  it("drops an unawaited { detail, status } API-error rejection (via originalException)", () => {
    const hint: EventHint = { originalException: { detail: "Not found", status: 404 } };
    expect(isUnhandledApiErrorRejection(unhandledRejectionEvent, hint)).toBe(true);
  });

  it("drops it via the synthetic message fallback when originalException is absent", () => {
    expect(isUnhandledApiErrorRejection(unhandledRejectionEvent, undefined)).toBe(true);
  });

  it("keeps a genuine Error rejection even if it carries detail/status", () => {
    const err = Object.assign(new Error("boom"), { detail: "x", status: 500 });
    const hint: EventHint = { originalException: err };
    expect(isUnhandledApiErrorRejection(unhandledRejectionEvent, hint)).toBe(false);
  });

  it("keeps a handled React render error (not an unhandled rejection)", () => {
    const renderError: Event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Cannot read properties of null (reading 'num_samples')",
            mechanism: { type: "generic", handled: true },
          },
        ],
      },
    };
    const hint: EventHint = { originalException: { detail: "x", status: 400 } };
    expect(isUnhandledApiErrorRejection(renderError, hint)).toBe(false);
  });

  it("keeps an unhandled rejection that is not an API envelope", () => {
    const hint: EventHint = { originalException: new Error("network down") };
    const event: Event = {
      exception: {
        values: [
          {
            type: "Error",
            value: "network down",
            mechanism: { type: "onunhandledrejection", handled: false },
          },
        ],
      },
    };
    expect(isUnhandledApiErrorRejection(event, hint)).toBe(false);
  });
});
