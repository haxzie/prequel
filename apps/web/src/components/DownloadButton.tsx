import { ButtonLink } from "@/components/Button";
import { AppleIcon } from "@/components/icons";
import { SITE } from "@/lib/site";
import { TRIAL_DAYS } from "@/lib/pricing";

/**
 * The one call to action on the site.
 *
 * `/download` rather than a release URL: that carries a version, so every place
 * linking to it would need editing on every release — including whatever
 * someone pasted into a thread last month. The route resolves the current build
 * and redirects.
 */
export function DownloadCta({ className = "" }: { className?: string }): React.ReactNode {
  return (
    <div className={`mx-auto max-w-lg ${className}`}>
      <ButtonLink href="/download">
        {/* `-mt-0.5` for the leaf, which puts the mark's optical centre below
            its geometric one — vertically centred, it sits visibly low next to
            the cap height of the text. The gap comes from `ButtonLink`. */}
        <AppleIcon className="-mt-0.5 size-[1.05rem]" />
        Download for Mac
      </ButtonLink>
      {/* The platform used to be a badge above the headline. It still belongs
          above the fold, so it rides with the small print. */}
      <p className="mt-3.5 font-mono text-[11px] tracking-wide text-muted">
        {SITE.platform} · free for {TRIAL_DAYS} days
      </p>
    </div>
  );
}
