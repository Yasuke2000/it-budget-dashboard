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
      <h1 className="text-2xl font-bold text-white">Something went wrong</h1>
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-4 space-y-3">
        <p className="text-sm text-red-300">A client-side error stopped this page from rendering:</p>
        <pre className="text-xs text-red-200 whitespace-pre-wrap font-mono bg-slate-900/60 rounded-md p-3">
          {String(error?.message || error)}{error?.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>
        <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
