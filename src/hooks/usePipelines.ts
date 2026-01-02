/**
 * Hook for managing pipelines (CRUD operations)
 * Phase 6: Pipelines Library
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { api } from "@/api/client";
import type {
  Pipeline,
  PipelinePreset,
  PipelineOperators,
  PipelineListResponse,
  PipelinePresetsResponse,
  PipelineApiResponse,
  PipelineCategory,
  ViewMode,
  SortBy,
  FilterTab,
} from "@/types/pipelines";

interface UsePipelinesOptions {
  autoFetch?: boolean;
}

export function usePipelines(options: UsePipelinesOptions = {}) {
  const { autoFetch = true } = options;

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [presets, setPresets] = useState<PipelinePreset[]>([]);
  const [operators, setOperators] = useState<PipelineOperators | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter and view state
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [sortBy, setSortBy] = useState<SortBy>("lastModified");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  // Fetch pipelines
  const fetchPipelines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<PipelineListResponse>("/pipelines");
      const formattedPipelines: Pipeline[] = response.pipelines.map((p: PipelineApiResponse) => ({
        id: p.id,
        name: p.name,
        description: p.description || "",
        category: (p.category as PipelineCategory) || "user",
        steps: p.steps || [],
        isFavorite: p.is_favorite || false,
        tags: p.tags || [],
        createdAt: p.created_at || new Date().toISOString(),
        updatedAt: p.updated_at || new Date().toISOString(),
        runCount: p.run_count,
        lastRunStatus: p.last_run_status as Pipeline["lastRunStatus"] | undefined,
        lastRunDate: p.last_run_date,
        taskType: p.task_type as Pipeline["taskType"] | undefined,
      }));
      setPipelines(formattedPipelines);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch pipelines");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch presets
  const fetchPresets = useCallback(async () => {
    try {
      const response = await api.get<PipelinePresetsResponse>("/pipelines/presets");
      setPresets(response.presets);
    } catch (err) {
      console.error("Failed to fetch presets:", err);
    }
  }, []);

  // Fetch operators
  const fetchOperators = useCallback(async () => {
    try {
      const response = await api.get<{ operators: PipelineOperators }>("/pipelines/operators");
      setOperators(response.operators);
    } catch (err) {
      console.error("Failed to fetch operators:", err);
    }
  }, []);

  // Auto-fetch on mount
  useEffect(() => {
    if (autoFetch) {
      fetchPipelines();
      fetchPresets();
    }
  }, [autoFetch, fetchPipelines, fetchPresets]);

  // Create pipeline
  const createPipeline = useCallback(async (
    data: Partial<Pipeline>
  ): Promise<Pipeline | null> => {
    try {
      const response = await api.post<{ success: boolean; pipeline: Pipeline }>("/pipelines", {
        name: data.name,
        description: data.description,
        steps: data.steps || [],
        category: data.category || "user",
        task_type: data.taskType,
      });

      if (response.success) {
        await fetchPipelines();
        return response.pipeline;
      }
      return null;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create pipeline");
      return null;
    }
  }, [fetchPipelines]);

  // Create from preset
  const createFromPreset = useCallback(async (
    presetId: string,
    name?: string
  ): Promise<Pipeline | null> => {
    try {
      const response = await api.post<{ success: boolean; pipeline: Pipeline }>(
        `/pipelines/from-preset/${presetId}`,
        { name }
      );

      if (response.success) {
        await fetchPipelines();
        return response.pipeline;
      }
      return null;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create pipeline from preset");
      return null;
    }
  }, [fetchPipelines]);

  // Update pipeline
  const updatePipeline = useCallback(async (
    id: string,
    data: Partial<Pipeline>
  ): Promise<boolean> => {
    try {
      const response = await api.put<{ success: boolean }>(`/pipelines/${id}`, {
        name: data.name,
        description: data.description,
        steps: data.steps,
        is_favorite: data.isFavorite,
        task_type: data.taskType,
      });

      if (response.success) {
        await fetchPipelines();
        return true;
      }
      return false;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update pipeline");
      return false;
    }
  }, [fetchPipelines]);

  // Delete pipeline
  const deletePipeline = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await api.delete<{ success: boolean }>(`/pipelines/${id}`);

      if (response.success) {
        setPipelines(prev => prev.filter(p => p.id !== id));
        return true;
      }
      return false;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete pipeline");
      return false;
    }
  }, []);

  // Clone pipeline
  const clonePipeline = useCallback(async (
    id: string,
    newName?: string
  ): Promise<Pipeline | null> => {
    try {
      const response = await api.post<{ success: boolean; pipeline: Pipeline }>(
        `/pipelines/${id}/clone`,
        { new_name: newName }
      );

      if (response.success) {
        await fetchPipelines();
        return response.pipeline;
      }
      return null;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clone pipeline");
      return null;
    }
  }, [fetchPipelines]);

  // Toggle favorite
  const toggleFavorite = useCallback(async (id: string): Promise<boolean> => {
    const pipeline = pipelines.find(p => p.id === id);
    if (!pipeline) return false;

    // Optimistic update
    setPipelines(prev =>
      prev.map(p => p.id === id ? { ...p, isFavorite: !p.isFavorite } : p)
    );

    try {
      const response = await api.put<{ success: boolean }>(`/pipelines/${id}`, {
        is_favorite: !pipeline.isFavorite,
      });

      if (!response.success) {
        // Revert on failure
        setPipelines(prev =>
          prev.map(p => p.id === id ? { ...p, isFavorite: pipeline.isFavorite } : p)
        );
        return false;
      }
      return true;
    } catch (err) {
      // Revert on error
      setPipelines(prev =>
        prev.map(p => p.id === id ? { ...p, isFavorite: pipeline.isFavorite } : p)
      );
      setError(err instanceof Error ? err.message : "Failed to toggle favorite");
      return false;
    }
  }, [pipelines]);

  // Export pipeline to JSON
  const exportPipeline = useCallback((id: string): string | null => {
    const pipeline = pipelines.find(p => p.id === id);
    if (!pipeline) return null;

    return JSON.stringify(pipeline, null, 2);
  }, [pipelines]);

  // Import pipeline from JSON
  const importPipeline = useCallback(async (jsonString: string): Promise<Pipeline | null> => {
    try {
      const data = JSON.parse(jsonString) as Partial<Pipeline>;

      // Create new pipeline from imported data
      return await createPipeline({
        name: data.name ? `${data.name} (Imported)` : "Imported Pipeline",
        description: data.description,
        steps: data.steps || [],
        category: "user",
        taskType: data.taskType,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import pipeline");
      return null;
    }
  }, [createPipeline]);

  // Filtered and sorted pipelines
  const filteredPipelines = useMemo(() => {
    let result = pipelines.filter((p) => {
      const matchesSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;

      switch (activeTab) {
        case "favorites": return p.isFavorite;
        case "user": return p.category === "user";
        case "preset": return p.category === "preset";
        case "shared": return p.category === "shared";
        case "history": return (p.runCount ?? 0) > 0;
        default: return true;
      }
    });

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case "name": return a.name.localeCompare(b.name);
        case "runCount": return (b.runCount ?? 0) - (a.runCount ?? 0);
        case "steps": return b.steps.length - a.steps.length;
        case "lastModified":
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });

    return result;
  }, [pipelines, searchQuery, activeTab, sortBy]);

  // Stats
  const stats = useMemo(() => ({
    total: pipelines.length,
    favorites: pipelines.filter((p) => p.isFavorite).length,
    user: pipelines.filter((p) => p.category === "user").length,
    presets: pipelines.filter((p) => p.category === "preset").length,
    shared: pipelines.filter((p) => p.category === "shared").length,
    withRuns: pipelines.filter((p) => (p.runCount ?? 0) > 0).length,
  }), [pipelines]);

  return {
    // Data
    pipelines,
    filteredPipelines,
    presets,
    operators,
    stats,
    loading,
    error,

    // Filter and view state
    searchQuery,
    setSearchQuery,
    activeTab,
    setActiveTab,
    sortBy,
    setSortBy,
    viewMode,
    setViewMode,

    // Actions
    fetchPipelines,
    fetchPresets,
    fetchOperators,
    createPipeline,
    createFromPreset,
    updatePipeline,
    deletePipeline,
    clonePipeline,
    toggleFavorite,
    exportPipeline,
    importPipeline,
  };
}
