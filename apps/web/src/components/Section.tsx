import type { ReactNode } from "react";

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 font-mono text-xs tracking-[0.18em] text-muted uppercase">{children}</p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
  align = "left",
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: "left" | "centre";
}) {
  const centred = align === "centre";
  return (
    <div className={`max-w-2xl ${centred ? "mx-auto text-center" : ""}`}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      {/* The leading relaxes only where a chipped word is present, which is the
          same `has-` variant the hero uses and for the same reason: a chip is a
          box around a word, and at the heading's default line height two
          chipped lines sit close enough to touch. A heading of plain words is
          left exactly as it was. */}
      <h2 className="text-3xl font-medium tracking-tight text-balance text-fg has-[[data-heading-chip]]:leading-[1.35] sm:text-4xl">
        {title}
      </h2>
      {lede ? <p className="mt-4 text-lg leading-relaxed text-pretty text-muted">{lede}</p> : null}
    </div>
  );
}
