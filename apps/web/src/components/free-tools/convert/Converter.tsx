"use client";

/**
 * One converter, rendered by every `<from>-to-<to>` page.
 *
 * The pair comes off the registry, so `/free-tools/mov-to-mp4` and
 * `/free-tools/video-to-mp3` are this component with two different props. That
 * is the point of the set: the pages differ in what they say, which is what a
 * search engine and a reader both care about, and not in what they do.
 *
 * No rail. The other tools have one because they have settings; a converter has
 * a file and a button, and a panel of nothing beside it would be furniture.
 */

import { AudioLines, Download, FileVideo, RotateCcw, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { convertedName, FORMATS, type FormatId } from "@/lib/free-tools/formats";
import { formatSize } from "@/lib/free-tools/recording";

import { DownloadDialog } from "../DownloadDialog";
import { convert, type Progress } from "./engine";

/**
 * The largest file worth starting.
 *
 * ffmpeg.wasm runs in a 32-bit address space, so the input, the output and the
 * encoder's own working memory all share about 2GB. 300MB of input is where a
 * long transcode starts failing part way through, and failing after four
 * minutes of work is worse than refusing in the first second.
 */
const MAX_BYTES = 300_000_000;

type Stage = "empty" | "ready" | "working" | "done" | "failed";

type Done = { url: string; name: string; size: number; rewrapped: boolean };

export function Converter({ from, to }: { from: FormatId; to: FormatId }): ReactNode {
  const source = FORMATS[from];
  const target = FORMATS[to];

  const [stage, setStage] = useState<Stage>("empty");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<Progress>({ stage: "loading", ratio: 0 });
  const [result, setResult] = useState<Done | null>(null);
  const [error, setError] = useState("");
  const [pitching, setPitching] = useState(false);
  const [dragging, setDragging] = useState(false);

  const fileRef = useRef<HTMLInputElement | null>(null);
  /** The last line ffmpeg printed, kept for the message when a run fails. */
  const lastLog = useRef("");

  // The object URL is handed back when the result is replaced or the component
  // goes away. Without this a visitor converting six files leaves six of them
  // held in the tab.
  useEffect(() => {
    const url = result?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [result?.url]);

  const take = useCallback((incoming: File | null | undefined) => {
    if (!incoming) return;

    if (incoming.size > MAX_BYTES) {
      setError(
        `That file is ${formatSize(incoming.size)}. The converter runs inside this tab, which gives it about 300 MB to work in, so anything larger has to be converted on your machine.`,
      );
      setStage("failed");
      return;
    }

    setError("");
    setFile(incoming);
    setResult(null);
    setStage("ready");
  }, []);

  const run = useCallback(async () => {
    if (!file) return;

    setStage("working");
    setError("");
    setProgress({ stage: "loading", ratio: 0 });

    try {
      const { blob, rewrapped } = await convert({
        file,
        from,
        to,
        onProgress: setProgress,
        onLog: (line) => {
          lastLog.current = line;
        },
      });

      setResult({
        url: URL.createObjectURL(blob),
        name: convertedName(file.name, target.extension),
        size: blob.size,
        rewrapped,
      });
      setStage("done");
    } catch (thrown) {
      setError(
        thrown instanceof Error
          ? thrown.message
          : "The conversion stopped. Try again, or try a smaller file.",
      );
      setStage("failed");
    }
  }, [file, from, target.extension, to]);

  const reset = () => {
    setFile(null);
    setResult(null);
    setError("");
    setStage("empty");
  };

  return (
    <>
      <div
        className="editor-theme squircle dot-grid relative flex min-h-[26rem] flex-col overflow-hidden rounded-3xl bg-editor-bg ring-1 ring-black/20"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          take(event.dataTransfer.files[0]);
        }}
      >
        {/* The dashed field is drawn only while something is over the panel.
            A permanent one reads as a form; appearing on the drag is the
            feedback that the drop will land. */}
        {dragging ? (
          <div className="pointer-events-none absolute inset-4 z-20 rounded-2xl border-2 border-dashed border-selected/70 bg-selected/5" />
        ) : null}

        <div className="absolute inset-3 bottom-20 flex items-center justify-center sm:inset-5 sm:bottom-20">
          {stage === "working" ? <Working progress={progress} /> : null}
          {stage === "done" && result ? <Result result={result} target={target.label} /> : null}
          {stage === "empty" || stage === "ready" || stage === "failed" ? (
            <Invitation
              source={source.label}
              target={target.label}
              file={file}
              error={error}
              onPick={() => fileRef.current?.click()}
            />
          ) : null}
        </div>

        {/* The same lane the recorders and the editor put their dock in. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
          <div className="dock-theme pointer-events-auto flex max-w-full items-center gap-2 rounded-[10px] bg-dock-bg p-1.5 text-dock-fg shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
            {stage === "done" && result ? (
              <>
                <span className="truncate px-2 font-mono text-[11px] text-dock-muted">
                  {formatSize(result.size)}
                </span>
                <a
                  href={result.url}
                  download={result.name}
                  onClick={() => setPitching(true)}
                  className="flex h-[30px] flex-none items-center gap-2 rounded-full bg-white px-3.5 text-[13px] font-medium text-black transition-colors hover:bg-white/90"
                >
                  <Download className="size-4" />
                  Download {target.label}
                </a>
                <button
                  type="button"
                  onClick={reset}
                  className="flex h-[30px] flex-none items-center gap-2 rounded-full px-3 text-[13px] font-medium text-dock-fg transition-colors hover:bg-dock-hover"
                >
                  <RotateCcw className="size-4" />
                  Convert another
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={stage === "working"}
                  onClick={() => fileRef.current?.click()}
                  className="flex h-[30px] flex-none items-center gap-2 rounded-full px-3 text-[13px] font-medium text-dock-fg transition-colors hover:bg-dock-hover disabled:opacity-35"
                >
                  <Upload className="size-4" />
                  {file ? "Choose another" : "Choose a file"}
                </button>
                <span className="h-[18px] w-px flex-none self-center bg-dock-line" />
                <button
                  type="button"
                  disabled={!file || stage === "working"}
                  onClick={() => void run()}
                  className="flex h-[30px] flex-none items-center gap-2 rounded-full bg-white px-3.5 text-[13px] font-medium text-black transition-colors hover:bg-white/90 disabled:opacity-35"
                >
                  {target.kind === "audio" ? (
                    <AudioLines className="size-4" />
                  ) : (
                    <FileVideo className="size-4" />
                  )}
                  Convert to {target.label}
                </button>
              </>
            )}
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept={source.accept}
          className="hidden"
          onChange={(event) => take(event.target.files?.[0])}
        />
      </div>

      <DownloadDialog open={pitching} onClose={() => setPitching(false)} />
    </>
  );
}

/** The panel before a file, and after a failure. */
function Invitation({
  source,
  target,
  file,
  error,
  onPick,
}: {
  source: string;
  target: string;
  file: File | null;
  error: string;
  onPick: () => void;
}) {
  return (
    <div className="flex max-w-md flex-col items-center gap-4 px-4 py-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-white/5 text-editor-muted ring-1 ring-white/10">
        <Upload className="size-7" strokeWidth={1.5} />
      </span>

      {file ? (
        <>
          <h2 className="max-w-full truncate text-lg font-medium text-editor-fg">{file.name}</h2>
          <p className="font-mono text-xs text-editor-muted">{formatSize(file.size)}</p>
        </>
      ) : (
        <>
          <h2 className="text-lg font-medium text-editor-fg">
            Drop {source === "Video" ? "a video" : `a ${source}`} in
          </h2>
          <p className="text-sm leading-relaxed text-pretty text-editor-muted">
            Drag a file onto this panel or open one. It is converted to {target} in this tab, on
            your own machine, and never uploaded.
          </p>
        </>
      )}

      {error ? (
        <p role="alert" className="max-w-sm text-sm leading-relaxed text-pretty text-negative">
          {error}
        </p>
      ) : null}

      {!file ? (
        <button
          type="button"
          onClick={onPick}
          className="mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-medium text-black transition-colors hover:bg-white/90"
        >
          Choose a file
        </button>
      ) : null}
    </div>
  );
}

/**
 * What the wait looks like.
 *
 * Two stages, named, because they are different waits and a single spinner over
 * both is how a 32MB download reads as a hung page. The first has no percentage
 * to give — `load` reports nothing until the wasm is compiled — so it says what
 * it is doing and how big it is instead of drawing a bar that does not move.
 */
function Working({ progress }: { progress: Progress }) {
  const loading = progress.stage === "loading";

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4 px-4 text-center">
      <p className="text-lg font-medium text-editor-fg">
        {loading ? "Starting the converter" : "Converting"}
      </p>
      <p className="text-sm leading-relaxed text-pretty text-editor-muted">
        {loading
          ? "Fetching the 32 MB encoder, once per visit. Everything after this is instant to start."
          : "Running on your own machine, so this takes about as long as the clip itself. Leave the tab open."}
      </p>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full bg-white/70 ${loading ? "w-1/3 animate-pulse" : "transition-[width] duration-200"}`}
          style={loading ? undefined : { width: `${Math.round(progress.ratio * 100)}%` }}
        />
      </div>

      {!loading ? (
        <p className="font-mono text-xs text-editor-muted tabular-nums">
          {Math.round(progress.ratio * 100)}%
        </p>
      ) : null}
    </div>
  );
}

/** The file, once there is one. */
function Result({ result, target }: { result: Done; target: string }) {
  return (
    <div className="flex max-w-md flex-col items-center gap-3 px-4 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-white/5 text-editor-fg ring-1 ring-white/10">
        <Download className="size-7" strokeWidth={1.5} />
      </span>
      <h2 className="max-w-full truncate text-lg font-medium text-editor-fg">{result.name}</h2>
      <p className="font-mono text-xs text-editor-muted">
        {target} · {formatSize(result.size)}
      </p>
      {/* Said out loud, because it is the surprising part: a rewrap finishes in
          about a second and people assume something went wrong. */}
      {result.rewrapped ? (
        <p className="max-w-sm text-sm leading-relaxed text-pretty text-editor-muted">
          The video and the sound were already in the right codecs, so they were rewrapped rather
          than re-encoded. Nothing was lost and nothing was re-compressed.
        </p>
      ) : null}
    </div>
  );
}
