import { BarChart } from "./BarChart";

/**
 * The file-size figures for the articles on size and on quality.
 *
 * Measured, not quoted. The source clip is the first 60 seconds of a real
 * Prequel take of a full 14-inch MacBook Pro display (3024 × 1964, H.264 as
 * captured), re-encoded with ffmpeg 8 on 17 September 2026: x264 at CRF 23
 * and x265 at CRF 28, `-preset medium`, scaled with Lanczos, audio dropped.
 * The two CRF values are each encoder's default and land at a similar
 * picture, which is what makes the H.264 and HEVC bars comparable. Megabytes
 * are 10^6 bytes, as Finder shows them.
 *
 * Two charts and not one, because the raw files and the exports are two
 * orders of magnitude apart: on a shared axis the exports are a row of
 * slivers. The reference rows on the first chart are the two figures readers
 * gave in the threads the article quotes, converted to a per-minute rate; they
 * are drawn muted because they are somebody else's measurement.
 *
 * Numbers are duplicated in the table under each chart in the MDX on purpose.
 * The chart is the shape, the table is the record, and a screen reader gets
 * the table.
 */
export function RawSizeChart() {
  return (
    <BarChart
      unit="MB per minute, before export"
      max={220}
      format={(v) => v.toFixed(0)}
      caption="What a minute of raw screen recording weighs: about 217 MB from the macOS recorder in the r/screenrecorders thread (13 GB an hour), 100 MB in the Apple Community thread (15 GB for two and a half hours), and 61 MB for Prequel's own take of a full 3024 by 1964 display."
      bars={[
        { label: "macOS recorder, r/screenrecorders", value: 217, muted: true },
        { label: "QuickTime, Apple Community", value: 100, muted: true },
        { label: "Prequel take, 3024 × 1964", value: 61 },
      ]}
    />
  );
}

export function ExportSizeChart() {
  return (
    <BarChart
      unit="MB per minute, exported"
      format={(v) => v.toFixed(1)}
      caption="The same minute exported at three sizes in two codecs. H.264 at the frame's full size is 4.1 MB a minute, HEVC 3.3; at 1080p the two are 2.0 and 1.6; at 720p, 1.2 and 0.9. HEVC saves about a fifth at every size, and each step down in size saves about half."
      bars={[
        { label: "H.264 · Full, 3024 × 1964", value: 4.123, series: 0 },
        { label: "HEVC · Full, 3024 × 1964", value: 3.293, series: 1 },
        { label: "H.264 · 1080p", value: 1.954, series: 0 },
        { label: "HEVC · 1080p", value: 1.605, series: 1 },
        { label: "H.264 · 720p", value: 1.172, series: 0 },
        { label: "HEVC · 720p", value: 0.948, series: 1 },
      ]}
    />
  );
}

export function FrameRateChart() {
  return (
    <BarChart
      unit="MB per minute, 1080p H.264"
      format={(v) => v.toFixed(1)}
      caption="At 1080p in H.264, the same minute is 1.2 MB at 30 fps and 2.0 MB at 60 fps. Raising the quality a step (CRF 18) at 60 fps gives 2.7 MB; lowering it a step (CRF 28) gives 1.4 MB. Frame rate moves the size by about half; a step of quality by about a third."
      bars={[
        { label: "30 fps, CRF 23", value: 1.246 },
        { label: "60 fps, CRF 23", value: 1.954 },
        { label: "60 fps, CRF 18 (higher quality)", value: 2.706 },
        { label: "60 fps, CRF 28 (lower quality)", value: 1.409 },
      ]}
    />
  );
}
