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
    <div className="flex items-center gap-3 bg-accent border border-border rounded-lg px-4 py-2.5">
      <Shield className="h-4 w-4 text-warning" />
      <Label htmlFor="gdpr-toggle" className="text-sm text-foreground cursor-pointer select-none">
        Privacy mode
      </Label>
      <Switch
        id="gdpr-toggle"
        checked={enabled}
        onCheckedChange={onChange}
        className="data-checked:bg-warning"
      />
      {enabled && (
        <span className="text-xs text-warning/80">
          Personal data hidden
        </span>
      )}
    </div>
  );
}
