type JsonLdProps = {
  data: Record<string, unknown> | Record<string, unknown>[];
};

/** Serialised once — callers own the schema shape in `lib/seo.ts`. */
export function JsonLd({ data }: JsonLdProps) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}
