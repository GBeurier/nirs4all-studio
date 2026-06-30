import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getChainPartitionDetail } from "@/api/aggregatedPredictions";
import {
  buildModelActionCsv,
  buildModelActionCsvFilename,
} from "@/lib/modelActionMenuData";

interface UseModelActionCsvExportInput {
  chainId: string;
  modelName: string;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function useModelActionCsvExport({
  chainId,
  modelName,
}: UseModelActionCsvExportInput) {
  const [csvBusy, setCsvBusy] = useState(false);

  const handleCsvExport = useCallback(async () => {
    if (!chainId) {
      toast.error("Missing chain id");
      return;
    }
    setCsvBusy(true);
    try {
      const detail = await getChainPartitionDetail(chainId);
      const rows = detail.predictions || [];
      if (rows.length === 0) {
        toast.error("No predictions found for this chain");
        return;
      }
      const csv = buildModelActionCsv(rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      downloadBlob(blob, buildModelActionCsvFilename(modelName, chainId));
      toast.success("CSV exported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "CSV export failed");
    } finally {
      setCsvBusy(false);
    }
  }, [chainId, modelName]);

  return {
    csvBusy,
    handleCsvExport,
  };
}
