/**
 * The chalk mark, as the app draws it.
 *
 * `click_chalk` in `crates/prequel-render/src/shaders.metal` — arm 12, the one
 * every teacher's stick arrives with. It is a knock on a board and the dust it
 * shakes off: a hard little disc that is gone in the first few frames, then
 * nine soft puffs thrown out along the board, rising as they go and fading as
 * they grow.
 *
 * This is a port and not an impression, which is the difference the last
 * version missed — it was one expanding blur, and a cloud that arrives on its
 * own reads as fog rolling in. Every number below comes from that function:
 *
 * - the puffs are flattened to 0.6 vertically, because dust knocked off a
 *   board leaves *along* the board rather than towards the room;
 * - each one lifts by `0.28 * (0.4 + h3)`, because chalk is light enough to
 *   rise before it settles — thrown evenly in a circle it reads as an
 *   explosion;
 * - each grows while its brightness falls with `1 - e`, so the cloud thins
 *   rather than shrinking.
 *
 * The scatter is the shader's own: `click_hash(n) = fract(sin(n * 127.1 +
 * 311.7) * 43758.5453)` at seed 0, evaluated once and written down. A port
 * that invented its own nine random numbers would be a different cloud every
 * time somebody regenerated it, and this one has to stay the cloud the app
 * draws. Float64 here against the shader's float32, so the figures are the
 * same scatter rather than the same bits.
 */

/** One puff: where it ends up, how small it starts, how big and how bright. */
type Puff = { dx: number; dy: number; s0: number; size: number; a: number };

/** Nine, from `click_hash` at seed 0. In units of the mark's own radius. */
const PUFFS: Puff[] = [
  { dx: 0.314, dy: -0.736, s0: 0.264, size: 0.417, a: 0.755 },
  { dx: 0.398, dy: -0.116, s0: 0.283, size: 0.389, a: 0.534 },
  { dx: 0.115, dy: -0.589, s0: 0.239, size: 0.46, a: 0.416 },
  { dx: -0.428, dy: -0.426, s0: 0.435, size: 0.253, a: 0.645 },
  { dx: 0.056, dy: -0.523, s0: 0.26, size: 0.423, a: 0.363 },
  { dx: -0.281, dy: -0.35, s0: 0.297, size: 0.37, a: 0.353 },
  { dx: 0.481, dy: -0.407, s0: 0.241, size: 0.457, a: 0.518 },
  { dx: 0.705, dy: -0.599, s0: 0.248, size: 0.444, a: 0.814 },
  { dx: 0.2, dy: -0.533, s0: 0.291, size: 0.378, a: 0.491 },
];

/** The mark's radius on the card, in pixels. The shader works in a unit quad
    and is sized by the frame; there is no frame here, so this is the number
    everything above is multiplied by. */
const R = 46;

export function ChalkMark({ delay }: { delay: string }) {
  return (
    <span className="absolute inset-0" style={{ "--mark-delay": delay } as React.CSSProperties}>
      {/* The knock. `clamp(1 - t * 7)` in the shader, so it is over inside the
          first seventh of the mark's life — it is what gives the dust a
          cause. A disc of 0.14 and not a ring: chalk hits the board, it does
          not ring out. */}
      <span
        className="animate-chalk-hit absolute rounded-full bg-white opacity-0"
        style={{
          width: 0.28 * R,
          height: 0.28 * R,
          translate: "-50% -50%",
          animationDelay: delay,
        }}
      />
      {PUFFS.map((puff, i) => (
        <span
          key={i}
          // A soft blob and not an edged bit: that is the whole difference
          // between this and the confetti mark — confetti is objects and this
          // is a cloud, and a cloud with an edge on it is a sticker.
          className="animate-chalk-puff absolute rounded-full opacity-0"
          style={
            {
              width: puff.size * R,
              height: puff.size * R,
              // Centred on the knock with margins and not a `translate`: the
              // keyframes animate `translate` from nothing to the puff's own
              // offset, and a centring translate here would be overwritten
              // the moment the animation started — every puff would jump a
              // half-width left as it was thrown.
              marginLeft: (-puff.size * R) / 2,
              marginTop: (-puff.size * R) / 2,
              background:
                "radial-gradient(circle, rgb(255 255 255 / 0.95) 0%, rgb(255 255 255 / 0.5) 42%, transparent 72%)",
              animationDelay: delay,
              "--dx": `${puff.dx * R}px`,
              "--dy": `${puff.dy * R}px`,
              "--s0": puff.s0,
              "--a": puff.a,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}
