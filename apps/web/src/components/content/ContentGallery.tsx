"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import type { LibraryItem, LibraryKind } from "@/content/library";
import { TOPIC_KEYS, TOPICS, isTopic, type Topic } from "@/content/topics";

type TypeFilter = "all" | LibraryKind;
type TopicFilter = "all" | Topic;

/**
 * The two kinds of page, in the order the results column shows them. The
 * label is the card's pill and the sidebar's row; the heading is what the
 * section is called when both kinds are on the page.
 */
const KINDS: { key: LibraryKind; label: string; heading: string }[] = [
  { key: "article", label: "Article", heading: "Articles" },
  { key: "glossary", label: "Glossary", heading: "Glossary" },
];

function isKind(value: string): value is LibraryKind {
  return KINDS.some((kind) => kind.key === value);
}

/**
 * The gallery: a sidebar of filters and the cards they select from.
 *
 * Every card is in the HTML. The filters hide cards rather than fetch them,
 * so the page is prerendered once, a crawler sees all fourteen links, and a
 * click on a filter costs nothing but a re-render. A server-rendered filter —
 * `searchParams` read in the page — would make the route dynamic, and then
 * every visit renders on a function for a list that changes when a file is
 * committed.
 *
 * The URL carries the state, and the page is rendered as though it did not.
 * The server renders every card with no filter applied; after hydration the
 * component reads `window.location.search` once and applies what it finds.
 * Not `useSearchParams`: on a static route that hook makes Next prerender
 * only the `Suspense` fallback and draw the rest in the browser, and the
 * built HTML of this page had no cards in it at all. A reader who opens a
 * shared `?type=glossary` link sees the full list for one frame and then
 * the filtered one, which is the cost of having the list in the HTML.
 *
 * `history.replaceState` writes the URL, so a filtered view is a link that
 * can be sent and the back button does not step through every filter a
 * reader tried. Not `router.replace`: the router would fetch the page's RSC
 * payload again for a change the server has no part in.
 *
 * Both filters are single-select. A multi-select topic filter is the right
 * shape for a hundred pages; for fourteen it is a row of checkboxes that
 * mostly select everything, and the URL that describes it is one nobody
 * would type. One type, one topic, either can be "all".
 */
