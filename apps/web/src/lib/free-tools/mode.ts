/**
 * Which of the three recorders is being rendered.
 *
 * A union in its own module because both ends need it and neither can own it:
 * the registry in `content/free-tools.ts` is read on the server and the studio
 * that consumes it is a client component. A type exported from the client file
 * would be imported by the server one, which works today and is one `const`
 * away from pulling a `"use client"` module into a server graph.
 */
export type ToolMode = "screen" | "camera" | "audio";
