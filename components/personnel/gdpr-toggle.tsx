"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Shield } from "lucide-react";

interface GDPRToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function GDPRToggle({ enabled, onChange }: GDPRToggleProps) {
  return (
    <div className="flex items-center gap-3 bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2.5">
      <Shield className="h-4 w-4 text-amber-400" />
      <Label htmlFor="gdpr-toggle" className="text-sm text-slate-300 cursor-pointer select-none">
        Privacy mode
      </Label>
      <Switch
        id="gdpr-toggle"
        checked={enabled}
        onCheckedChange={onChange}
        className="data-checked:bg-amber-500"
      />
      {enabled && (
        <span className="text-xs text-amber-400/80">
          Personal data hidden
        </span>
      )}
    </div>
  );
}
