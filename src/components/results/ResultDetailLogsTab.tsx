import { TabsContent } from "@/components/ui/tabs";
import { ResultDetailLogsPanel } from "./ResultDetailLogsPanel";
import type { ResultLogLineData } from "./resultDetailData";

interface ResultDetailLogsTabProps {
  logRows: ResultLogLineData[];
  isRunning: boolean;
}

export function ResultDetailLogsTab({ logRows, isRunning }: ResultDetailLogsTabProps) {
  return (
    <TabsContent value="logs" className="m-0 space-y-3">
      <ResultDetailLogsPanel logRows={logRows} isRunning={isRunning} />
    </TabsContent>
  );
}
