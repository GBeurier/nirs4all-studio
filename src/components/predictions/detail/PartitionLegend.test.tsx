import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PartitionLegend } from "./PartitionLegend";

it("uses the same configured colors as the prediction chart", () => {
  const html = renderToStaticMarkup(<PartitionLegend partitions={[{ partition: "train" }, { partition: "test" }]}
    config={{ palette: "custom", partitionColors: { train: "#e41a1c", val: "#333333", test: "#4daf4a" } }} />);
  expect(html).toContain("background-color:#e41a1c");
  expect(html).toContain("background-color:#4daf4a");
});
