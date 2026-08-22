import { ButtonLink } from "@/components/Button";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { Container } from "@/components/Section";
import { Wash } from "@/components/Wash";

/**
 * The 404, which has to dress itself.
 *
 * Next renders the root `not-found` inside the *root* layout, and that layout is
 * now bare — it holds the document and nothing more. A page group's chrome is
 * not available to it, because an unmatched URL belongs to no group by
 * definition. So the nav and footer are wired up here.
 *
 * Worth it rather than leaving it plain: the most common way to arrive is a
 * stale link to a moved marketing page, and a bare page with one button reads as
 * a broken site rather than a missing page.
 */
export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <Wash />
      <Nav />
      <main className="flex-1">
        <Container className="py-32 text-center">
          <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">404</p>
          <h1 className="mt-4 text-3xl font-medium tracking-tight text-fg sm:text-4xl">
            Nothing on this frame
          </h1>
          <p className="mx-auto mt-4 max-w-md text-pretty text-muted">
            The page you were after has been cut. The rest of the take is still here.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/">Back to the start</ButtonLink>
            <ButtonLink href="/blog" variant="secondary">
              Read the blog
            </ButtonLink>
          </div>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
