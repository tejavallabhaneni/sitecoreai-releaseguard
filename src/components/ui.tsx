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
        // Button: 2px border, 5px radius, bold, underline on hover.
        "inline-flex items-center justify-center gap-1.5 rounded-[5px] border-2 border-transparent font-bold whitespace-nowrap underline-offset-3 transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:no-underline",
        size === "sm" ? "min-h-8 px-3 text-[13px]" : "min-h-10 px-5 text-sm",
        variant === "primary" && "bg-brand text-white hover:bg-brand-hover",
        variant === "secondary" && "border-navy bg-surface text-navy hover:border-navy-hover hover:bg-navy-hover hover:text-white",
        variant === "ghost" && "text-navy hover:bg-canvas",
        variant === "danger" && "border-brand bg-surface text-brand hover:border-brand-hover hover:bg-brand-hover hover:text-white",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("rounded-[5px] border border-line bg-surface", className)}>{children}</section>;
}

export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: ReactNode }) {
  return (
    <div className="mb-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-bold text-navy">
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
        "h-9 w-full rounded-[5px] border border-control bg-surface px-2.5 text-sm text-ink placeholder:text-subtle focus:border-info focus:outline-none",
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
        "h-9 w-full rounded-[5px] border border-control bg-surface px-2 text-sm text-ink focus:border-info focus:outline-none",
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
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-navy)]"
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
        active ? "border-navy bg-brand-soft text-navy" : "border-control bg-surface text-muted hover:text-navy",
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
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11px] font-semibold tabular-nums", s.bg, s.text)}>
      {count}
    </span>
  );
}
