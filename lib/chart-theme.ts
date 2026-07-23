"use client";

import { useTheme } from "next-themes";

/**
 * Unified chart palette — the single source of truth for BOTH engines
 * (Recharts app-wide, ECharts on /cfo). Values mirror the `--chart-*` tokens in
 * app/globals.css and were validated with the data-viz palette validator
 * (CVD-safe, in-band, ≥3:1 on each surface) for dark (#14181a) and light (#fff).
 *
 * Categorical order is fixed (emerald → blue → gold → magenta → violet → orange);
 * never cycle or reorder it — the order is the colorblind-safety mechanism.
 */
export interface ChartPalette {
  categorical: string[];
  income: string;
  expense: string;
  result: string;
  budget: string;
  positive: string;
  negative: string;
  warning: string;
  info: string;
  grid: string;
  axis: string;
  text: string;
  textMuted: string;
  surface: string;
  tooltipBg: string;
  tooltipBorder: string;
}

const DARK: ChartPalette = {
  categorical: ["#199e70", "#3987e5", "#c98500", "#e05f9a", "#9085e9", "#e0662e"],
  income: "#2fbd8a",
  expense: "#f2607e",
  result: "#e0b64a",
  budget: "#8a94a0",
  positive: "#2fbd8a",
  negative: "#f2607e",
  warning: "#e0b64a",
  info: "#3987e5",
  grid: "#242c2b",
  axis: "#3a4442",
  text: "#93a19c",
  textMuted: "#6b7772",
  surface: "#14181a",
  tooltipBg: "#1b2124",
  tooltipBorder: "rgba(255,255,255,0.12)",
};

const LIGHT: ChartPalette = {
  categorical: ["#0b8a5e", "#2a78d6", "#a37a10", "#c13b73", "#5a49c0", "#c24e1e"],
  income: "#0b8a5e",
  expense: "#c0344f",
  result: "#9a7a12",
  budget: "#7a8590",
  positive: "#0b8a5e",
  negative: "#c0344f",
  warning: "#9a7a12",
  info: "#2a78d6",
  grid: "#eceae4",
  axis: "#d7d5cd",
  text: "#52514e",
  textMuted: "#898781",
  surface: "#ffffff",
  tooltipBg: "#ffffff",
  tooltipBorder: "rgba(11,11,11,0.12)",
};

export function getChartPalette(isDark: boolean): ChartPalette {
  return isDark ? DARK : LIGHT;
}

/** Client hook — returns the palette for the live theme. Defaults to dark. */
export function useChartPalette(): ChartPalette {
  const { resolvedTheme } = useTheme();
  return getChartPalette(resolvedTheme !== "light");
}

/* ------------------------------------------------------------------ */
/* ECharts helpers — shared axis / grid / tooltip / legend fragments.  */
/* Spread these into an option object so every ECharts chart matches.   */
/* ------------------------------------------------------------------ */

export function echartsTooltip(p: ChartPalette) {
  return {
    backgroundColor: p.tooltipBg,
    borderColor: p.tooltipBorder,
    borderWidth: 1,
    padding: [8, 12] as [number, number],
    textStyle: { color: p.text, fontSize: 12 },
    extraCssText:
      "border-radius:10px;box-shadow:0 8px 28px -12px rgba(0,0,0,0.5);backdrop-filter:blur(8px);",
  };
}

export function echartsCategoryAxis(p: ChartPalette, extra: Record<string, unknown> = {}) {
  return {
    type: "category" as const,
    axisLabel: { color: p.text, fontSize: 10 },
    axisLine: { lineStyle: { color: p.axis } },
    axisTick: { show: false },
    ...extra,
  };
}

export function echartsValueAxis(
  p: ChartPalette,
  formatter?: (v: number) => string,
  extra: Record<string, unknown> = {}
) {
  return {
    type: "value" as const,
    axisLabel: { color: p.textMuted, fontSize: 10, ...(formatter ? { formatter } : {}) },
    splitLine: { lineStyle: { color: p.grid } },
    ...extra,
  };
}

export function echartsLegend(p: ChartPalette, extra: Record<string, unknown> = {}) {
  return {
    textStyle: { color: p.text },
    icon: "roundRect",
    itemWidth: 10,
    itemHeight: 10,
    ...extra,
  };
}
