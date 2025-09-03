import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Currency formatting — Belgian EUR format (€ 1.234,56)
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("nl-BE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Compact currency for KPI cards (€ 12.3K, € 1.2M)
export function formatCurrencyCompact(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) {
    return `€ ${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(amount) >= 1_000) {
    return `€ ${(amount / 1_000).toFixed(1)}K`;
  }
  return formatCurrency(amount);
}

// Format percentage
export function formatPercent(value: number, decimals = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

// Format date in Belgian format
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat("nl-BE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

// Get month name from "2025-01" format
export function getMonthName(monthStr: string): string {
  const [year, month] = monthStr.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString("en-US", { month: "short" });
}

// Get full month label from "2025-01" format
export function getMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

// Variance status color
export function getVarianceStatus(variancePercent: number): "green" | "amber" | "red" {
  const abs = Math.abs(variancePercent);
  if (abs <= 5) return "green";
  if (abs <= 10) return "amber";
  return "red";
}

// Generate a simple hash for IDs
export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}
