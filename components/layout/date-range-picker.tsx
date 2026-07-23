"use client";

import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { useDateRange } from "./date-range-context";

export function DateRangePicker() {
  const { selectedRange, setSelectedRange, presets } = useDateRange();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-card text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{selectedRange.label}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/70" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-popover border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="p-1.5 max-h-80 overflow-y-auto">
            {presets.map((preset) => (
              <button
                key={preset.value}
                onClick={() => {
                  setSelectedRange(preset);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                  selectedRange.value === preset.value
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>{preset.label}</span>
                  <span className="text-xs text-muted-foreground/70">
                    {preset.from.slice(5)} → {preset.to.slice(5)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
