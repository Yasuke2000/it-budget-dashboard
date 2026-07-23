"use client";

import { Button } from "@/components/ui/button";

// Segment-level error boundary — surfaces a render error in any page instead of
// silently freezing the UI.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
      <div className="rounded-xl border border-negative/30 bg-negative/10 px-4 py-4 space-y-3">
        <p className="text-sm text-negative">A client-side error stopped this page from rendering:</p>
        <pre className="text-xs text-negative/90 whitespace-pre-wrap font-mono bg-card/60 rounded-md p-3">
          {String(error?.message || error)}{error?.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>
        <Button size="sm" variant="ghost" className="text-negative hover:text-negative/80" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
