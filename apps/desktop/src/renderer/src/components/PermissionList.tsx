import type { PermissionId } from "../../../shared/contract";
import { permissionIconUrl } from "../../../shared/media-url";
import { CheckIcon } from "../editor/icons";
import type { Permissions } from "../hooks/usePermissions";

/**
 * The four permissions, and what each one is for.
 *
 * Shared by the first run and by Settings, which is the whole point of it being
 * here: onboarding is where these are asked for, and Settings is where somebody
 * goes weeks later when a recording came out empty. Two lists would drift, and
 * the drift a user meets is the worst kind — a row that says a permission is
 * granted next to an app that cannot record.
 *
 * One entry per thing to ask for, and why anyone should say yes.
 */
export const PERMISSIONS: {
  id: PermissionId;
  label: string;
  /** One line. Two wrap at this width, and a wrapped row reads as a warning. */
  detail: string;
}[] = [
  {
    id: "screen",
    label: "Screen Recording",
    detail: "Everything Prequel records comes through it.",
  },
  {
    id: "accessibility",
    label: "Accessibility",
    detail: "Lets the automatic zooms find your clicks and typing.",
  },
  {
    id: "camera",
    label: "Camera",
    detail: "For the webcam bubble, only when you turn it on.",
  },
  {
    id: "microphone",
    label: "Microphone",
    detail: "For your voice, only when you turn it on.",
  },
];

function PermissionRow({
  permission,
  granted,
  onGrant,
}: {
  permission: (typeof PERMISSIONS)[number];
  granted: boolean;
  onGrant: () => void;
}) {
  return (
    // The surface belongs to the list now, so a row carries nothing but its
    // divider: four cards read as four separate asks, where one card of four
    // rows reads as the set macOS hands out together.
    <li className="flex items-start gap-3 border-b border-white/10 px-3.5 py-3 last:border-b-0">
      {/* macOS's own icon for the pane this permission is granted in, so the
          row and the System Settings window it sends you to show the same
          picture — the artwork is the instruction for what to look for once you
          are there, which a glyph of our own cannot be.

          No tinted square behind it any more. These carry their own rounded
          square and their own colour, and a second one around them read as an
          icon inside a button. The grant state is the right-hand side of the
          row, where it can be a word rather than a hue. */}
      <img
        src={permissionIconUrl(permission.id)}
        alt=""
        width={32}
        height={32}
        className="mt-0.5 size-8 flex-none"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-xs font-medium">{permission.label}</p>
        <p className="text-[11px] leading-relaxed text-editor-muted">{permission.detail}</p>
      </div>

      {granted ? (
        <span className="flex flex-none items-center gap-1.5 self-center text-[11px] text-export [&_svg]:size-3.5">
          <CheckIcon />
          Allowed
        </span>
      ) : (
        // One button per row. Allow already ends at System Settings for the
        // two macOS will not grant from a prompt — `requestPermission` opens
        // the pane itself once the prompt has been spent — so a second control
        // beside it offered a choice that was never really a choice.
        <button
          type="button"
          className="flex-none self-center rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-medium hover:bg-white/15"
          onClick={onGrant}
        >
          Allow
        </button>
      )}
    </li>
  );
}

/**
 * The four, as one card.
 *
 * Translucent rather than solid, so the wash behind the welcome window carries
 * through it. Settings has no wash and it sits on the panel as a slightly
 * lifted block, which is what a group of rows should look like there anyway.
 *
 * `overflow-hidden` so the first and last rows are clipped to the card's
 * corners: without it a row's own background squares them off, and the card
 * reads as a rounded outline with a rectangle inside it.
 */
export function PermissionList({ permissions }: { permissions: Permissions }) {
  return (
    <ul className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
      {PERMISSIONS.map((permission) => (
        <PermissionRow
          key={permission.id}
          permission={permission}
          granted={permissions.granted(permission.id)}
          onGrant={() => void permissions.request(permission.id)}
        />
      ))}
    </ul>
  );
}
