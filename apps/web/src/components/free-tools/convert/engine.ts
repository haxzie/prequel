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
 * The core comes from R2 on our own domain rather than from unpkg — a third
 * party in the request path is exactly the thing the tool claims not to have.
 * See `lib/free-tools/ffmpeg-core.ts` for why it is not in `public/` any more.
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

import { FFMPEG_CORE_BASE, FFMPEG_CORE_FILES } from "@/lib/free-tools/ffmpeg-core";
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

    // Both files are fetched here and handed over as `blob:` URLs rather than
    // passed as the R2 addresses they are, which is what the cross-origin move
    // actually costs. The worker reaches the core with `importScripts`, and a
    // classic worker importing a script from another origin is refused whatever
    // CORS says; a blob URL is same-origin by construction, so this is the
    // documented way to host the core anywhere but the page's own origin.
    //
    // The wasm goes the same way for a duller reason: once `coreURL` is a blob,
    // the core has no base URL left to resolve a relative sibling against, and
    // Emscripten would look for it under `blob:`.
    //
    // The two blobs stay resident for the life of the tab — @ffmpeg/util never
    // revokes them — so this holds ~30MB that the previous same-origin fetch did
    // not. Deliberate, and the smaller problem: the alternative is a converter
    // that cannot be hosted off a 25MiB-per-asset platform at all.
    const blobURL = (file: keyof typeof FFMPEG_CORE_FILES) =>
      toBlobURL(`${FFMPEG_CORE_BASE}/${file}`, FFMPEG_CORE_FILES[file]);

    const [coreURL, wasmURL] = await Promise.all([
      blobURL("ffmpeg-core.js"),
      blobURL("ffmpeg-core.wasm"),
    ]);

    await ffmpeg.load({ coreURL, wasmURL });
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
