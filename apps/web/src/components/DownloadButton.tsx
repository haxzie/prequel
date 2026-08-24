import { ButtonLink } from "@/components/Button";
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
      <ButtonLink href="/download">Download for Mac</ButtonLink>
      {/* The platform used to be a badge above the headline. It still belongs
          above the fold, so it rides with the small print. */}
      <p className="mt-3.5 font-mono text-[11px] tracking-wide text-muted">
        {SITE.platform} · free for {TRIAL_DAYS} days
      </p>
    </div>
  );
}
