"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { api } from "@/lib/api";

type State =
  | { status: "minting" }
  | { status: "ready"; deepLink: string }
  | { status: "error"; message: string };

export function DesktopHandoff({
  challenge,
  state: handshakeState,
  email,
  teamName,
}: {
  challenge: string;
  state: string;
  email: string;
  teamName: string;
}) {
  const [state, setState] = useState<State>({ status: "minting" });

  useEffect(() => {
    void (async () => {
      try {
        const { code } = await api<{ code: string }>("/v1/desktop/authorize", {
          method: "POST",
          body: JSON.stringify({ challenge }),
        });

        const deepLink = `prequel://auth?code=${encodeURIComponent(code)}&state=${encodeURIComponent(handshakeState)}`;
        setState({ status: "ready", deepLink });

        // Attempted automatically, and offered as a button as well. macOS asks
        // the user to confirm opening the app the first time, and a browser
        // will refuse the navigation outright if it decides it was not a
        // gesture — in either case the button below is what actually works, so
        // it is never hidden behind this attempt succeeding.
        window.location.href = deepLink;
      } catch (error) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "That didn't work.",
        });
      }
    })();
  }, [challenge, handshakeState]);

  if (state.status === "error") {
    return (
      <>
        <h1 className="text-2xl font-medium tracking-tight text-fg">That didn&rsquo;t work</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{state.message}</p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-medium tracking-tight text-fg">Open Prequel to finish</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Signing in as <span className="text-fg">{email}</span>, sharing into{" "}
        <span className="text-fg">{teamName}</span>.
      </p>

      <Button
        className="mt-8"
        disabled={state.status !== "ready"}
        onClick={() => {
          if (state.status === "ready") window.location.href = state.deepLink;
        }}
      >
        {state.status === "ready" ? "Open Prequel" : "Preparing…"}
      </Button>

      <p className="mt-4 text-xs leading-relaxed text-muted">
        The link works once and expires in five minutes. You can close this tab once the app says
        you&rsquo;re signed in.
      </p>
    </>
  );
}
