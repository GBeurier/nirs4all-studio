import {
  buildCombinedReportStatsParts,
  formatCombinedReportChartLabel,
  type CombinedReportStatistics,
} from '@/lib/playground/exportReportLayout';

const dividerStroke = '#e5e5e5';
const titleFill = '#1a1a1a';
const mutedFill = '#666666';
const bodyFill = '#333333';
const placeholderFill = '#f5f5f5';
const placeholderTextFill = '#999999';
const generatedText = 'Generated with nirs4all Playground';

export interface CombinedReportTextInstruction {
  text: string;
  x: number;
  y: number;
  fillStyle: string;
  font: string;
  textAlign?: CanvasTextAlign;
  textBaseline?: CanvasTextBaseline;
  resetTextAlign?: CanvasTextAlign;
}

export interface CombinedReportDividerInstruction {
  strokeStyle: string;
  lineWidth: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface CombinedReportRectInstruction {
  x: number;
  y: number;
  width: number;
  height: number;
  fillStyle?: string;
  strokeStyle?: string;
  lineWidth?: number;
}

export interface CombinedReportHeaderDrawingInput {
  datasetName: string;
  dateText: string;
  padding: number;
  headerHeight: number;
  width: number;
}

export interface CombinedReportHeaderDrawing {
  titleText: CombinedReportTextInstruction;
  dateText: CombinedReportTextInstruction;
  divider: CombinedReportDividerInstruction;
}

export function buildCombinedReportHeaderDrawing({
  datasetName,
  dateText,
  padding,
  headerHeight,
  width,
}: CombinedReportHeaderDrawingInput): CombinedReportHeaderDrawing {
  return {
    titleText: {
      text: datasetName,
      x: padding,
      y: padding,
      fillStyle: titleFill,
      font: 'bold 24px system-ui, sans-serif',
      textBaseline: 'top',
    },
    dateText: {
      text: dateText,
      x: padding,
      y: padding + 30,
      fillStyle: mutedFill,
      font: '14px system-ui, sans-serif',
    },
    divider: {
      strokeStyle: dividerStroke,
      lineWidth: 1,
      fromX: padding,
      fromY: headerHeight,
      toX: width - padding,
      toY: headerHeight,
    },
  };
}

export interface CombinedReportChartDrawingInput {
  chartType: string;
  x: number;
  y: number;
  cellWidth: number;
  cellHeight: number;
}

export interface CombinedReportChartDrawing {
  labelText: CombinedReportTextInstruction;
  border: CombinedReportRectInstruction;
  placeholderBackground: CombinedReportRectInstruction;
  placeholderText: CombinedReportTextInstruction;
}

export function buildCombinedReportChartDrawing({
  chartType,
  x,
  y,
  cellWidth,
  cellHeight,
}: CombinedReportChartDrawingInput): CombinedReportChartDrawing {
  return {
    labelText: {
      text: formatCombinedReportChartLabel(chartType),
      x: x + 5,
      y: y + 5,
      fillStyle: bodyFill,
      font: 'bold 12px system-ui, sans-serif',
    },
    border: {
      x,
      y,
      width: cellWidth,
      height: cellHeight,
      strokeStyle: dividerStroke,
      lineWidth: 1,
    },
    placeholderBackground: {
      x,
      y,
      width: cellWidth,
      height: cellHeight,
      fillStyle: placeholderFill,
    },
    placeholderText: {
      text: `[${chartType}]`,
      x: x + cellWidth / 2,
      y: y + cellHeight / 2,
      fillStyle: placeholderTextFill,
      font: '14px system-ui, sans-serif',
      textAlign: 'center',
      resetTextAlign: 'left',
    },
  };
}

export interface CombinedReportFooterDrawingInput {
  height: number;
  footerHeight: number;
  width: number;
  padding: number;
  pipelineDescription?: string;
  statistics?: CombinedReportStatistics;
}

export interface CombinedReportFooterDrawing {
  footerY: number;
  divider: CombinedReportDividerInstruction;
  pipelineText?: CombinedReportTextInstruction;
  statsText?: CombinedReportTextInstruction;
  generatedText: CombinedReportTextInstruction;
}

export function buildCombinedReportFooterDrawing({
  height,
  footerHeight,
  width,
  padding,
  pipelineDescription,
  statistics,
}: CombinedReportFooterDrawingInput): CombinedReportFooterDrawing {
  const footerY = height - footerHeight;
  const statsParts = buildCombinedReportStatsParts(statistics);

  return {
    footerY,
    divider: {
      strokeStyle: dividerStroke,
      lineWidth: 1,
      fromX: padding,
      fromY: footerY,
      toX: width - padding,
      toY: footerY,
    },
    pipelineText: pipelineDescription
      ? {
        text: `Pipeline: ${pipelineDescription}`,
        x: padding,
        y: footerY + 15,
        fillStyle: bodyFill,
        font: '14px system-ui, sans-serif',
      }
      : undefined,
    statsText: statsParts.length > 0
      ? {
        text: statsParts.join(' | '),
        x: padding,
        y: footerY + 40,
        fillStyle: mutedFill,
        font: '12px system-ui, sans-serif',
      }
      : undefined,
    generatedText: {
      text: generatedText,
      x: width - padding,
      y: footerY + 55,
      fillStyle: placeholderTextFill,
      font: '10px system-ui, sans-serif',
      textAlign: 'right',
      resetTextAlign: 'left',
    },
  };
}

function drawTextInstruction(
  ctx: CanvasRenderingContext2D,
  instruction: CombinedReportTextInstruction,
): void {
  ctx.fillStyle = instruction.fillStyle;
  ctx.font = instruction.font;
  if (instruction.textBaseline) {
    ctx.textBaseline = instruction.textBaseline;
  }
  if (instruction.textAlign) {
    ctx.textAlign = instruction.textAlign;
  }
  ctx.fillText(instruction.text, instruction.x, instruction.y);
  if (instruction.resetTextAlign) {
    ctx.textAlign = instruction.resetTextAlign;
  }
}

function drawDividerInstruction(
  ctx: CanvasRenderingContext2D,
  instruction: CombinedReportDividerInstruction,
): void {
  ctx.strokeStyle = instruction.strokeStyle;
  ctx.lineWidth = instruction.lineWidth;
  ctx.beginPath();
  ctx.moveTo(instruction.fromX, instruction.fromY);
  ctx.lineTo(instruction.toX, instruction.toY);
  ctx.stroke();
}

function drawFillRectInstruction(
  ctx: CanvasRenderingContext2D,
  instruction: CombinedReportRectInstruction,
): void {
  if (instruction.fillStyle) {
    ctx.fillStyle = instruction.fillStyle;
  }
  ctx.fillRect(instruction.x, instruction.y, instruction.width, instruction.height);
}

function drawStrokeRectInstruction(
  ctx: CanvasRenderingContext2D,
  instruction: CombinedReportRectInstruction,
): void {
  if (instruction.strokeStyle) {
    ctx.strokeStyle = instruction.strokeStyle;
  }
  if (instruction.lineWidth !== undefined) {
    ctx.lineWidth = instruction.lineWidth;
  }
  ctx.strokeRect(instruction.x, instruction.y, instruction.width, instruction.height);
}

export function drawCombinedReportHeader(
  ctx: CanvasRenderingContext2D,
  input: CombinedReportHeaderDrawingInput,
): void {
  const drawing = buildCombinedReportHeaderDrawing(input);
  drawTextInstruction(ctx, drawing.titleText);
  drawTextInstruction(ctx, drawing.dateText);
  drawDividerInstruction(ctx, drawing.divider);
}

export function drawCombinedReportChartFrame(
  ctx: CanvasRenderingContext2D,
  input: CombinedReportChartDrawingInput,
): void {
  const drawing = buildCombinedReportChartDrawing(input);
  drawTextInstruction(ctx, drawing.labelText);
  drawStrokeRectInstruction(ctx, drawing.border);
}

export function drawCombinedReportChartPlaceholder(
  ctx: CanvasRenderingContext2D,
  input: CombinedReportChartDrawingInput,
): void {
  const drawing = buildCombinedReportChartDrawing(input);
  drawFillRectInstruction(ctx, drawing.placeholderBackground);
  drawTextInstruction(ctx, drawing.placeholderText);
}

export function drawCombinedReportFooter(
  ctx: CanvasRenderingContext2D,
  input: CombinedReportFooterDrawingInput,
): void {
  const drawing = buildCombinedReportFooterDrawing(input);
  drawDividerInstruction(ctx, drawing.divider);
  if (drawing.pipelineText) {
    drawTextInstruction(ctx, drawing.pipelineText);
  }
  if (drawing.statsText) {
    drawTextInstruction(ctx, drawing.statsText);
  }
  drawTextInstruction(ctx, drawing.generatedText);
}
