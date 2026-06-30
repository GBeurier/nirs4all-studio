/**
 * GeneratorRenderer - Generator step configuration renderer
 *
 * Provides UI for configuring generator steps (_or_, _cartesian_, _grid_,
 * _zip_, _chain_, _sample_, _range_, _log_range_) with:
 * - Selection mode (pick/arrange) for _or_ and _cartesian_
 * - Pick/Arrange as single value OR range [from, to]
 * - Second-order selection (then_pick, then_arrange) for _or_
 * - Count limiter and seed
 * - Variant count preview
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { StepActions } from "./StepActions";
import type { StepRendererProps } from "./types";
import type { ScalarGeneratorEntry } from "../../types";
import { calculateGeneratorExpansionCount, calculateStepVariants } from "../../types";
import { getKindMeta } from "./GeneratorRenderer.meta";
import {
  GeneratorHeader,
  GeneratorSummary,
  LimitVariantsSection,
  SamplingConfigurationSection,
  ScalarParametersSection,
  SecondOrderSelectionSection,
  SeedSection,
  SelectionModeSection,
} from "./GeneratorRenderer.sections";
import type {
  PrimarySelectionMode,
  SecondarySelectionMode,
  SelectionConfig,
} from "./GeneratorRenderer.helpers";
import {
  addScalarEntry,
  calculatePrimarySelectionCount,
  configToOptions,
  createScalarEntryDrafts,
  extractConfig,
  getGeneratorOptionCount,
  parseJsonArrayDraft,
  removeScalarEntry,
  renameScalarEntry,
  stringifyJsonDraft,
  updateScalarEntryValues,
} from "./GeneratorRenderer.helpers";

const EMPTY_SCALAR_ENTRIES: ScalarGeneratorEntry[] = [];
const EMPTY_SAMPLE_CONFIG: Record<string, unknown> = {};

// ---------------------------------------------------------------------------
// GeneratorRenderer
// ---------------------------------------------------------------------------

export function GeneratorRenderer({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
}: StepRendererProps) {
  const generatorKind = (() => {
    if (step.generatorKind) return step.generatorKind as string;
    console.warn(
      `[GeneratorRenderer] step "${step.id}" (${step.name}) missing generatorKind, defaulting to "or"`
    );
    return "or";
  })();
  const meta = getKindMeta(generatorKind);

  const scalarEntries = step.scalarGeneratorConfig?.entries ?? EMPTY_SCALAR_ENTRIES;
  const sampleConfig = step.scalarGeneratorConfig?.sample ?? EMPTY_SAMPLE_CONFIG;
  const optionCount = getGeneratorOptionCount({
    generatorKind,
    scalarEntryCount: scalarEntries.length,
    sampleCount: Number(sampleConfig.num) || 0,
    branchCount: step.branches?.length || 0,
  });
  const selectionBaseCount = useMemo(
    () => Math.max(0, calculateGeneratorExpansionCount(step)),
    [step]
  );
  const config = useMemo(() => extractConfig(step), [step]);
  const [entryDrafts, setEntryDrafts] = useState<Record<string, string>>({});
  const [sampleChoicesDraft, setSampleChoicesDraft] = useState(
    () => stringifyJsonDraft(sampleConfig.choices ?? []),
  );

  useEffect(() => {
    setEntryDrafts(createScalarEntryDrafts(scalarEntries));
  }, [scalarEntries]);

  useEffect(() => {
    setSampleChoicesDraft(stringifyJsonDraft(sampleConfig.choices ?? []));
  }, [sampleConfig.choices]);

  const primarySelectionCount = useMemo(
    () => calculatePrimarySelectionCount(
      config,
      meta.supportsPickArrange,
      selectionBaseCount,
    ),
    [config, meta.supportsPickArrange, selectionBaseCount],
  );

  const variantCount = useMemo(
    () => calculateStepVariants(step),
    [step]
  );

  const unboundedVariantCount = useMemo(
    () => calculateStepVariants({
      ...step,
      generatorOptions: step.generatorOptions
        ? { ...step.generatorOptions, count: undefined }
        : undefined,
    }),
    [step]
  );

  const handleConfigChange = useCallback(
    (updates: Partial<SelectionConfig>) => {
      const newConfig = { ...config, ...updates };
      const updatePayload: Record<string, unknown> = {
        generatorOptions: configToOptions(newConfig),
      };
      // Persist seed in params
      if (updates.seed !== undefined) {
        updatePayload.params = { ...step.params, _seed_: updates.seed || undefined };
      }
      onUpdate(step.id, updatePayload);
    },
    [config, onUpdate, step.id, step.params]
  );

  const updateScalarEntries = useCallback(
    (entries: ScalarGeneratorEntry[]) => {
      onUpdate(step.id, {
        scalarGeneratorConfig: {
          ...step.scalarGeneratorConfig,
          entries,
        },
      });
    },
    [onUpdate, step.id, step.scalarGeneratorConfig]
  );

  const updateSampleConfig = useCallback(
    (updates: Record<string, unknown>) => {
      onUpdate(step.id, {
        scalarGeneratorConfig: {
          ...step.scalarGeneratorConfig,
          sample: {
            ...sampleConfig,
            ...updates,
          },
        },
      });
    },
    [onUpdate, sampleConfig, step.id, step.scalarGeneratorConfig]
  );

  const handlePrimaryModeChange = useCallback(
    (mode: PrimarySelectionMode) => {
      handleConfigChange({
        primaryMode: mode,
        primaryValue: mode === "none" ? undefined : config.primaryValue || 2,
      });
    },
    [handleConfigChange, config.primaryValue]
  );

  const handleSecondaryModeChange = useCallback(
    (mode: SecondarySelectionMode) => {
      handleConfigChange({
        secondaryMode: mode,
        secondaryValue: mode === "none" ? undefined : config.secondaryValue || 2,
      });
    },
    [handleConfigChange, config.secondaryValue]
  );

  const handleAddScalarEntry = useCallback(() => {
    updateScalarEntries(addScalarEntry(scalarEntries, crypto.randomUUID()));
  }, [scalarEntries, updateScalarEntries]);

  const handleRemoveScalarEntry = useCallback(
    (entryId: string) => {
      updateScalarEntries(removeScalarEntry(scalarEntries, entryId));
    },
    [scalarEntries, updateScalarEntries],
  );

  const handleRenameScalarEntry = useCallback(
    (entryId: string, key: string) => {
      updateScalarEntries(renameScalarEntry(scalarEntries, entryId, key));
    },
    [scalarEntries, updateScalarEntries],
  );

  const handleScalarDraftChange = useCallback((entryId: string, draft: string) => {
    setEntryDrafts((current) => ({
      ...current,
      [entryId]: draft,
    }));
  }, []);

  const handleScalarValuesBlur = useCallback(
    (entry: ScalarGeneratorEntry) => {
      const parsed = parseJsonArrayDraft(entryDrafts[entry.id] ?? "[]");
      if (parsed) {
        updateScalarEntries(updateScalarEntryValues(scalarEntries, entry.id, parsed));
        return;
      }
      setEntryDrafts((current) => ({
        ...current,
        [entry.id]: stringifyJsonDraft(entry.values),
      }));
    },
    [entryDrafts, scalarEntries, updateScalarEntries],
  );

  const handleSampleChoicesBlur = useCallback(() => {
    const parsed = parseJsonArrayDraft(sampleChoicesDraft);
    if (parsed) {
      updateSampleConfig({ choices: parsed });
      return;
    }
    setSampleChoicesDraft(stringifyJsonDraft(sampleConfig.choices ?? []));
  }, [sampleChoicesDraft, sampleConfig.choices, updateSampleConfig]);

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <GeneratorHeader
            meta={meta}
            optionCount={optionCount}
            variantCount={variantCount}
          />

          {(generatorKind === "grid" || generatorKind === "zip") && (
            <>
              <Separator />
              <ScalarParametersSection
                generatorKind={generatorKind}
                scalarEntries={scalarEntries}
                entryDrafts={entryDrafts}
                onAddEntry={handleAddScalarEntry}
                onRemoveEntry={handleRemoveScalarEntry}
                onRenameEntry={handleRenameScalarEntry}
                onDraftChange={handleScalarDraftChange}
                onValuesBlur={handleScalarValuesBlur}
              />
            </>
          )}

          {generatorKind === "sample" && (
            <>
              <Separator />
              <SamplingConfigurationSection
                sampleConfig={sampleConfig}
                sampleChoicesDraft={sampleChoicesDraft}
                onSampleConfigChange={updateSampleConfig}
                onSampleChoicesDraftChange={setSampleChoicesDraft}
                onSampleChoicesBlur={handleSampleChoicesBlur}
              />
            </>
          )}

          {/* Selection Mode — only for _or_ and _cartesian_ */}
          {meta.supportsPickArrange && (
            <>
              <Separator />
              <SelectionModeSection
                config={config}
                selectionBaseCount={selectionBaseCount}
                onPrimaryModeChange={handlePrimaryModeChange}
                onConfigChange={handleConfigChange}
              />
            </>
          )}

          {/* Second-Order Selection — only for _or_ */}
          {meta.supportsSecondOrder && (
            <>
              <Separator />
              <SecondOrderSelectionSection
                config={config}
                primarySelectionCount={primarySelectionCount}
                onSecondaryModeChange={handleSecondaryModeChange}
                onConfigChange={handleConfigChange}
              />
            </>
          )}

          <Separator />

          {/* Limit Variants (count) — available for all generator kinds */}
          <LimitVariantsSection
            config={config}
            unboundedVariantCount={unboundedVariantCount}
            onConfigChange={handleConfigChange}
          />

          <Separator />

          {/* Seed — available for all generator kinds */}
          <SeedSection
            config={config}
            onConfigChange={handleConfigChange}
          />

          <Separator />

          {/* Summary */}
          <GeneratorSummary
            meta={meta}
            config={config}
            generatorKind={generatorKind}
            variantCount={variantCount}
          />
        </div>
      </ScrollArea>

      <StepActions
        stepId={step.id}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </>
  );
}
