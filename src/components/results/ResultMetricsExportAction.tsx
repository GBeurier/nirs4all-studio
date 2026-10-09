import { useTranslation } from "react-i18next";
import { NativeResultsExportAffordance } from "@/components/runtime";
import {
  getResultExportModelDescription,
  getResultExportModelLabel,
} from "./resultDetailData";

interface ResultMetricsExportActionProps {
  hasRefit: boolean | undefined;
  hasNativeResults?: boolean;
  nativeArtifactCount?: number;
}

export function ResultMetricsExportAction({
  hasRefit,
  hasNativeResults,
  nativeArtifactCount,
}: ResultMetricsExportActionProps) {
  const { t } = useTranslation();
  const description = getResultExportModelDescription(hasRefit, t);

  return (
    <NativeResultsExportAffordance
      hasRefit={hasRefit}
      hasNativeResults={hasNativeResults}
      nativeArtifactCount={nativeArtifactCount}
      exportLabel={getResultExportModelLabel(hasRefit, t)}
      exportDescription={description}
    />
  );
}
