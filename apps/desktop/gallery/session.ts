/**
 * An `EditorSession` for a real recording, built in the browser.
 *
 * `src/main/editor-session.ts` does this in main and imports `electron` to do
 * it, so the gallery cannot call it. Every piece of the work that is not
 * Electron — the manifest parser, the project sanitiser, the transcript reader
 * — is in `src/shared` and bundles for the renderer already, so this is that
 * function with the filesystem replaced by three fetches.
 *
 * No media probe. Main asks the Rust addon for each track's real duration and
 * falls back to the manifest when it cannot; the manifest is what this uses,
 * which is the fallback path and is honest for a finished recording.
 */
import type {
  CursorLayer,
  EditorSession,
  ProjectComposition,
  TrackMedia,
} from "../src/shared/contract";
import { composition } from "../src/shared/composition";
import type { Manifest } from "../src/shared/manifest";
import { findTrack, isStill, parseManifest, seamsOf } from "../src/shared/manifest";
import type { BlobTrack } from "../src/shared/layout";
import type { Project } from "../src/shared/project";
import {
  FALLBACK_BACKGROUND,
  newProject,
  sanitiseProject,
  sourceShape,
} from "../src/shared/project";
import type { Transcript } from "../src/shared/transcript";
import { parseTranscript } from "../src/shared/transcript";
import { mediaUrl } from "./media-url";

async function text(url: string): Promise<string | null> {
  const response = await fetch(url);
  return response.ok ? response.text() : null;
}

async function exists(url: string): Promise<boolean> {
  const response = await fetch(url, { method: "HEAD" });
  return response.ok;
}

/**
 * `saved` keeps the recording's own `project.json`; the default starts from a
 * fresh project, which is the look every recording opens on and the one the
 * documentation should show. It also lets the editor's first automatic pass
 * run, so the zooms in the shots are the ones the app makes, not ones somebody
 * placed by hand.
 */
export async function loadSession(
  name: string,
  { saved = false }: { saved?: boolean } = {},
): Promise<EditorSession | null> {
  const base = `/fixture/recording/${encodeURIComponent(name)}`;
  const manifestText = await text(`${base}/session.json`);
  if (!manifestText) return null;

  const manifest = parseManifest(manifestText);

  // One entry per (kind, segment), as `readEditorSession` builds it: a fixture
  // recording extended with a second take has two files per kind.
  const media: TrackMedia[] = manifest.tracks.flatMap((track) =>
    track.segments.map((segment, index) => ({
      kind: track.kind,
      segment: index,
      file: segment.file_name,
      url: mediaUrl(name, segment.file_name),
      // From the manifest, which is the only place a late start is recorded —
      // see the note in `editor-session.ts`.
      offset: segment.start,
      duration: segment.end - segment.start,
      width: segment.width ?? null,
      height: segment.height ?? null,
      frameRate: null,
      matteUrl: segment.matte ? mediaUrl(name, segment.matte.file_name) : null,
      matteFile: segment.matte?.file_name ?? null,
    })),
  );

  const projectText = saved ? await text(`${base}/project.json`) : null;
  let project: Project | null = null;
  if (projectText) {
    try {
      project = sanitiseProject(
        JSON.parse(projectText),
        manifest.id,
        manifest.duration,
        seamsOf(manifest),
      );
    } catch {
      project = null;
    }
  }
  project ??= newProject(
    manifest.id,
    manifest.duration,
    sourceShape(
      manifest.source,
      media.find((track) => track.kind === "screen" && track.segment === 0),
      isStill(manifest),
    ),
    seamsOf(manifest),
  );

  const transcriptText = await text(`${base}/transcript.json`);
  let transcript: Transcript | null = null;
  if (transcriptText) {
    try {
      transcript = parseTranscript(transcriptText, manifest.id);
    } catch {
      transcript = null;
    }
  }

  return {
    // Only the last segment is ever read by the renderer (`recordingName`), so
    // the directory is a name under a root that does not exist.
    dir: `/gallery/recordings/${name}`,
    name,
    manifest,
    media,
    cursor: cursorLayer(manifest),
    blobs: blobTrack(manifest),
    project: await withBackground(name, project),
    transcript,
    // No addon in the browser to plan them, and nothing here plays sound: a
    // gallery shot is a picture of the panel, and the panel is offered on the
    // strength of the manifest's presses, not the plan.
    sound: null,
    // Nothing has just been added here — the gallery opens fixtures, it does not
    // record into them.
    focusSliceId: null,
    // Already resolved above: this builds the whole session in one pass, so it
    // has `withBackground`'s answer rather than the editor's late one.
    backgroundMissing: false,
  };
}

/** `cursorLayer` from `editor-session.ts`, without the copying. */
function cursorLayer(manifest: Manifest): CursorLayer | null {
  if (manifest.cursor_baked ?? true) return null;
  if (!manifest.cursor?.length) return null;
  return {
    samples: manifest.cursor,
    typing: manifest.typing ?? [],
    clicks: (manifest.clicks ?? []).map((click) => click.at),
    keys: manifest.keys ?? [],
  };
}

/** `blobTrack` from `editor-session.ts`. Same rule: null when there is none. */
function blobTrack(manifest: Manifest): BlobTrack | null {
  const camera = findTrack(manifest, "camera");
  if (!camera) return null;

  const samples = camera.segments
    .flatMap((segment) => segment.matte?.blobs ?? [])
    .map((sample) => ({
      at: sample.at,
      x: sample.x,
      y: sample.y,
      h: sample.h,
      presence: sample.presence,
    }))
    .sort((a, b) => a.at - b.at);

  // A track that is never open is not a track. That is a take whose outline was
  // written by a build that described the shape differently — the manifest reads
  // those as closed rather than refusing the recording — and a camera left in
  // this shape on one of them would draw nothing at all, where falling back to a
  // bubble is what somebody would expect to see.
  return samples.some((sample) => sample.presence > 0) ? { samples } : null;
}

/**
 * A project whose default background is a picture the server can actually
 * serve. Main copies or downloads the missing one; here there is nothing to
 * download from, so a missing picture becomes the gradient the app falls back
 * to when it has the same problem.
 */
async function withBackground(name: string, project: Project): Promise<Project> {
  const background = project.defaults.background.background;
  if (background.kind !== "image") return project;
  if (await exists(mediaUrl(name, background.path))) return project;

  console.warn(`[gallery] ${background.path} is not in the recording; using the fallback`);
  return {
    ...project,
    defaults: {
      ...project.defaults,
      background: { ...project.defaults.background, background: FALLBACK_BACKGROUND },
    },
  };
}

/**
 * The library tile's composition, for a fixture recording.
 *
 * Through `loadSession` rather than a second reader: the tile draws the
 * recording's *saved* edit, which is the same project the editor shot opens,
 * and the arithmetic that picks the frame is the one main uses.
 */
export async function loadComposition(name: string): Promise<ProjectComposition | null> {
  const session = await loadSession(name, { saved: true });
  if (!session) return null;

  return composition(session.manifest, session.project, (file) => mediaUrl(name, file));
}
