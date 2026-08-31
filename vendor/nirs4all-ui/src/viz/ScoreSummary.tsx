import { cx } from "./_cx.js";
import { round } from "./geometry.js";
import { N4_VIZ_COLORS } from "./theme.js";

/** One big-number score tile. */
export interface ScoreStat {
  label: string;
  value: string;
  delta?: string;
  tone?: "positive" | "negative" | "neutral";
}

export interface ScoreSummaryProps {
  stats: readonly ScoreStat[];
  columns?: number;
  tileWidth?: number;
  tileHeight?: number;
  gap?: number;
  title?: string;
  className?: string;
}

const TONE_COLORS: Record<NonNullable<ScoreStat["tone"]>, string> = {
  positive: N4_VIZ_COLORS.green,
  negative: N4_VIZ_COLORS.rose,
  neutral: N4_VIZ_COLORS.slate,
};

function toneColor(tone: ScoreStat["tone"]): string {
  return TONE_COLORS[tone ?? "neutral"];
}

/**
 * Compact grid of metric stat tiles — the big-number score cards from Studio's
 * ScoreCardTree and the Web ResultsList, rendered as one presentational SVG so
 * it composes like the other viz charts. Hosts pass pre-formatted strings.
 */
export function ScoreSummary({
  stats,
  columns = 3,
  tileWidth = 120,
  tileHeight = 76,
  gap = 10,
  title = "Scores",
  className,
}: ScoreSummaryProps) {
  const cols = Math.max(1, Math.trunc(columns));
  const rows = stats.length > 0 ? Math.ceil(stats.length / cols) : 0;
  const width = cols * tileWidth + (cols + 1) * gap;
  const height = rows * tileHeight + (rows + 1) * gap;

  return (
    <svg
      className={cx("n4viz", "n4viz-scores", className)}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{title}</title>

      {stats.map((stat, i) => {
        const col = i % cols;
        const rowIdx = Math.floor(i / cols);
        const x = gap + col * (tileWidth + gap);
        const y = gap + rowIdx * (tileHeight + gap);
        const tone = stat.tone ?? "neutral";
        return (
          <g key={`${stat.label}-${i}`} className="n4viz-stat" data-tone={tone}>
            <rect
              className="n4viz-stat-tile"
              x={round(x)}
              y={round(y)}
              width={round(tileWidth)}
              height={round(tileHeight)}
              rx={10}
              fill={`color-mix(in srgb, ${toneColor(tone)} 8%, transparent)`}
              stroke={toneColor(tone)}
              strokeOpacity={0.3}
            />
            <text className="n4viz-stat-label" x={round(x + 12)} y={round(y + 20)}>
              {stat.label}
            </text>
            <text className="n4viz-stat-value" x={round(x + 12)} y={round(y + 46)}>
              {stat.value}
            </text>
            {stat.delta ? (
              <text
                className="n4viz-stat-delta"
                x={round(x + 12)}
                y={round(y + 64)}
                fill={toneColor(tone)}
              >
                {stat.delta}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
