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
import type { CursorLayer, EditorSession, TrackMedia } from "../src/shared/contract";
import type { Manifest } from "../src/shared/manifest";
import { parseManifest } from "../src/shared/manifest";
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

  const media: TrackMedia[] = manifest.tracks.map((track) => ({
    kind: track.kind,
    url: mediaUrl(name, track.file_name),
    // From the manifest, which is the only place a late start is recorded —
    // see the note in `editor-session.ts`.
    offset: track.start,
    duration: track.end - track.start,
    width: track.width ?? null,
    height: track.height ?? null,
    frameRate: null,
    matteUrl: track.matte ? mediaUrl(name, track.matte.file_name) : null,
  }));

  const projectText = saved ? await text(`${base}/project.json`) : null;
  let project: Project | null = null;
  if (projectText) {
    try {
      project = sanitiseProject(JSON.parse(projectText), manifest.id, manifest.duration);
    } catch {
      project = null;
    }
  }
  project ??= newProject(
    manifest.id,
    manifest.duration,
    sourceShape(
      manifest.source,
      media.find((track) => track.kind === "screen"),
    ),
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
    project: await withBackground(name, project),
    transcript,
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
