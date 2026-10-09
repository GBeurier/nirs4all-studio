import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MultimodalDatasetSummary } from "@/lib/multimodalDatasetSummary";

/** Read-only inspection of the declared sources and missing-source masks. */
export function MultimodalDatasetOverview({ summary }: { summary: MultimodalDatasetSummary }) {
  const { t } = useTranslation();
  const partitions = Object.entries(summary.partitions)
    .map(([name, count]) => `${name}: ${count}`)
    .join(" · ");
  return (
    <Card>
      <CardHeader><CardTitle>{t("datasets.multimodal.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p>{t("datasets.multimodalImport.summary", { samples: summary.samples, sources: summary.sources.length, alignment: summary.alignment })}</p>
        <p>{t("datasets.multimodal.taskTargets", { task: summary.task ?? t("datasets.multimodal.unspecified"), targets: summary.targets.join(", ") || t("datasets.multimodal.none") })}</p>
        <p>{t("datasets.multimodal.partitions", { partitions: partitions || t("datasets.multimodal.noneDeclared") })}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{t("datasets.multimodal.caption")}</caption>
            <thead><tr className="border-b"><th className="py-2 pr-3">{t("datasets.multimodal.source")}</th><th className="py-2 pr-3">{t("datasets.multimodal.representation")}</th><th className="py-2 pr-3">{t("datasets.multimodal.shape")}</th><th className="py-2 pr-3">{t("datasets.multimodal.present")}</th><th className="py-2">{t("datasets.multimodal.missing")}</th></tr></thead>
            <tbody>{summary.sources.map((source) => <tr key={source.name} className="border-b last:border-0">
              <th scope="row" className="py-2 pr-3 font-medium">{source.name}</th>
              <td className="py-2 pr-3">{source.representation}</td>
              <td className="py-2 pr-3">{source.ragged ? `${t("datasets.multimodal.packed")} ` : ""}{source.shape.join(" × ")}</td>
              <td className="py-2 pr-3">{source.present}</td>
              <td className="py-2">{source.missing}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
