import { z, type ZodType } from "zod";

/** A map of env var name -> zod schema. */
export type EnvShape = Record<string, ZodType>;

type InferShape<T extends EnvShape> = { [K in keyof T]: z.infer<T[K]> };

export interface CreateEnvOptions<TServer extends EnvShape, TClient extends EnvShape> {
  /** Variables that must never reach the browser / renderer. */
  server?: TServer;
  /** Variables that are safe to expose. Every key must start with `clientPrefix`. */
  client?: TClient;
  /** Prefix enforced on all `client` keys, e.g. `"NEXT_PUBLIC_"`. */
  clientPrefix?: string;
  /**
   * The raw values. Bundlers only inline statically-written member accesses,
   * so spell each one out (`FOO: process.env.FOO`) rather than passing
   * `process.env` wholesale — except where the whole object is already
   * static, like Vite's `import.meta.env`.
   */
  runtimeEnv: Record<string, unknown>;
  /** Defaults to `typeof window === "undefined"`. */
  isServer?: boolean;
  /** Treat `""` as "not set" so empty lines in .env fall back to defaults. */
  emptyStringAsUndefined?: boolean;
  /** Escape hatch for lint/CI/docker builds. Defaults to `SKIP_ENV_VALIDATION`. */
  skipValidation?: boolean;
}

/**
 * Validates environment variables against zod schemas and returns a frozen,
 * fully-typed object.
 *
 * Throws at import time when a variable is missing or malformed, and throws on
 * access when client code reaches for a server-only variable.
 */
export function createEnv<TServer extends EnvShape = {}, TClient extends EnvShape = {}>(
  opts: CreateEnvOptions<TServer, TClient>,
): Readonly<InferShape<TServer> & InferShape<TClient>> {
  const {
    server = {} as TServer,
    client = {} as TClient,
    clientPrefix,
    runtimeEnv,
    isServer = typeof (globalThis as { window?: unknown }).window === "undefined",
    emptyStringAsUndefined = true,
    skipValidation = Boolean(runtimeEnv["SKIP_ENV_VALIDATION"]),
  } = opts;

  if (clientPrefix) {
    for (const key of Object.keys(client)) {
      if (!key.startsWith(clientPrefix)) {
        throw new Error(
          `[env] Client variable "${key}" must be prefixed with "${clientPrefix}", ` +
            `otherwise the bundler will not expose it.`,
        );
      }
    }
    for (const key of Object.keys(server)) {
      if (key.startsWith(clientPrefix)) {
        throw new Error(
          `[env] Server variable "${key}" must not use the public "${clientPrefix}" prefix — ` +
            `move it to \`client\` or rename it.`,
        );
      }
    }
  }

  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (emptyStringAsUndefined && value === "") continue;
    if (value === undefined) continue;
    raw[key] = value;
  }

  // On the client only the client schema exists — server values were never
  // bundled, so validating them would always fail.
  const shape: EnvShape = isServer ? { ...client, ...server } : { ...client };

  if (skipValidation) {
    return Object.freeze(raw) as Readonly<InferShape<TServer> & InferShape<TClient>>;
  }

  const parsed = z.object(shape).safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `[env] Invalid environment variables:\n${details}\n\n` +
        `Check your .env against .env.example, or set SKIP_ENV_VALIDATION=1 to bypass.`,
    );
  }

  const values = parsed.data as Record<string, unknown>;

  return new Proxy(values, {
    get(target, prop) {
      if (typeof prop !== "string") return Reflect.get(target, prop);
      // Module interop probes — must not throw.
      if (prop === "__esModule" || prop === "$$typeof" || prop === "then") return undefined;
      if (!isServer && !(prop in client)) {
        throw new Error(
          `[env] "${prop}" is a server-only environment variable and cannot be read ` +
            `from client code. Move it to the \`client\` schema if it is safe to expose.`,
        );
      }
      return Reflect.get(target, prop);
    },
    set(_target, prop) {
      throw new Error(`[env] Environment is read-only (tried to set "${String(prop)}").`);
    },
  }) as Readonly<InferShape<TServer> & InferShape<TClient>>;
}
