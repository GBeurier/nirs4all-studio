import {
  CATEGORICAL_PALETTES,
  getCategoricalPaletteLabel,
  getContinuousPaletteGradient,
  getContinuousPaletteLabel,
  type CategoricalPalette,
  type ContinuousPalette,
} from "@/lib/playground/colorConfig";
import { SelectItem } from "@/components/ui/select";
import {
  CATEGORICAL_PALETTE_OPTIONS,
  CONTINUOUS_PALETTE_OPTIONS,
  type PartitionColorKey,
} from "./ChartConfigPopoverData";
import {
  ColorInputRow,
  MiniDiscretePalette,
  type ChartConfigUpdater,
} from "./ChartConfigPopoverPrimitives";
import { SelectField } from "./ChartConfigPopoverSectionControls";
import { getPaletteLabel, listPalettes } from "./palettes";
import type {
  ChartConfig,
  ViewerMetadataType,
} from "./types";

export function MetadataColorControls({
  config,
  metadataColumns,
  hasMetadata,
  effectiveMetadataKey,
  effectiveMetadataType,
  update,
  updateMetadataKey,
}: {
  config: ChartConfig;
  metadataColumns: string[];
  hasMetadata: boolean;
  effectiveMetadataKey: string | undefined;
  effectiveMetadataType: ViewerMetadataType;
  update: ChartConfigUpdater;
  updateMetadataKey: (value: string) => void;
}) {
  return (
    <>
      <SelectField
        label="Metadata column"
        value={effectiveMetadataKey}
        onValueChange={updateMetadataKey}
        disabled={!hasMetadata}
        placeholder="No metadata columns"
        footer={(
          <p className="text-[10px] leading-4 text-muted-foreground">
            Uses the same automatic metadata type detection as Playground. This column is currently treated as {effectiveMetadataType}.
          </p>
        )}
      >
        {metadataColumns.map((column) => (
          <SelectItem key={column} value={column} className="text-xs">
            {column}
          </SelectItem>
        ))}
      </SelectField>

      {effectiveMetadataType === "continuous" ? (
        <ContinuousPaletteField
          palette={config.continuousPalette}
          onValueChange={(value) => update("continuousPalette", value as ContinuousPalette)}
        />
      ) : (
        <CategoricalPaletteField
          palette={config.categoricalPalette}
          onValueChange={(value) => update("categoricalPalette", value as CategoricalPalette)}
        />
      )}
    </>
  );
}

function ContinuousPaletteField({
  palette,
  onValueChange,
}: {
  palette: ContinuousPalette;
  onValueChange: (value: string) => void;
}) {
  return (
    <SelectField
      label="Continuous palette"
      value={palette}
      onValueChange={onValueChange}
      triggerContent={<ContinuousPalettePreview palette={palette} truncate />}
    >
      {CONTINUOUS_PALETTE_OPTIONS.map((option) => (
        <SelectItem key={option} value={option} className="text-xs">
          <ContinuousPalettePreview palette={option} />
        </SelectItem>
      ))}
    </SelectField>
  );
}

function ContinuousPalettePreview({
  palette,
  truncate = false,
}: {
  palette: ContinuousPalette;
  truncate?: boolean;
}) {
  return (
    <div className={truncate ? "flex min-w-0 items-center gap-2" : "flex items-center gap-2"}>
      <span
        aria-hidden
        className="h-3 w-16 rounded-sm border border-border/50"
        style={{ backgroundImage: getContinuousPaletteGradient(palette) }}
      />
      <span className={truncate ? "truncate" : undefined}>
        {getContinuousPaletteLabel(palette)}
      </span>
    </div>
  );
}

function CategoricalPaletteField({
  palette,
  onValueChange,
}: {
  palette: CategoricalPalette;
  onValueChange: (value: string) => void;
}) {
  return (
    <SelectField
      label="Categorical palette"
      value={palette}
      onValueChange={onValueChange}
      triggerContent={<CategoricalPalettePreview palette={palette} truncate />}
    >
      {CATEGORICAL_PALETTE_OPTIONS.map((option) => (
        <SelectItem key={option} value={option} className="text-xs">
          <CategoricalPalettePreview palette={option} />
        </SelectItem>
      ))}
    </SelectField>
  );
}

function CategoricalPalettePreview({
  palette,
  truncate = false,
}: {
  palette: CategoricalPalette;
  truncate?: boolean;
}) {
  return (
    <div className={truncate ? "flex min-w-0 items-center gap-2" : "flex items-center gap-2"}>
      <MiniDiscretePalette colors={CATEGORICAL_PALETTES[palette].slice(0, 5)} />
      <span className={truncate ? "truncate" : undefined}>
        {getCategoricalPaletteLabel(palette)}
      </span>
    </div>
  );
}

export function PartitionColorControls({
  config,
  currentPaletteColors,
  applyPartitionPalette,
  updatePartitionColor,
}: {
  config: ChartConfig;
  currentPaletteColors: readonly string[];
  applyPartitionPalette: (value: string) => void;
  updatePartitionColor: (key: PartitionColorKey, value: string) => void;
}) {
  return (
    <>
      <SelectField
        label="Partition palette"
        value={config.palette}
        onValueChange={applyPartitionPalette}
        triggerContent={(
          <PartitionPalettePreview
            colors={currentPaletteColors}
            label={getPaletteLabel(config.palette)}
            truncate
          />
        )}
        footer={(
          <p className="text-[10px] leading-4 text-muted-foreground">
            Choosing a preset updates the editable train, validation, and test colors below.
          </p>
        )}
      >
        {listPalettes().map((palette) => (
          <SelectItem key={palette.id} value={palette.id} className="text-xs">
            <PartitionPalettePreview colors={palette.colors} label={palette.label} />
          </SelectItem>
        ))}
        <SelectItem value="custom" className="text-xs">
          <PartitionPalettePreview colors={currentPaletteColors} label="Custom" />
        </SelectItem>
      </SelectField>

      <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
        <ColorInputRow
          label="Train"
          value={config.partitionColors.train}
          onChange={(value) => updatePartitionColor("train", value)}
        />
        <ColorInputRow
          label="Validation"
          value={config.partitionColors.val}
          onChange={(value) => updatePartitionColor("val", value)}
        />
        <ColorInputRow
          label="Test"
          value={config.partitionColors.test}
          onChange={(value) => updatePartitionColor("test", value)}
        />
      </div>
    </>
  );
}

function PartitionPalettePreview({
  colors,
  label,
  truncate = false,
}: {
  colors: readonly string[];
  label: string;
  truncate?: boolean;
}) {
  return (
    <div className={truncate ? "flex min-w-0 items-center gap-2" : "flex items-center gap-2"}>
      <MiniDiscretePalette colors={colors} />
      <span className={truncate ? "truncate" : undefined}>{label}</span>
    </div>
  );
}
