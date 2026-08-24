import Link from "next/link";
import type { Route } from "next";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const VARIANTS: Record<Variant, string> = {
  // White on a dark page is the loudest a button gets, so the brand gradient is
  // left to the surfaces it decorates rather than competing with every action.
  primary: "bg-white text-bg hover:bg-white/90",
  secondary: "lit border border-line bg-elevated text-fg hover:border-muted/40 hover:bg-surface",
  ghost: "text-muted hover:text-fg",
  // Destroying something. A variant rather than a `className` on a primary
  // button: both would be plain utilities of the same specificity, so which
  // background won would come down to their order in the generated stylesheet
  // rather than the order they were written in — which is how the delete button
  // came out white with white text on it.
  danger: "bg-brand-from text-white hover:bg-brand-from/90",
};

const SIZES = { sm: "h-9 px-4", md: "h-11 px-6" } as const;

type Common = { variant?: Variant; size?: keyof typeof SIZES; className?: string };

export function ButtonLink({
  href,
  children,
  variant = "primary",
  size = "md",
  className = "",
}: Common & { href: Route | `#${string}`; children: ReactNode }) {
  return (
    <Link href={href} className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}>
      {children}
    </Link>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: Common & ComponentProps<"button">) {
  return (
    <button className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...props}>
      {children}
    </button>
  );
}
