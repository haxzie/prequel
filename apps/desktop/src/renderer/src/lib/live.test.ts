/**
 * The ordering rule, at the point where it used to be got wrong.
 *
 * Every one of these is a sequence that actually happens: main answers slowly,
 * main broadcasts while the answer is in flight, the window closes mid-request.
 * The one that shipped is `does not let a slow answer overwrite a broadcast` —
 * it left the update window reading "Checking for updates…" with nothing else
 * ever coming to correct it.
 */
import { describe, expect, it, vi } from "vitest";

import { follow } from "./live";

/** A request whose answer is released by hand, so the race can be written down. */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** A subscription whose events are emitted by hand. */
function channel<T>() {
  let listener: ((value: T) => void) | null = null;
  const unsubscribe = vi.fn();

  return {
    subscribe: (next: (value: T) => void) => {
      listener = next;
      return unsubscribe;
    },
    emit: (value: T) => listener?.(value),
    unsubscribe,
  };
}

describe("follow", () => {
  it("shows the primed value when nothing has happened since", async () => {
    const seen: string[] = [];
    const answer = deferred<string>();
    const events = channel<string>();

    follow(
      () => answer.promise,
      events.subscribe,
      (value) => seen.push(value),
    );
    answer.settle("idle");
    await answer.promise;

    expect(seen).toEqual(["idle"]);
  });

  it("does not let a slow answer overwrite a broadcast", async () => {
    // The bug. The window asks how things stand, the check finishes and
    // broadcasts `idle` while that request is still in flight, and then the
    // older `checking` reply arrives. Nothing fires again — so whatever wins
    // here is what the user reads until they quit the app.
    const seen: string[] = [];
    const answer = deferred<string>();
    const events = channel<string>();

    follow(
      () => answer.promise,
      events.subscribe,
      (value) => seen.push(value),
    );

    events.emit("idle");
    answer.settle("checking");
    await answer.promise;

    expect(seen).toEqual(["idle"]);
  });

  it("keeps following after the answer has landed", async () => {
    const seen: string[] = [];
    const answer = deferred<string>();
    const events = channel<string>();

    follow(
      () => answer.promise,
      events.subscribe,
      (value) => seen.push(value),
    );
    answer.settle("idle");
    await answer.promise;
    events.emit("available");
    events.emit("downloading");

    expect(seen).toEqual(["idle", "available", "downloading"]);
  });

  it("drops an answer that arrives after the window has gone", async () => {
    // Not cosmetic: applying this calls `setState` on an unmounted component.
    const seen: string[] = [];
    const answer = deferred<string>();
    const events = channel<string>();

    const stop = follow(
      () => answer.promise,
      events.subscribe,
      (value) => seen.push(value),
    );
    stop();
    answer.settle("idle");
    await answer.promise;

    expect(seen).toEqual([]);
    expect(events.unsubscribe).toHaveBeenCalled();
  });

  it("drops a broadcast that arrives after the window has gone", async () => {
    const seen: string[] = [];
    const events = channel<string>();

    const stop = follow(
      () => new Promise<string>(() => {}),
      events.subscribe,
      (value) => seen.push(value),
    );
    stop();
    events.emit("available");

    expect(seen).toEqual([]);
  });

  it("survives a prime that fails", async () => {
    // A rejected request must leave the window waiting, not throw into an
    // effect where nothing is listening for it.
    const seen: string[] = [];
    const events = channel<string>();

    follow(
      () => Promise.reject(new Error("no answer")),
      events.subscribe,
      (value) => seen.push(value),
    );
    await Promise.resolve();
    events.emit("idle");

    expect(seen).toEqual(["idle"]);
  });
});
