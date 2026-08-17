import { ButtonLink } from "@/components/Button";
import { Container } from "@/components/Section";

export default function NotFound() {
  return (
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
  );
}
