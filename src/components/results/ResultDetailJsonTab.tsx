import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";

interface ResultDetailJsonTabProps {
  pipelineJson: string;
  copied: boolean;
  onCopyJson: () => void;
}

export function ResultDetailJsonTab({
  pipelineJson,
  copied,
  onCopyJson,
}: ResultDetailJsonTabProps) {
  return (
    <TabsContent value="json" className="m-0 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Pipeline Configuration</span>
        <Button variant="outline" size="sm" onClick={onCopyJson}>
          {copied ? (
            <Check className="h-3.5 w-3.5 mr-1.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5 mr-1.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <div className="rounded-lg border bg-muted/20 p-4 font-mono text-xs max-h-96 overflow-auto">
        <pre className="whitespace-pre-wrap break-words text-muted-foreground">
          {pipelineJson}
        </pre>
      </div>
    </TabsContent>
  );
}
