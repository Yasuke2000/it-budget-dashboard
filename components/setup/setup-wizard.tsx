"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  X,
  Wifi,
  Database,
  Users,
  Layers,
  LayoutDashboard,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WizardSettings {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  bcEnvironment: string;
  jiraEnabled: boolean;
  jiraBaseUrl: string;
  jiraApiToken: string;
  officientEnabled: boolean;
  officientClientId: string;
  knoxEnabled: boolean;
  knoxClientId: string;
}

const STORAGE_KEY_COMPLETE = "itdash_setup_complete";
const STORAGE_KEY_SETTINGS = "itdash_wizard_settings";

const STEP_COUNT = 5;

const STEP_LABELS = [
  "Welcome",
  "Microsoft 365",
  "Business Central",
  "Optional",
  "Done",
];

const STEP_ICONS = [
  LayoutDashboard,
  Wifi,
  Database,
  Layers,
  CheckCircle2,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function saveWizardSettings(settings: Partial<WizardSettings>) {
  try {
    const existing = loadWizardSettings();
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify({ ...existing, ...settings }));
  } catch {
    // localStorage may be unavailable in some SSR contexts
  }
}

function loadWizardSettings(): WizardSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (raw) return JSON.parse(raw) as WizardSettings;
  } catch { /* ignore */ }
  return {
    tenantId: "",
    clientId: "",
    clientSecret: "",
    bcEnvironment: "",
    jiraEnabled: false,
    jiraBaseUrl: "",
    jiraApiToken: "",
    officientEnabled: false,
    officientClientId: "",
    knoxEnabled: false,
    knoxClientId: "",
  };
}

export function markSetupComplete() {
  try {
    localStorage.setItem(STORAGE_KEY_COMPLETE, "1");
  } catch { /* ignore */ }
}

export function isSetupComplete(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_COMPLETE) === "1";
  } catch {
    return true; // default to complete if localStorage unavailable
  }
}

export function resetSetup() {
  try {
    localStorage.removeItem(STORAGE_KEY_COMPLETE);
  } catch { /* ignore */ }
}

