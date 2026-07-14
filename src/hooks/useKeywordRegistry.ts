import { useQuery } from "@tanstack/react-query";
import { getKeywordRegistry } from "@/api/system";
import {
  parseKeywordRegistryDocument,
  type KeywordRegistryDocument,
} from "@/ui/keywordRegistry";

export interface UseKeywordRegistryOptions {
  enabled?: boolean;
}

export interface UseKeywordRegistryResult {
  data: KeywordRegistryDocument | null;
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
}

export function useKeywordRegistry(
  options: UseKeywordRegistryOptions = {},
): UseKeywordRegistryResult {
  const { enabled = true } = options;
  const query = useQuery({
    enabled,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => parseKeywordRegistryDocument(await getKeywordRegistry()),
    queryKey: ["system", "keyword-registry"],
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  return {
    data: query.data ?? null,
    error: query.error instanceof Error ? query.error : null,
    isError: query.isError,
    isLoading: query.isLoading,
  };
}
