import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The mark, as a data URI.
 *
 * `src/app/icon.svg` is used rather than `public/prequel.svg` because it has
 * the superellipse baked into a clip path. Satori renders these cards and
 * supports neither `corner-shape` nor an external stylesheet, so the shape has
 * to travel inside the file.
 */
async function markDataUri(): Promise<string> {
  const svg = await readFile(join(process.cwd(), "src/app/icon.svg"));
  return `data:image/svg+xml;base64,${svg.toString("base64")}`;
}

export async function ogCard({ title, kicker }: { title: string; kicker: string }) {
  const mark = await markDataUri();

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        backgroundColor: "#0b0d11",
        backgroundImage:
          "radial-gradient(900px 520px at 78% -12%, rgba(225,75,21,0.42), transparent 62%), radial-gradient(760px 480px at 96% 22%, rgba(172,24,96,0.38), transparent 60%)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/* A bare <img>: satori renders this tree, and next/image means nothing
            to it. */}
        <img src={mark} width={64} height={64} alt="" />
        <span style={{ fontSize: 30, color: "#eceef1", letterSpacing: -0.5 }}>Prequel</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <span
          style={{
            fontSize: 22,
            color: "#8b9198",
            letterSpacing: 3,
            textTransform: "uppercase",
          }}
        >
          {kicker}
        </span>
        <span
          style={{
            marginTop: 20,
            fontSize: 64,
            lineHeight: 1.1,
            color: "#eceef1",
            letterSpacing: -2,
          }}
        >
          {title}
        </span>
      </div>

      <span style={{ fontSize: 22, color: "#8b9198" }}>Apple Silicon · macOS 14+</span>
    </div>
  );
}