// ─── Step components ──────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1 justify-center mb-8">
      {STEP_LABELS.map((label, i) => {
        const StepIcon = STEP_ICONS[i];
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center gap-1">
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold transition-colors",
                done
                  ? "bg-teal-600 border-teal-500 text-white"
                  : active
                  ? "bg-slate-700 border-teal-500 text-teal-300"
                  : "bg-slate-800 border-slate-700 text-slate-500"
              )}
            >
              {done ? <CheckCircle2 className="h-4 w-4" /> : <StepIcon className="h-3.5 w-3.5" />}
            </div>
            {i < STEP_COUNT - 1 && (
              <div
                className={cn(
                  "h-px w-6 transition-colors",
                  done ? "bg-teal-600" : "bg-slate-700"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Step 1: Welcome
function WelcomeStep({
  onDemo,
  onContinue,
}: {
  onDemo: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-6">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-500/15 border border-teal-500/30">
        <LayoutDashboard className="h-8 w-8 text-teal-400" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-white">Welcome to IT Finance Dashboard</h2>
        <p className="mt-2 text-sm text-slate-400 max-w-sm mx-auto leading-relaxed">
          Let&apos;s get you connected to your data sources. This only takes a few minutes.
        </p>
      </div>
      <div className="flex flex-col gap-3 w-full max-w-sm">
        <Button
          onClick={onContinue}
          className="bg-teal-600 hover:bg-teal-500 text-white h-11 text-sm font-semibold"
        >
          Connect Live Data
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
        <Button
          onClick={onDemo}
          variant="ghost"
          className="text-slate-400 hover:text-white h-11 text-sm border border-slate-700 hover:border-slate-600"
        >
          Start with Demo Data
        </Button>
      </div>
      <p className="text-xs text-slate-600">You can always connect data sources later from Settings.</p>
    </div>
  );
}

// Step 2: Microsoft 365
function M365Step({
  settings,
  onChange,
  onNext,
  onBack,
  onSkip,
}: {
  settings: WizardSettings;
  onChange: (patch: Partial<WizardSettings>) => void;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/status");
      setTestResult(res.ok ? "success" : "error");
    } catch {
      setTestResult("error");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 border border-blue-500/30">
            <Wifi className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Connect Microsoft 365</h2>
            <p className="text-xs text-slate-400">Most important integration</p>
          </div>
        </div>
        <p className="text-sm text-slate-400 leading-relaxed">
          This gives you M365 license data, Intune device inventory, and enables single sign-on across the dashboard.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-slate-300">Tenant ID</Label>
          <Input
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={settings.tenantId}
            onChange={e => onChange({ tenantId: e.target.value })}
            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-600 font-mono text-xs h-9"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-slate-300">Client ID (Application ID)</Label>
          <Input
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={settings.clientId}
            onChange={e => onChange({ clientId: e.target.value })}
            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-600 font-mono text-xs h-9"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-slate-300">Client Secret</Label>
          <Input
            type="password"
            placeholder="Your client secret value"
            value={settings.clientSecret}
            onChange={e => onChange({ clientSecret: e.target.value })}
            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-600 text-xs h-9"
          />
          <p className="text-[11px] text-slate-500">
            Note: secrets are saved to localStorage — do not use this on a shared machine in production.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={handleTest}
          disabled={testing}
          variant="ghost"
          className="border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 text-xs h-8 px-3"
        >
          {testing ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5 mr-1.5" />}
          Test Connection
        </Button>
        {testResult === "success" && (
          <span className="flex items-center gap-1 text-xs text-teal-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Connected
          </span>
        )}
        {testResult === "error" && (
          <span className="flex items-center gap-1 text-xs text-red-400">
            <AlertTriangle className="h-3.5 w-3.5" /> Connection failed
          </span>
        )}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
        <Button onClick={onBack} variant="ghost" className="text-slate-400 hover:text-white text-xs h-8 px-3">
          <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <div className="flex items-center gap-3">
          <button onClick={onSkip} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
            Skip for now
          </button>
          <Button onClick={onNext} className="bg-teal-600 hover:bg-teal-500 text-white text-xs h-8 px-4">
            Continue <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// Step 3: Business Central
function BusinessCentralStep({
  settings,
  onChange,
  onNext,
  onBack,
  onSkip,
}: {
  settings: WizardSettings;
  onChange: (patch: Partial<WizardSettings>) => void;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30">
            <Database className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Connect Business Central</h2>
            <p className="text-xs text-slate-400">Financial data source</p>
          </div>
        </div>
        <p className="text-sm text-slate-400 leading-relaxed">
          Pulls invoices, GL entries, and budget data from your Business Central environment.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-slate-300">Environment Name</Label>
          <Input
            placeholder="e.g. production"
            value={settings.bcEnvironment}
            onChange={e => onChange({ bcEnvironment: e.target.value })}
            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-600 text-xs h-9"
          />
        </div>
      </div>

      <div className="rounded-lg bg-slate-800/60 border border-slate-700 px-4 py-3">
        <p className="text-xs text-slate-400 leading-relaxed">
          <span className="font-semibold text-slate-300">Uses the same app registration as M365.</span>{" "}
          The Tenant ID, Client ID, and Client Secret configured in the previous step are reused here.
          Make sure the app registration has the{" "}
          <code className="text-teal-300 bg-slate-900 px-1 py-0.5 rounded text-[11px]">Financials.ReadWrite.All</code>{" "}
          permission and is registered in Business Central under Entra Applications.
        </p>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
        <Button onClick={onBack} variant="ghost" className="text-slate-400 hover:text-white text-xs h-8 px-3">
          <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <div className="flex items-center gap-3">
          <button onClick={onSkip} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
            Skip for now
          </button>
          <Button onClick={onNext} className="bg-teal-600 hover:bg-teal-500 text-white text-xs h-8 px-4">
            Continue <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// Step 4: Optional integrations
function OptionalStep({
  settings,
  onChange,
  onNext,
  onBack,
}: {
  settings: WizardSettings;
  onChange: (patch: Partial<WizardSettings>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/15 border border-purple-500/30">
            <Layers className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Optional Integrations</h2>
            <p className="text-xs text-slate-400">All optional — connect what you use</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {/* Jira */}
        <div className={cn(
          "rounded-lg border px-4 py-3 flex flex-col gap-3 transition-colors",
          settings.jiraEnabled ? "border-purple-500/30 bg-purple-500/5" : "border-slate-700 bg-slate-800/40"
        )}>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.jiraEnabled}
              onChange={e => onChange({ jiraEnabled: e.target.checked })}
              className="h-4 w-4 rounded border-slate-600 bg-slate-700 accent-purple-500"
            />
            <div>
              <span className="text-sm font-semibold text-white">Jira Cloud</span>
              <p className="text-xs text-slate-400">IT project costs and ticket data</p>
            </div>
          </label>
          {settings.jiraEnabled && (
            <div className="flex flex-col gap-2 pl-7">
              <Input
                placeholder="Base URL (e.g. https://yourorg.atlassian.net)"
                value={settings.jiraBaseUrl}
                onChange={e => onChange({ jiraBaseUrl: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white placeholder:text-slate-600 text-xs h-8"
              />
              <Input
                type="password"
                placeholder="API Token"
                value={settings.jiraApiToken}
                onChange={e => onChange({ jiraApiToken: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white placeholder:text-slate-600 text-xs h-8"
              />
            </div>
          )}
        </div>

        {/* Officient HR */}
        <div className={cn(
          "rounded-lg border px-4 py-3 flex flex-col gap-3 transition-colors",
          settings.officientEnabled ? "border-blue-500/30 bg-blue-500/5" : "border-slate-700 bg-slate-800/40"
        )}>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.officientEnabled}
              onChange={e => onChange({ officientEnabled: e.target.checked })}
              className="h-4 w-4 rounded border-slate-600 bg-slate-700 accent-blue-500"
            />
            <div>
              <span className="text-sm font-semibold text-white">Officient HR</span>
              <p className="text-xs text-slate-400">Headcount and personnel data</p>
            </div>
          </label>
          {settings.officientEnabled && (
            <div className="pl-7">
              <Input
                placeholder="Client ID"
                value={settings.officientClientId}
                onChange={e => onChange({ officientClientId: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white placeholder:text-slate-600 text-xs h-8"
              />
            </div>
          )}
        </div>

        {/* Samsung Knox */}
        <div className={cn(
          "rounded-lg border px-4 py-3 flex flex-col gap-3 transition-colors",
          settings.knoxEnabled ? "border-amber-500/30 bg-amber-500/5" : "border-slate-700 bg-slate-800/40"
        )}>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.knoxEnabled}
              onChange={e => onChange({ knoxEnabled: e.target.checked })}
              className="h-4 w-4 rounded border-slate-600 bg-slate-700 accent-amber-500"
            />
            <div>
              <span className="text-sm font-semibold text-white">Samsung Knox</span>
              <p className="text-xs text-slate-400">Mobile device management</p>
            </div>
          </label>
          {settings.knoxEnabled && (
            <div className="pl-7">
              <Input
                placeholder="Knox Client ID"
                value={settings.knoxClientId}
                onChange={e => onChange({ knoxClientId: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white placeholder:text-slate-600 text-xs h-8"
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
        <Button onClick={onBack} variant="ghost" className="text-slate-400 hover:text-white text-xs h-8 px-3">
          <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <Button onClick={onNext} className="bg-teal-600 hover:bg-teal-500 text-white text-xs h-8 px-4">
          Continue <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// Step 5: Done
function DoneStep({
  settings,
  onFinish,
}: {
  settings: WizardSettings;
  onFinish: () => void;
}) {
  const connected: string[] = [];
  if (settings.tenantId && settings.clientId) connected.push("Microsoft 365 / Entra ID");
  if (settings.bcEnvironment) connected.push("Business Central");
  if (settings.jiraEnabled && settings.jiraBaseUrl) connected.push("Jira Cloud");
  if (settings.officientEnabled && settings.officientClientId) connected.push("Officient HR");
  if (settings.knoxEnabled && settings.knoxClientId) connected.push("Samsung Knox");

  return (
    <div className="flex flex-col items-center text-center gap-6">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-500/15 border border-teal-500/30">
        <CheckCircle2 className="h-8 w-8 text-teal-400" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-white">You&apos;re all set!</h2>
        <p className="mt-2 text-sm text-slate-400 max-w-sm mx-auto leading-relaxed">
          {connected.length > 0
            ? "Here&apos;s a summary of what you configured:"
            : "No integrations were configured. The dashboard will use demo data."}
        </p>
      </div>

      {connected.length > 0 && (
        <div className="w-full max-w-sm flex flex-col gap-2">
          {connected.map(name => (
            <div key={name} className="flex items-center gap-2.5 rounded-lg bg-teal-500/10 border border-teal-500/20 px-3 py-2">
              <CheckCircle2 className="h-4 w-4 text-teal-400 shrink-0" />
              <span className="text-sm text-teal-300 font-medium">{name}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500 max-w-xs">
        You can always add more integrations in{" "}
        <span className="text-slate-400 font-medium">Settings → General</span>.
      </p>

      <Button
        onClick={onFinish}
        className="bg-teal-600 hover:bg-teal-500 text-white h-11 text-sm font-semibold w-full max-w-sm"
      >
        <LayoutDashboard className="h-4 w-4 mr-2" />
        Go to Dashboard
      </Button>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export function SetupWizard({ onComplete }: { onComplete?: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<WizardSettings>(loadWizardSettings);

  function patchSettings(patch: Partial<WizardSettings>) {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      saveWizardSettings(next);
      return next;
    });
  }

  function handleFinish() {
    markSetupComplete();
    onComplete?.();
    router.push("/");
  }

  function handleDemoMode() {
    markSetupComplete();
    onComplete?.();
    router.push("/");
  }

  function handleSkip() {
    setStep(prev => Math.min(prev + 1, STEP_COUNT - 1));
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Card */}
        <div className="relative rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
          {/* Skip button (top-right) — not shown on first or last step */}
          {step > 0 && step < STEP_COUNT - 1 && (
            <button
              onClick={handleFinish}
              className="absolute right-4 top-4 text-slate-500 hover:text-slate-300 transition-colors z-10"
              title="Skip setup"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          <div className="p-8">
            <StepIndicator current={step} />

            {step === 0 && (
              <WelcomeStep onDemo={handleDemoMode} onContinue={() => setStep(1)} />
            )}
            {step === 1 && (
              <M365Step
                settings={settings}
                onChange={patchSettings}
                onNext={() => setStep(2)}
                onBack={() => setStep(0)}
                onSkip={handleSkip}
              />
            )}
            {step === 2 && (
              <BusinessCentralStep
                settings={settings}
                onChange={patchSettings}
                onNext={() => setStep(3)}
                onBack={() => setStep(1)}
                onSkip={handleSkip}
              />
            )}
            {step === 3 && (
              <OptionalStep
                settings={settings}
                onChange={patchSettings}
                onNext={() => setStep(4)}
                onBack={() => setStep(2)}
              />
            )}
            {step === 4 && (
              <DoneStep settings={settings} onFinish={handleFinish} />
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="mt-4 text-center text-xs text-slate-600">
          IT Finance Dashboard &mdash; First-run setup
        </p>
      </div>
    </div>
  );
}
