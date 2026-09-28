import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MultimodalDatasetSummary } from "@/lib/multimodalDatasetSummary";

/** Read-only inspection of the declared sources and missing-source masks. */
export function MultimodalDatasetOverview({ summary }: { summary: MultimodalDatasetSummary }) {
  const partitions = Object.entries(summary.partitions)
    .map(([name, count]) => `${name}: ${count}`)
    .join(" · ");
  return (
    <Card>
      <CardHeader><CardTitle>Multimodal cohort</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p>{summary.samples} samples · {summary.sources.length} sources · {summary.alignment} alignment</p>
        <p>Task: {summary.task ?? "unspecified"} · Targets: {summary.targets.join(", ") || "none"}</p>
        <p>Partitions: {partitions || "none declared"}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">Sources and sample presence</caption>
            <thead><tr className="border-b"><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Representation</th><th className="py-2 pr-3">Shape</th><th className="py-2 pr-3">Present</th><th className="py-2">Missing</th></tr></thead>
            <tbody>{summary.sources.map((source) => <tr key={source.name} className="border-b last:border-0">
              <th scope="row" className="py-2 pr-3 font-medium">{source.name}</th>
              <td className="py-2 pr-3">{source.representation}</td>
              <td className="py-2 pr-3">{source.ragged ? "packed " : ""}{source.shape.join(" × ")}</td>
              <td className="py-2 pr-3">{source.present}</td>
              <td className="py-2">{source.missing}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
