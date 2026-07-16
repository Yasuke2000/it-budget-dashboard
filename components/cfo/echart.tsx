"use client";

// Thin React wrapper around Apache ECharts — used ONLY on the CFO cockpit so this
// page runs on a different, richer charting engine than the rest of the app
// (which uses recharts). Initialises in a useEffect (client-only), keeps the
// option in sync, auto-resizes via ResizeObserver, and forwards click events for
// drill-down. No echarts-for-react dependency (React 19 peer-dep friction).

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

export interface EChartClick {
  name?: string;
  seriesName?: string;
  dataIndex?: number;
  componentType?: string;
  value?: unknown;
  data?: unknown;
}

interface Props {
  option: echarts.EChartsOption;
  height?: number;
  className?: string;
  onSelect?: (p: EChartClick) => void;
  ariaLabel?: string;
}

export function EChart({ option, height = 320, className, onSelect, ariaLabel }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!elRef.current) return;
    const chart = echarts.init(elRef.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    chart.on("click", (params) => {
      const p = params as unknown as EChartClick;
      onSelectRef.current?.(p);
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return (
    <div
      ref={elRef}
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ height, width: "100%" }}
    />
  );
}
