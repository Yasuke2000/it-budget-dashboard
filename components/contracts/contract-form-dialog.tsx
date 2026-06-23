"use client";

import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileText, X, Loader2 } from "lucide-react";
import type { Contract } from "@/lib/types";

interface ContractFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Contract being edited, or null/partial prefill for a new one. */
  contract: Partial<Contract> | null;
  onSaved: () => void;
}

const CATEGORIES = [
  { value: "saas", label: "SaaS / Subscription" },
  { value: "license", label: "License" },
  { value: "support", label: "Support / Services" },
  { value: "infrastructure", label: "Infrastructure / Hosting" },
  { value: "domain", label: "Domain" },
  { value: "ssl", label: "SSL Certificate" },
];
const BILLING = [
  { value: "annual", label: "Annual" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "multi-year", label: "Multi-year" },
];

export function ContractFormDialog({ open, onOpenChange, contract, onSaved }: ContractFormDialogProps) {
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("saas");
  const [billingCycle, setBillingCycle] = useState("annual");
  const [annualCost, setAnnualCost] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [noticePeriodDays, setNoticePeriodDays] = useState("");
  const [autoRenew, setAutoRenew] = useState(false);
  const [owner, setOwner] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [fileId, setFileId] = useState<string | undefined>();
  const [fileName, setFileName] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Hydrate the form whenever the target contract changes.
  useEffect(() => {
    if (!open) return;
    setVendor(contract?.vendor || "");
    setDescription(contract?.description || "");
    setCategory(contract?.category || "saas");
    setBillingCycle(contract?.billingCycle || "annual");
    setAnnualCost(contract?.annualCost ? String(contract.annualCost) : "");
    setStartDate(contract?.startDate || "");
    setEndDate(contract?.endDate || "");
    setNoticePeriodDays(contract?.noticePeriodDays ? String(contract.noticePeriodDays) : "");
    setAutoRenew(Boolean(contract?.autoRenew));
    setOwner(contract?.owner || "");
    setNotes(contract?.notes || "");
    setTags((contract?.tags || []).join(", "));
    setFileId(contract?.fileId);
    setFileName(contract?.fileName);
    setError(null);
  }, [open, contract]);

  const isEdit = Boolean(contract?.id);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/contracts/file", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setFileId(data.fileId);
      setFileName(data.fileName);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleSave() {
    if (!vendor.trim()) { setError("Vendor is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: contract?.id,
          vendor, description, category, billingCycle,
          annualCost: Number(annualCost) || 0,
          startDate, endDate,
          noticePeriodDays: Number(noticePeriodDays) || 0,
          autoRenew, owner, notes,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          fileId, fileName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto bg-slate-950 border-slate-800">
        <DialogHeader>
          <DialogTitle className="text-white">{isEdit ? "Edit contract" : "Add contract"}</DialogTitle>
          <DialogDescription className="text-slate-400">
            Track renewal dates, costs and the signed document so nothing auto-renews unnoticed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-slate-300">Vendor *</Label>
              <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. EASI" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-slate-300">Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this contract for?" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Category</Label>
              <Select value={category} onValueChange={(v) => { if (v) setCategory(v); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Billing cycle</Label>
              <Select value={billingCycle} onValueChange={(v) => { if (v) setBillingCycle(v); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BILLING.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Annual cost (€)</Label>
              <Input type="number" inputMode="decimal" value={annualCost} onChange={(e) => setAnnualCost(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Owner</Label>
              <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Responsible person" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Renewal / end date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Notice period (days)</Label>
              <Input type="number" inputMode="numeric" value={noticePeriodDays} onChange={(e) => setNoticePeriodDays(e.target.value)} placeholder="e.g. 90" />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Switch checked={autoRenew} onCheckedChange={(v) => setAutoRenew(Boolean(v))} />
              <Label className="text-slate-300">Auto-renews</Label>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-slate-300">Tags (comma-separated)</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="erp, critical, cloud" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-slate-300">Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Renewal terms, contact, conditions…" />
            </div>
          </div>

          {/* Document upload zone */}
          <div className="space-y-1.5">
            <Label className="text-slate-300">Contract document</Label>
            {fileName ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
                <FileText className="h-4 w-4 text-teal-400 shrink-0" />
                {fileId ? (
                  <a href={`/api/contracts/file?id=${fileId}`} target="_blank" rel="noreferrer" className="text-sm text-teal-400 hover:underline truncate flex-1">{fileName}</a>
                ) : (
                  <span className="text-sm text-slate-300 truncate flex-1">{fileName}</span>
                )}
                <button type="button" onClick={() => { setFileId(undefined); setFileName(undefined); }} className="text-slate-500 hover:text-red-400" aria-label="Remove file">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700 bg-slate-900/50 px-3 py-4 text-sm text-slate-400 hover:border-teal-500/50 hover:text-teal-400 transition-colors disabled:opacity-60"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? "Uploading…" : "Upload PDF / document (max 20 MB)"}
              </button>
            )}
            <input ref={fileInput} type="file" className="hidden" onChange={handleFile}
              accept=".pdf,.png,.jpg,.jpeg,.docx,.doc,.xlsx,.xls,.txt,.eml,.msg" />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || uploading} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Add contract"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
