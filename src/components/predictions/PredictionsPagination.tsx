import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200] as const;

interface PredictionsPaginationProps {
  startIndex: number;
  endIndex: number;
  totalCount: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  pageSizeOptions?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export function PredictionsPagination({
  startIndex,
  endIndex,
  totalCount,
  currentPage,
  totalPages,
  pageSize,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onPageChange,
  onPageSizeChange,
}: PredictionsPaginationProps) {
  const { t } = useTranslation();
  if (totalCount <= 0) return null;

  const isFirstPage = currentPage <= 1;
  const isLastPage = currentPage >= totalPages;

  return (
    <div className="flex flex-col gap-2 px-1 text-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>
          {t("predictions.pagination.showing", { start: startIndex + 1, end: endIndex, total: totalCount })}
        </span>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => onPageSizeChange(Number(value))}
        >
          <SelectTrigger aria-label={t("predictions.pagination.rowsPerPage")} className="h-7 w-[85px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {t("predictions.pagination.perPage", { size })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-0.5">
        <Button
          aria-label={t("predictions.pagination.first")}
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => onPageChange(1)}
          disabled={isFirstPage}
        >
          <ChevronsLeft aria-hidden="true" className="h-3.5 w-3.5" />
        </Button>
        <Button
          aria-label={t("predictions.pagination.previous")}
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={isFirstPage}
        >
          <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
        </Button>
        <span className="px-2 text-muted-foreground">
          {t("predictions.pagination.pageOf", { page: currentPage, total: totalPages })}
        </span>
        <Button
          aria-label={t("predictions.pagination.next")}
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={isLastPage}
        >
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Button>
        <Button
          aria-label={t("predictions.pagination.last")}
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => onPageChange(totalPages)}
          disabled={isLastPage}
        >
          <ChevronsRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
