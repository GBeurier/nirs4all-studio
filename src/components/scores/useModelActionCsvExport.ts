import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useApiErrorToast } from "@/hooks/useApiErrorToast";
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
  const { t } = useTranslation();
  const notifyApiError = useApiErrorToast();
  const [csvBusy, setCsvBusy] = useState(false);

  const handleCsvExport = useCallback(async () => {
    if (!chainId) {
      toast.error(t("results.scores.csv.missingChain"));
      return;
    }
    setCsvBusy(true);
    try {
      const detail = await getChainPartitionDetail(chainId);
      const rows = detail.predictions || [];
      if (rows.length === 0) {
        toast.error(t("results.scores.csv.noPredictions"));
        return;
      }
      const csv = buildModelActionCsv(rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      downloadBlob(blob, buildModelActionCsvFilename(modelName, chainId));
      toast.success(t("results.scores.csv.exported"));
    } catch (err) {
      notifyApiError(err, t("errors.action.exportCsv"));
    } finally {
      setCsvBusy(false);
    }
  }, [chainId, modelName, t, notifyApiError]);

  return {
    csvBusy,
    handleCsvExport,
  };
}
