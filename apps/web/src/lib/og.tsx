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

/**
 * A card from `public/articles/og/`, as a data URI and its own size.
 *
 * Satori wants a width and a height on every `<img>`, and cards differ: an
 * issue with no body is a third the height of a thread with one. The size is
 * read from the PNG header (bytes 16 to 23, big-endian) rather than hard-coded,
 * because a hard-coded figure is right for the card it was measured on and
 * stretches every other one.
 */
async function referenceCard(slug: string) {
  const png = await readFile(join(process.cwd(), "public/articles/og", `${slug}.png`));
  return {
    src: `data:image/png;base64,${png.toString("base64")}`,
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

export async function ogCard({
  title,
  kicker,
  reference,
}: {
  title: string;
  kicker: string;
  /** Slug of a quote card to draw under the title. */
  reference?: string;
}) {
  const mark = await markDataUri();

  if (reference) {
    const card = await referenceCard(reference);
    // Drawn at a fixed width, so the height follows the card's own proportions.
    const width = 900;
    const height = Math.round((card.height / card.width) * width);

    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "48px 64px",
          backgroundColor: "#0b0d11",
          backgroundImage:
            "radial-gradient(900px 520px at 78% -12%, rgba(225,75,21,0.42), transparent 62%), radial-gradient(760px 480px at 96% 22%, rgba(172,24,96,0.38), transparent 60%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img src={mark} width={44} height={44} alt="" />
          <span style={{ fontSize: 26, color: "#eceef1", letterSpacing: -0.5 }}>Prequel</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <span
            style={{ fontSize: 18, color: "#8b9198", letterSpacing: 3, textTransform: "uppercase" }}
          >
            {kicker}
          </span>
          <span
            style={{
              marginTop: 14,
              fontSize: 52,
              lineHeight: 1.1,
              color: "#eceef1",
              letterSpacing: -1.5,
            }}
          >
            {title}
          </span>
        </div>

        {/* White, with the card's own text on it: the card is a picture of a
            post, and a post is dark text on a light page. A rounded clip and a
            long soft shadow lift it off the panel without a border. */}
        <div
          style={{
            display: "flex",
            alignSelf: "flex-start",
            backgroundColor: "#ffffff",
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          }}
        >
          <img src={card.src} width={width} height={height} alt="" />
        </div>
      </div>
    );
  }

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
