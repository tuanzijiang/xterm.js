/**
 * Copyright (c) 2026 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { CellData } from 'common/buffer/CellData';
import { Attributes } from 'common/buffer/Constants';
import { IBuffer } from 'common/buffer/Types';
import { channels, color, css } from 'common/Color';
import { ITheme, ITerminalOptions } from 'common/services/Services';
import { ICellData } from 'common/Types';

export interface ICanvasTextMetricsLike {
  width: number;
  actualBoundingBoxAscent?: number;
  actualBoundingBoxDescent?: number;
  fontBoundingBoxAscent?: number;
  fontBoundingBoxDescent?: number;
}

export interface ICanvasRenderingContext2DLike {
  fillStyle: unknown;
  strokeStyle: unknown;
  font: string;
  textBaseline: string;
  lineWidth: number;
  globalAlpha: number;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): ICanvasTextMetricsLike;
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

export interface ICanvasSurfaceLike {
  getContext(contextId: '2d'): ICanvasRenderingContext2DLike | null;
  toBuffer(mimeType?: 'image/png'): Uint8Array;
}

export interface ICanvasFactoryLike {
  createCanvas(width: number, height: number): ICanvasSurfaceLike;
}

export interface Logger {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface IToPNGOptions {
  canvasFactory?: ICanvasFactoryLike;
  includeCursor?: boolean;
  logger?: Logger;
  padding?: number;
  viewportStartLine?: number;
  viewportRows?: number;
}

const DEFAULT_FOREGROUND = '#ffffff';
const DEFAULT_BACKGROUND = '#000000';
const DEFAULT_CURSOR = '#ffffff';
const DEFAULT_ANSI_COLORS = Object.freeze((() => {
  const colors = [
    '#2e3436',
    '#cc0000',
    '#4e9a06',
    '#c4a000',
    '#3465a4',
    '#75507b',
    '#06989a',
    '#d3d7cf',
    '#555753',
    '#ef2929',
    '#8ae234',
    '#fce94f',
    '#729fcf',
    '#ad7fa8',
    '#34e2e2',
    '#eeeeec'
  ];
  const values = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
  for (let i = 0; i < 216; i++) {
    const r = values[(i / 36) % 6 | 0];
    const g = values[(i / 6) % 6 | 0];
    const b = values[i % 6];
    colors.push(channels.toCss(r, g, b));
  }
  for (let i = 0; i < 24; i++) {
    const c = 8 + i * 10;
    colors.push(channels.toCss(c, c, c));
  }
  return colors;
})());

interface IResolvedTheme {
  foreground: string;
  background: string;
  cursor: string;
  ansi: string[];
}

export async function renderTerminalToPNG(
  buffer: IBuffer,
  optionsService: { rawOptions: Required<ITerminalOptions> },
  dimensions: { cols: number; rows: number },
  options: IToPNGOptions = {}
): Promise<Uint8Array> {
  const logger = options.logger;
  logger?.info('Rendering terminal to PNG');
  const canvasFactory = options.canvasFactory ?? await loadCanvasFactory(logger);
  const padding = options.padding ?? 0;
  const fontSize = optionsService.rawOptions.fontSize;
  const lineHeight = optionsService.rawOptions.lineHeight;
  const letterSpacing = optionsService.rawOptions.letterSpacing;
  const theme = resolveTheme(optionsService.rawOptions.theme);
  const viewportStartLine = options.viewportStartLine ?? buffer.ydisp;
  const viewportRows = options.viewportRows ?? dimensions.rows;

  const measureCanvas = canvasFactory.createCanvas(1, 1);
  const measureContext = measureCanvas.getContext('2d');
  if (!measureContext) {
    throw new Error('Failed to acquire a 2d canvas context');
  }
  measureContext.font = createFont(optionsService.rawOptions.fontWeight, fontSize, optionsService.rawOptions.fontFamily);
  const metrics = measureContext.measureText('W');
  const measuredHeight = metrics.actualBoundingBoxAscent !== undefined || metrics.actualBoundingBoxDescent !== undefined
    ? (metrics.actualBoundingBoxAscent ?? 0) + (metrics.actualBoundingBoxDescent ?? 0)
    : (metrics.fontBoundingBoxAscent ?? 0) + (metrics.fontBoundingBoxDescent ?? 0);
  const cellWidth = Math.max(1, Math.ceil(metrics.width + letterSpacing));
  const textHeight = Math.max(1, Math.ceil(measuredHeight || fontSize));
  const cellHeight = Math.max(1, Math.ceil(Math.max(textHeight, fontSize) * lineHeight));
  const textTopOffset = Math.max(0, Math.floor((cellHeight - textHeight) / 2));

  const canvasWidth = dimensions.cols * cellWidth + padding * 2;
  const canvasHeight = viewportRows * cellHeight + padding * 2;
  const canvas = canvasFactory.createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire a 2d canvas context');
  }

  ctx.textBaseline = 'top';
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.background;
  logger?.info('CanvasRenderer.fillRect', {
    kind: 'canvas-background',
    fillStyle: ctx.fillStyle,
    x: 0,
    y: 0,
    width: canvasWidth,
    height: canvasHeight
  });
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const cell = new CellData();
  for (let y = 0; y < viewportRows; y++) {
    const line = buffer.lines.get(viewportStartLine + y);
    if (!line) {
      continue;
    }
    const rowTop = padding + y * cellHeight;
    for (let x = 0; x < dimensions.cols; x++) {
      const currentCell = line.loadCell(x, cell);
      const width = currentCell.getWidth();
      if (width === 0) {
        continue;
      }

      const chars = currentCell.getChars();
      let foreground = resolveForeground(currentCell, theme, optionsService.rawOptions.drawBoldTextInBrightColors);
      let background = resolveBackground(currentCell, theme);
      if (currentCell.isInverse()) {
        const swapped = foreground;
        foreground = background;
        background = swapped;
      }
      foreground = applyMinimumContrast(background, foreground, !!currentCell.isDim(), currentCell.getCode(), optionsService.rawOptions.minimumContrastRatio);

      const cellLeft = padding + x * cellWidth;
      const cellPixelWidth = Math.max(cellWidth, width * cellWidth);
      ctx.fillStyle = background;
      logger?.info('CanvasRenderer.fillRect', {
        kind: 'cell-background',
        chars: chars || ' ',
        col: x,
        row: y,
        fillStyle: ctx.fillStyle,
        x: cellLeft,
        y: rowTop,
        width: cellPixelWidth,
        height: cellHeight
      });
      ctx.fillRect(cellLeft, rowTop, cellPixelWidth, cellHeight);

      if (!currentCell.isInvisible() && chars) {
        ctx.save();
        ctx.globalAlpha = currentCell.isDim() ? 0.5 : 1;
        ctx.fillStyle = foreground;
        ctx.font = createFont(currentCell.isBold() ? optionsService.rawOptions.fontWeightBold : optionsService.rawOptions.fontWeight, fontSize, optionsService.rawOptions.fontFamily, currentCell.isItalic());
        logger?.info('CanvasRenderer.fillText', {
          kind: 'cell-text',
          text: chars,
          col: x,
          row: y,
          fillStyle: ctx.fillStyle,
          font: ctx.font,
          x: cellLeft,
          y: rowTop + textTopOffset,
          dim: currentCell.isDim()
        });
        ctx.fillText(chars, cellLeft, rowTop + textTopOffset);
        ctx.restore();
      }

      if (currentCell.isUnderline()) {
        ctx.save();
        ctx.strokeStyle = foreground;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cellLeft, rowTop + cellHeight - 1);
        ctx.lineTo(cellLeft + cellPixelWidth, rowTop + cellHeight - 1);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  if (options.includeCursor) {
    const cursorRow = buffer.y;
    const cursorLine = cursorRow + buffer.ybase - viewportStartLine;
    if (cursorLine >= 0 && cursorLine < viewportRows) {
      ctx.fillStyle = theme.cursor;
      logger?.info('CanvasRenderer.fillRect', {
        kind: 'cursor',
        col: buffer.x,
        row: cursorLine,
        fillStyle: ctx.fillStyle,
        x: padding + buffer.x * cellWidth,
        y: padding + cursorLine * cellHeight,
        width: cellWidth,
        height: cellHeight
      });
      ctx.fillRect(
        padding + buffer.x * cellWidth,
        padding + cursorLine * cellHeight,
        cellWidth,
        cellHeight
      );
    }
  }

  return canvas.toBuffer('image/png');
}

async function loadCanvasFactory(logger?: Logger): Promise<ICanvasFactoryLike> {
  const importModule = new Function('id', 'return import(id);') as (id: string) => Promise<any>;
  try {
    logger?.info('Loading canvas backend', '@napi-rs/canvas');
    const mod = await importModule('@napi-rs/canvas');
    if (typeof mod.createCanvas === 'function') {
      logger?.info('Loaded canvas backend', '@napi-rs/canvas');
      return { createCanvas: mod.createCanvas.bind(mod) };
    }
    if (mod.default && typeof mod.default.createCanvas === 'function') {
      logger?.info('Loaded canvas backend', '@napi-rs/canvas');
      return { createCanvas: mod.default.createCanvas.bind(mod.default) };
    }
  } catch (error) {
    logger?.error('Failed to load canvas backend', '@napi-rs/canvas', error);
    // Fall through to the explicit error below.
  }
  throw new Error('The "@napi-rs/canvas" backend is required for toPNG(). Install it or pass canvasFactory to toPNG().');
}

function createFont(weight: string | number, fontSize: number, fontFamily: string, italic?: number): string {
  const parts = [];
  if (italic) {
    parts.push('italic');
  }
  parts.push(String(weight));
  parts.push(`${fontSize}px`);
  parts.push(fontFamily);
  return parts.join(' ');
}

function resolveForeground(cell: ICellData, theme: IResolvedTheme, drawBoldTextInBrightColors: boolean): string {
  const mode = cell.getFgColorMode();
  if ((mode === Attributes.CM_P16 || mode === Attributes.CM_P256) && drawBoldTextInBrightColors && cell.isBold() && cell.getFgColor() < 8) {
    return theme.ansi[cell.getFgColor() + 8];
  }
  return resolveColor(mode, cell.getFgColor(), theme.foreground, theme.ansi);
}

function resolveBackground(cell: ICellData, theme: IResolvedTheme): string {
  return resolveColor(cell.getBgColorMode(), cell.getBgColor(), theme.background, theme.ansi);
}

function resolveColor(mode: number, value: number, fallback: string, palette: string[]): string {
  switch (mode) {
    case Attributes.CM_P16:
    case Attributes.CM_P256:
      return palette[value] ?? fallback;
    case Attributes.CM_RGB:
      return channels.toCss((value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF);
    default:
      return fallback;
  }
}

function applyMinimumContrast(backgroundCss: string, foregroundCss: string, isDim: boolean, codepoint: number, minimumContrastRatio: number): string {
  if (minimumContrastRatio === 1 || treatGlyphAsBackgroundColor(codepoint)) {
    return foregroundCss;
  }
  const adjusted = color.ensureContrastRatio(
    css.toColor(backgroundCss),
    css.toColor(foregroundCss),
    minimumContrastRatio / (isDim ? 2 : 1)
  );
  return adjusted?.css ?? foregroundCss;
}

function treatGlyphAsBackgroundColor(codepoint: number): boolean {
  return isPowerlineGlyph(codepoint) || isBoxOrBlockGlyph(codepoint);
}

function isPowerlineGlyph(codepoint: number): boolean {
  return 0xE0A4 <= codepoint && codepoint <= 0xE0D6;
}

function isBoxOrBlockGlyph(codepoint: number): boolean {
  return 0x2500 <= codepoint && codepoint <= 0x259F;
}

function resolveTheme(theme: ITheme = {}): IResolvedTheme {
  const ansi = DEFAULT_ANSI_COLORS.slice();
  applyAnsiOverride(ansi, 0, theme.black);
  applyAnsiOverride(ansi, 1, theme.red);
  applyAnsiOverride(ansi, 2, theme.green);
  applyAnsiOverride(ansi, 3, theme.yellow);
  applyAnsiOverride(ansi, 4, theme.blue);
  applyAnsiOverride(ansi, 5, theme.magenta);
  applyAnsiOverride(ansi, 6, theme.cyan);
  applyAnsiOverride(ansi, 7, theme.white);
  applyAnsiOverride(ansi, 8, theme.brightBlack);
  applyAnsiOverride(ansi, 9, theme.brightRed);
  applyAnsiOverride(ansi, 10, theme.brightGreen);
  applyAnsiOverride(ansi, 11, theme.brightYellow);
  applyAnsiOverride(ansi, 12, theme.brightBlue);
  applyAnsiOverride(ansi, 13, theme.brightMagenta);
  applyAnsiOverride(ansi, 14, theme.brightCyan);
  applyAnsiOverride(ansi, 15, theme.brightWhite);
  if (theme.extendedAnsi) {
    const limit = Math.min(theme.extendedAnsi.length, ansi.length - 16);
    for (let i = 0; i < limit; i++) {
      ansi[16 + i] = normalizeColor(theme.extendedAnsi[i], ansi[16 + i]);
    }
  }
  return {
    foreground: normalizeColor(theme.foreground, DEFAULT_FOREGROUND),
    background: normalizeColor(theme.background, DEFAULT_BACKGROUND),
    cursor: normalizeColor(theme.cursor, DEFAULT_CURSOR),
    ansi
  };
}

function applyAnsiOverride(target: string[], index: number, value: string | undefined): void {
  target[index] = normalizeColor(value, target[index]);
}

function normalizeColor(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  try {
    return css.toColor(value).css;
  } catch {
    return fallback;
  }
}
