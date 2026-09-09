import { Container } from "./Section";

/**
 * The in-page nav for a long page of sections.
 *
 * Plain `<a href="#id">` and no scroll-spy. Highlighting the section you are in
 * needs `"use client"` and an `IntersectionObserver` on a page that is otherwise
 * static all the way down, which is a hydration boundary and an observer running
 * for the length of the visit in exchange for a colour change.
 *
 * Smooth scrolling comes from `html { scroll-behavior: smooth }` in
 * `globals.css`. Every target carries `scroll-mt-20`, because this bar is
 * sticky and a section that scrolls to `top: 0` lands underneath it.
 *
 * `overflow-x-auto` rather than a wrap: five pills fit on a phone only just, and
 * a rail that becomes two rows moves the content under it by its own height on
 * exactly the widths where that is most annoying.
 */
export function AnchorRail({ items }: { items: { id: string; label: string }[] }) {
  return (
    <div className="sticky top-0 z-20 border-y border-line bg-bg/85 backdrop-blur-md">
      <Container className="flex gap-2 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="shrink-0 rounded-full border border-line bg-surface px-4 py-1.5 text-sm text-muted transition-colors hover:border-muted/40 hover:text-fg"
          >
            {item.label}
          </a>
        ))}
      </Container>
    </div>
  );
}
