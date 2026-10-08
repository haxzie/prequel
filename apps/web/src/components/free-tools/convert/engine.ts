"use client";

/**
 * ffmpeg, in the tab.
 *
 * The whole converter is this: 32MB of WebAssembly that reads a file out of the
 * page's memory, writes another one back, and never touches the network. Every
 * other online converter uploads the file, converts it on a server and hands
 * back a link that expires, which is why they all have a privacy policy and we
 * have a sentence.
 *
 * The cost is honest and is stated on the page: the core is a 32MB download the
 * first time, and encoding runs on one thread at maybe a tenth of what the same
 * ffmpeg would do natively. The copy says so, and the tool is still the fastest
 * path for the thing people actually come for, which is a two minute clip.
 *
 * Served from `/ffmpeg` on our own origin rather than from unpkg: a third party
 * in the request path is exactly the thing the tool claims not to have. See
 * `scripts/copy-ffmpeg.mjs` for how it gets there.
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

import { conversionArgs, FORMATS, type FormatId } from "@/lib/free-tools/formats";

/**
 * One instance per tab, loaded once.
 *
 * Module scope rather than a ref, so converting a second file reuses the core
 * rather than fetching 32MB again. The promise itself is the lock: two clicks
 * before it settles await the same load instead of starting two.
 */
let loading: Promise<FFmpeg> | null = null;

export type Progress = { stage: "loading" | "converting"; ratio: number };

export async function loadFFmpeg(onProgress?: (progress: Progress) => void): Promise<FFmpeg> {
  if (loading) return loading;

  loading = (async () => {
    const ffmpeg = new FFmpeg();

    // `load` resolves once the wasm is compiled; the download is the long part
    // and reports nothing, so the page shows an indeterminate state for it
    // rather than a lying percentage.
    onProgress?.({ stage: "loading", ratio: 0 });
    await ffmpeg.load({
      coreURL: "/ffmpeg/ffmpeg-core.js",
      wasmURL: "/ffmpeg/ffmpeg-core.wasm",
    });
    return ffmpeg;
  })();

  try {
    return await loading;
  } catch (error) {
    // Cleared, or a failed load would be remembered for the life of the tab and
    // every retry would resolve to the same rejection.
    loading = null;
    throw error;
  }
}

export type ConversionResult = {
  blob: Blob;
  /** Which path produced it, so the page can say the rewrap was instant. */
  rewrapped: boolean;
};

/**
 * Convert one file.
 *
 * The two-attempt shape is deliberate and is where most of the speed comes
 * from: a Mac screen recording is an MOV holding H.264 and AAC, which is the
 * inside of an MP4 already, so `-c copy` rewrites the container in about a
 * second and loses nothing at all. When that fails — ProRes in the MOV, DivX in
 * an AVI — the exit code is non-zero and nothing has been written, so the real
 * encode runs after it.
 */
export async function convert({
  file,
  from,
  to,
  onProgress,
  onLog,
}: {
  file: File;
  from: FormatId;
  to: FormatId;
  onProgress?: (progress: Progress) => void;
  onLog?: (line: string) => void;
}): Promise<ConversionResult> {
  const ffmpeg = await loadFFmpeg(onProgress);

  const input = `input.${file.name.split(".").pop()?.toLowerCase() || "bin"}`;
  const output = `output.${FORMATS[to].extension}`;
  const { copy, transcode } = conversionArgs(from, to, input, output);

  const progress = ({ progress: ratio }: { progress: number }) =>
    onProgress?.({ stage: "converting", ratio: Math.min(1, Math.max(0, ratio)) });
  const log = ({ message }: { message: string }) => onLog?.(message);

  ffmpeg.on("progress", progress);
  ffmpeg.on("log", log);

  try {
    await ffmpeg.writeFile(input, await fetchFile(file));

    let rewrapped = false;
    let code = copy ? await ffmpeg.exec(copy) : 1;
    if (code === 0) rewrapped = true;
    else {
      onProgress?.({ stage: "converting", ratio: 0 });
      code = await ffmpeg.exec(transcode);
    }

    if (code !== 0) {
      throw new Error(
        "ffmpeg could not read that file. It may be damaged, or it may be a format this build does not cover.",
      );
    }

    const data = await ffmpeg.readFile(output);
    // `readFile` hands back a `Uint8Array` for a binary read. The cast is to
    // `BlobPart` rather than to a buffer type, because its `ArrayBufferLike` is
    // not necessarily an `ArrayBuffer` under the compiler's lib.
    const blob = new Blob([data as BlobPart], { type: mimeFor(to) });

    // Both files are removed before the next conversion: MEMFS is a RAM disk,
    // and a 200MB input left in it is 200MB the next conversion cannot have.
    await ffmpeg.deleteFile(input).catch(() => {});
    await ffmpeg.deleteFile(output).catch(() => {});

    return { blob, rewrapped };
  } finally {
    ffmpeg.off("progress", progress);
    ffmpeg.off("log", log);
  }
}

function mimeFor(id: FormatId): string {
  switch (id) {
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "wav":
      return "audio/wav";
    case "webm":
      return "video/webm";
    default:
      return "video/mp4";
  }
}
