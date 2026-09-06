/**
 * What shipped, release by release.
 *
 * Written by hand rather than generated from the tags. A commit log is a record
 * of work and a changelog is a record of what somebody using the app can now
 * do, and most releases contain a good deal of the first and very little of the
 * second. Anything that changed only for us stays out.
 *
 * Newest first, which is the order the page reads in and the order the file is
 * edited in: a release is added at the top.
 */
export type Release = {
  /** Without the leading `v`, which the page adds. */
  version: string;
  /** ISO, rendered with `toLocaleDateString`. */
  date: string;
  /** One line each, in the app's own words rather than the commit's. */
  items: string[];
};

export const RELEASES: Release[] = [
  {
    version: "0.0.13",
    date: "2026-09-06",
    items: [
      "Captions are editable text. Open Edit captions in the inspector and type into the transcript.",
      "Deleting a sentence in the transcript cuts that stretch of footage out of the video.",
      "A new Blur in look brings each word into focus on the moment it is spoken. Minimal has gone.",
      "Caption colour is chosen against whatever is behind the words, so they stay readable on light and dark footage alike.",
      "The transcript follows the clip you have selected.",
    ],
  },
  {
    version: "0.0.12",
    date: "2026-09-03",
    items: [
      "The camera can stand in the frame as a picture of its own rather than only as a bubble in a corner.",
      "Zooms are drawn out along the timeline rather than dropped in at a point.",
      "Prequel is source available, under a licence that turns into Apache-2.0.",
      "Pay once or pay monthly, for the same app.",
    ],
  },
  {
    version: "0.0.11",
    date: "2026-09-02",
    items: [
      "A frosted dock.",
      "The pointer blurs as it moves, the way a real one does on camera.",
      "The timeline says which clip it means.",
    ],
  },
  {
    version: "0.0.10",
    date: "2026-09-01",
    items: [
      "Backgrounds are hosted rather than shipped inside the app, so the download is smaller and the catalogue can grow without an update.",
      "The picker groups them.",
      "The border follows a tilt.",
      "Reopening a recording keeps the zooms it already had.",
    ],
  },
  {
    version: "0.0.9",
    date: "2026-08-31",
    items: [
      "Captions, transcribed on your Mac while you record. Nothing is uploaded.",
      "Caption settings belong to a clip, so a look can change part way through a take.",
      "Cursor timing matches the picture.",
    ],
  },
  {
    version: "0.0.8",
    date: "2026-08-29",
    items: [
      "The panel says when there is a newer version.",
      "The pointer dips when it is clicked.",
      "Your account sits at the foot of the sidebar instead of behind a pane.",
    ],
  },
  {
    version: "0.0.7",
    date: "2026-08-28",
    items: [
      "The camera bubble moves out of the way of a zoom.",
      "Your desktop picture is found on Macs whose wallpaper agent has moved.",
    ],
  },
  {
    version: "0.0.6",
    date: "2026-08-28",
    items: [
      "A zoom slice is the part that is zoomed in, not the part that is arriving.",
      "Settings moved into the window with your recordings.",
      "A modern pointer shape, and new projects start on it.",
    ],
  },
  {
    version: "0.0.5",
    date: "2026-08-28",
    items: [
      "Local recordings have a home of their own rather than a submenu of names.",
      "The panel looks for an update when it opens.",
    ],
  },
];
