/**
 * The sidebar's glyphs, in duotone.
 *
 * The rest of the app draws Lucide's stroke geometry verbatim, and that is
 * still right everywhere a glyph sits on a control: a 14px outline on a button
 * reads as a mark, and filling it would make it read as a badge. The navigation
 * is the one place it is wrong. Three items, one of them selected, and the only
 * thing saying which is a tinted row — so the icon is carrying no weight at all
 * and three identical-weight outlines down the left edge read as a list of
 * hyperlinks rather than as the places this window goes.
 *
 * Duotone is a fill at low alpha under the usual stroke. The fill is what the
 * eye resolves first — a solid shape with a recognisable silhouette — and the
 * stroke is what makes it legible at 16px. Because the fill inherits
 * `currentColor` and the row already changes colour when selected, the selected
 * item's glyph fills and brightens with its label rather than staying an
 * outline beside it.
 *
 * Nothing else in the app should use these. A duotone glyph on a toolbar button
 * beside stroked ones is the inconsistency this file's own argument is against.
 */

/** Lucide's stroke geometry, restated so this file stands on its own. */
const STROKE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * How solid the under-fill is.
 *
 * Low enough that the shape reads as shaded rather than as a second, bolder
 * icon — at a quarter it is a tone, and the stroke on top is still what gives
 * the glyph its edges. It rides `currentColor`, so a muted row's fill is muted
 * too and the selected row's brightens with everything else on it.
 */
const FILL = { fill: "currentColor", fillOpacity: 0.22, stroke: "none" } as const;

/**
 * Lucide `clapperboard`, filled.
 *
 * A folder is what the library used to be called and what it stopped being:
 * these are recordings, and a folder says "files somewhere on disk" about a
 * thing the user never has to go and find. The clapper is the one mark that
 * means a take rather than a document.
 */
export function RecordingsIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      {/* The body, under everything. The slate's own diagonal is left to the
          stroke: filling the stripes as well would close the glyph up into a
          rectangle at the size this is actually drawn. */}
      <path
        {...FILL}
        d="M4 11h16a1 1 0 0 1 1 1v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a1 1 0 0 1 1-1Z"
      />
      <path d="M20.2 6 3 11l-.9-2.4c-.3-.8.1-1.7.9-2L16.2 2.2c.8-.3 1.7.1 2 .9Z" />
      <path d="m6.2 5.3 3.1 3.9" />
      <path d="m12.4 3.4 3.1 4" />
      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

/**
 * Lucide `share` over a filled tray.
 *
 * The same mark the Export button carries, so the pane and the button that
 * fills it are plainly the same thing. The tray takes the fill and the arrow
 * stays an outline: what the icon is *about* is the leaving, and a filled
 * arrow would be the heaviest thing in the sidebar.
 */
export function ExportsIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path {...FILL} d="M3 14h18v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M12 15V3m0 0L8 7m4-4 4 4" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

/**
 * Lucide `settings-2` with filled knobs.
 *
 * Two sliders rather than the gear everything uses, which is the choice
 * `settings/icons.tsx` already made — this is that glyph with the two knobs
 * filled, so the pane's own header and the row that opens it stay the same
 * drawing.
 */
export function SettingsIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <circle {...FILL} cx="17" cy="17" r="3" />
      <circle {...FILL} cx="7" cy="7" r="3" />
      <path d="M20 7h-9" />
      <path d="M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </svg>
  );
}
