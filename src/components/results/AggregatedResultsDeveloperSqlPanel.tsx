import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface AggregatedSqlQueryResult {
  columns: string[];
  rows: unknown[][];
  row_count: number;
}

interface AggregatedResultsDeveloperSqlPanelProps {
  sql: string;
  onSqlChange: (sql: string) => void;
  loading: boolean;
  error: string | null;
  result: AggregatedSqlQueryResult | null;
  onRun: () => void;
}

export function AggregatedResultsDeveloperSqlPanel({
  sql,
  onSqlChange,
  loading,
  error,
  result,
  onRun,
}: AggregatedResultsDeveloperSqlPanelProps) {
  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <div className="text-sm font-medium">Developer SQL Query</div>
        <p className="text-xs text-muted-foreground">
          Read-only SQL against prediction metadata (SQLite tables/views).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={sql}
          onChange={(event) => onSqlChange(event.target.value)}
          className="font-mono text-xs min-h-[100px]"
        />
        <div className="flex items-center gap-2">
          <Button onClick={onRun} disabled={loading}>
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Running...
              </>
            ) : (
              "Run Query"
            )}
          </Button>
          {result && (
            <span className="text-xs text-muted-foreground">
              {result.row_count} rows
            </span>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && result.columns.length > 0 && (
          <div className="max-h-56 overflow-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  {result.columns.map((column) => (
                    <TableHead key={column}>{column}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.slice(0, 50).map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {row.map((value, columnIndex) => (
                      <TableCell key={`${rowIndex}-${columnIndex}`} className="text-xs">
                        {String(value)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
