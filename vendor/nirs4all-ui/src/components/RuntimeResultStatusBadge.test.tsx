import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RuntimeResultStatusBadge } from "./RuntimeResultStatusBadge.js";

describe("RuntimeResultStatusBadge", () => {
  it("renders a host-styled runtime status with an icon map and progress", () => {
    const markup = renderToStaticMarkup(
      <RuntimeResultStatusBadge
        status="running"
        progress={42}
        icons={{ refresh: <span>spin</span> }}
        className="status"
        progressClassName="progress"
      />,
    );

    expect(markup).toContain("class=\"status\"");
    expect(markup).toContain("spin");
    expect(markup).toContain("Running");
    expect(markup).toContain("42%");
    expect(markup).toContain("class=\"progress\"");
  });

  it("uses a caller-provided status view and label", () => {
    expect(renderToStaticMarkup(
      <RuntimeResultStatusBadge
        view={{
          status: "partial",
          label: "Partial",
          colorClass: "text-amber-500",
          bgClass: "bg-amber-500/10",
          iconClass: "",
          icon: "partial",
          badgeVariant: "secondary",
          isBusy: false,
          progress: null,
        }}
        label="Partial result"
        showProgress={false}
      />,
    )).toContain("Partial result");
  });
});
