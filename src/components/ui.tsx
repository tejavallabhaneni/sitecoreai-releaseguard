"use client";

import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      className={cn(
        // Blok button: pill shape, semibold. Solid violet primary; outlined secondary and danger.
        "inline-flex items-center justify-center gap-1.5 rounded-full border border-transparent font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "min-h-8 px-3.5 text-[13px]" : "min-h-10 px-5 text-sm",
        variant === "primary" && "bg-brand text-white hover:bg-brand-hover",
        variant === "secondary" && "border-line bg-surface text-muted hover:bg-canvas hover:text-ink",
        variant === "ghost" && "text-muted hover:bg-canvas hover:text-ink",
        variant === "danger" && "border-error bg-surface text-error hover:bg-error-soft",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("rounded-lg border border-transparent bg-surface shadow-[0_1px_2px_0_rgb(0_0_0/0.05)]", className)}>{children}</section>
  );
}

export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: ReactNode }) {
  return (
    <div className="mb-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-navy">
        {children}
      </label>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-control bg-surface px-2.5 text-sm text-ink placeholder:text-subtle focus:border-brand focus:ring-1 focus:ring-brand focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-control bg-surface px-2 text-sm text-ink focus:border-brand focus:ring-1 focus:ring-brand focus:outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5", disabled && "cursor-not-allowed opacity-50")}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {description ? <span className="block text-xs text-muted">{description}</span> : null}
      </span>
    </label>
  );
}

export function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors",
        active ? "border-transparent bg-brand-soft text-brand-ink" : "border-line bg-surface text-muted hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

export const SEVERITY_STYLE: Record<Severity, { label: string; text: string; bg: string; Icon: typeof AlertCircle }> = {
  error: { label: "Error", text: "text-error", bg: "bg-error-soft", Icon: AlertCircle },
  warning: { label: "Warning", text: "text-warning", bg: "bg-warning-soft", Icon: AlertTriangle },
  info: { label: "Info", text: "text-info", bg: "bg-info-soft", Icon: Info },
};

export function SeverityIcon({ severity, className }: { severity: Severity; className?: string }) {
  const { Icon, text, label } = SEVERITY_STYLE[severity];
  return <Icon aria-label={label} className={cn("size-4 shrink-0", text, className)} />;
}

export function CountPill({ severity, count }: { severity: Severity; count: number }) {
  if (!count) return null;
  const s = SEVERITY_STYLE[severity];
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-xs font-semibold tabular-nums", s.bg, s.text)}>
      {count}
    </span>
  );
}
