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
  const description = getResultExportModelDescription(hasRefit);

  return (
    <NativeResultsExportAffordance
      hasRefit={hasRefit}
      hasNativeResults={hasNativeResults}
      nativeArtifactCount={nativeArtifactCount}
      exportLabel={getResultExportModelLabel(hasRefit)}
      exportDescription={description}
    />
  );
}
