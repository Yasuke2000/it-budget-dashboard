"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, CheckCircle2, AlertTriangle, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

type State = "idle" | "uploading" | "success" | "error";

interface UploadResult {
  imported: number;
  months: string[];
  totalImportedCost: number;
  storedEntries: number;
}

export function EasyPayImportCard() {
  const [state, setState] = useState<State>("idle");
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (file: File) => {
    setFileName(file.name);
    setState("uploading");
    setErrorMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/import/easypay", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || `Upload failed (${res.status})`);
        setState("error");
        return;
      }
      setResult(json as UploadResult);
      setState("success");
    } catch {
      setErrorMsg("Network error while uploading. Is the server reachable?");
      setState("error");
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) upload(file);
    },
    [upload]
  );

  function reset() {
    setState("idle");
    setFileName(null);
    setErrorMsg(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-teal-400 shrink-0" />
            <h3 className="text-sm font-semibold text-white">EasyPay Payroll</h3>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Monthly IT-personnel cost from EasyPay (EASY online export). Export only your IT
            department&apos;s payroll — it rolls up to the &quot;IT Personnel&quot; cost line. Stored on
            the server (not the browser).
          </p>
        </div>
      </div>

      {(state === "idle" || state === "error") && (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "relative cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors",
            isDragging ? "border-teal-400 bg-teal-500/10" : "border-slate-700 hover:border-teal-500 hover:bg-slate-800/50"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
          />
          <Upload className={cn("mx-auto h-8 w-8 mb-3", isDragging ? "text-teal-400" : "text-slate-500")} />
          <p className="text-sm font-medium text-slate-300">
            {isDragging ? "Drop your EasyPay export here" : "Drag & drop your EasyPay CSV/TXT export"}
          </p>
          <p className="mt-1 text-xs text-slate-500">or click to browse</p>
        </div>
      )}

      {state === "uploading" && (
        <div className="flex items-center gap-2 rounded-lg bg-slate-800/60 border border-slate-700 px-3 py-2.5">
          <div className="h-4 w-4 rounded-full border-2 border-teal-400 border-t-transparent animate-spin" />
          <p className="text-xs text-slate-300">Uploading and parsing {fileName}…</p>
        </div>
      )}

      {state === "error" && errorMsg && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-300">{errorMsg}</p>
        </div>
      )}

      {state === "success" && result && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 rounded-lg bg-teal-500/10 border border-teal-500/30 px-3 py-2.5">
            <CheckCircle2 className="h-4 w-4 text-teal-400 shrink-0 mt-0.5" />
            <p className="text-xs text-teal-300">
              Imported <span className="font-semibold">{result.imported}</span> month(s) —{" "}
              <span className="font-semibold">
                {new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(result.totalImportedCost)}
              </span>{" "}
              total. Refresh the dashboard to see the IT Personnel cost line.
            </p>
          </div>
          <button onClick={reset} className="self-start text-xs text-slate-400 hover:text-white transition-colors">
            Import another file
          </button>
        </div>
      )}

      {state === "idle" && (
        <div>
          <p className="text-[11px] text-slate-500 mb-1.5 font-medium uppercase tracking-wider">Recognised columns (NL / FR / EN)</p>
          <div className="flex flex-wrap gap-1">
            {["maand / mois / month", "werkgeverskost / coût total / employer cost", "brutoloon / gross", "onderneming / company (optional)"].map((col) => (
              <span key={col} className="rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">
                {col}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