export function ContentGallery({ items }: { items: LibraryItem[] }) {
  const [type, setType] = useState<TypeFilter>("all");
  const [topic, setTopic] = useState<TopicFilter>("all");

  // Once, after hydration, and again if the reader goes back or forward to a
  // different query on this page. The first render matches the server's
  // unfiltered one, so there is nothing for hydration to disagree with.
  useEffect(() => {
    function read() {
      const params = new URLSearchParams(window.location.search);
      const rawType = params.get("type") ?? "all";
      const rawTopic = params.get("topic") ?? "all";
      // An unknown value in the URL is treated as "all" rather than as an
      // empty result: a typo in a shared link should show the reader the
      // page, not a grid with nothing in it and no way to tell why.
      setType(isKind(rawType) ? rawType : "all");
      setTopic(isTopic(rawTopic) ? rawTopic : "all");
    }
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  function apply(next: { type?: TypeFilter; topic?: TopicFilter }) {
    const nextType = next.type ?? type;
    const nextTopic = next.topic ?? topic;
    setType(nextType);
    setTopic(nextTopic);
    const query = new URLSearchParams();
    // "all" is the absence of a param, so the unfiltered page is `/content`
    // and not `/content?type=all&topic=all`: one canonical address for the
    // page a crawler indexes, and a cleaner link for anyone copying it.
    if (nextType !== "all") query.set("type", nextType);
    if (nextTopic !== "all") query.set("topic", nextTopic);
    const search = query.toString();
    window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname);
  }

  const byTopic = (item: LibraryItem) => topic === "all" || item.topics.includes(topic);
  const byType = (item: LibraryItem) => type === "all" || item.kind === type;

  // Each list's counts respect the other filter, so a row never promises
  // cards the other filter then hides: with "Glossary" selected, the count
  // beside "Captions" is the number of glossary terms about captions.
  const typeCounts = KINDS.map((kind) => ({
    ...kind,
    count: items.filter((item) => item.kind === kind.key && byTopic(item)).length,
  }));
  const topicCounts = TOPIC_KEYS.map((key) => ({
    key,
    label: TOPICS[key],
    count: items.filter((item) => item.topics.includes(key) && byType(item)).length,
  }));

  const shown = items.filter((item) => byType(item) && byTopic(item));
  const sections = KINDS.map((kind) => ({
    ...kind,
    items: shown.filter((item) => item.kind === kind.key),
  })).filter((section) => section.items.length > 0);

  const where = [
    type === "all" ? "Everything" : KINDS.find((kind) => kind.key === type)?.heading,
    topic === "all" ? null : TOPICS[topic],
  ]
    .filter(Boolean)
    .join(" · ");

  const filters = (
    <div className="flex flex-col gap-7">
      <FilterGroup title="Type">
        <FilterButton active={type === "all"} count={items.filter(byTopic).length} onClick={() => apply({ type: "all" })}>
          All
        </FilterButton>
        {typeCounts.map((kind) => (
          <FilterButton
            key={kind.key}
            active={type === kind.key}
            count={kind.count}
            onClick={() => apply({ type: kind.key })}
          >
            {kind.heading}
          </FilterButton>
        ))}
      </FilterGroup>

      <FilterGroup title="Topic">
        <FilterButton active={topic === "all"} count={items.filter(byType).length} onClick={() => apply({ topic: "all" })}>
          All
        </FilterButton>
        {topicCounts.map((entry) => (
          <FilterButton
            key={entry.key}
            active={topic === entry.key}
            count={entry.count}
            onClick={() => apply({ topic: entry.key })}
          >
            {entry.label}
          </FilterButton>
        ))}
      </FilterGroup>
    </div>
  );

  return (
    <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
      {/* The filters, twice: sticky on the left from `lg`, and folded into a
          disclosure above the cards below it. The same `<details>` the docs
          sidebar uses, and for the same reason it is not a client-side menu:
          it opens and closes on its own, and it needs no state of ours. */}
      <details className="group rounded-2xl border border-line bg-elevated lg:hidden">
        <summary className="flex cursor-pointer items-center justify-between px-5 py-3.5 text-sm font-medium text-fg marker:content-none [&::-webkit-details-marker]:hidden">
          <span>
            <span className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Filter</span>
            <span className="mx-2 text-muted" aria-hidden>
              ·
            </span>
            {where}
          </span>
          <span aria-hidden className="text-muted transition-transform group-open:rotate-180">
            ⌄
          </span>
        </summary>
        <div className="border-t border-line px-3 py-3">{filters}</div>
      </details>

      <nav
        aria-label="Filters"
        className="hidden self-start lg:sticky lg:top-8 lg:block lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto"
      >
        {filters}
      </nav>

      <div className="min-w-0">
        {/* Announced, so a screen reader hears the result of a filter without
            being sent back to the top of the grid to count it. */}
        <p aria-live="polite" className="font-mono text-xs tracking-wide text-muted">
          {shown.length} {shown.length === 1 ? "page" : "pages"}
        </p>

        {sections.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-line bg-surface px-6 py-12 text-center">
            <p className="text-fg">Nothing filed here yet.</p>
            <p className="mt-2 text-sm text-muted">Try another topic, or show everything.</p>
            <button
              type="button"
              onClick={() => apply({ type: "all", topic: "all" })}
              className="lit mt-6 inline-flex h-9 items-center rounded-full border border-line bg-elevated px-4 text-sm font-medium text-fg transition-colors hover:border-muted/40 hover:bg-surface"
            >
              Show everything
            </button>
          </div>
        ) : (
          sections.map((section, i) => (
            <section key={section.key} className={i === 0 ? "mt-6" : "mt-14"}>
              <h2 className="text-2xl font-medium tracking-tight text-fg">{section.heading}</h2>

              {/* Bordered cards with a gap rather than the `gap-px` stack the
                  blog index uses. A filtered grid ends mid-row nearly every
                  time, and a `bg-line` parent showing through the gaps also
                  shows through the cells no card landed in. The note in
                  `usecases/page.tsx` is the same one. */}
              <ul className="mt-5 grid gap-4 sm:grid-cols-2">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="group flex h-full flex-col rounded-2xl border border-line bg-surface p-6 transition-colors hover:border-muted/40 hover:bg-elevated"
                    >
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] tracking-wide text-muted">
                        <span className="rounded-full border border-line bg-elevated px-2.5 py-1 transition-colors group-hover:bg-surface">
                          {section.label}
                        </span>
                        {item.topics.map((key) => (
                          <span key={key}>{TOPICS[key]}</span>
                        ))}
                      </div>
                      <h3 className="mt-4 text-[0.9375rem] font-medium text-balance text-fg">
                        {item.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-pretty text-muted">
                        {item.summary}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 px-2.5 font-mono text-xs tracking-[0.18em] text-muted uppercase">{title}</p>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

function FilterButton({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        // The same row the docs sidebar draws, told apart by a fill rather than
        // by colour alone, and a `<button>` rather than a `Link` because a
        // filter changes this page rather than leaving it. A row with nothing
        // behind it is still clickable: the empty state it leads to says why.
        className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
          active ? "bg-fg/8 text-fg" : "text-muted hover:bg-fg/8 hover:text-fg"
        }`}
      >
        <span>{children}</span>
        <span className="font-mono text-[11px] tabular-nums">{count}</span>
      </button>
    </li>
  );
}
