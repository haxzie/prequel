"use client";

import { useState } from "react";

import { Button } from "@/components/Button";

/**
 * The share link, and the two ways of taking it somewhere.
 *
 * Renaming and deleting used to live here too. They belong to the recording
 * rather than to its link, and they are now beside the title at the top of the
 * page where the recording is named — which left this as the one thing it is.
 */
export function VideoActions({ url, className = "" }: { url: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <code className="min-w-0 flex-1 truncate rounded-full border border-line bg-surface px-5 py-2.5 font-mono text-xs text-muted">
        {url}
      </code>
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </Button>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-fg"
      >
        Open
      </a>
    </div>
  );
}
