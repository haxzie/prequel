/**
 * The prompter, as main owns it.
 *
 * One object holds the script, where the reader has got to, whether the
 * microphone is being listened to, and the island and script windows. It is
 * here rather than in the island's renderer for the reason recorder state is
 * main-owned: the keys that move the position are global shortcuts, which
 * only main can register, and the recogniser calls back into main. The island
 * draws what it is told.
 *
 * Two channels out. Rare changes — the script, a pause, the microphone's
 * state — go to every window on `teleprompter:changed`, the way `DockState`
 * does. The position goes to the island alone, several times a second while
 * someone reads, on `teleprompter:position`.
 */
import type { BrowserWindow } from "electron";

import {
  IDLE_TELEPROMPTER,
  IPC_CHANNELS,
  type ListeningState,
  type RecordingPreferences,
  type TeleprompterJump,
  type TeleprompterPosition,
  type TeleprompterState,
} from "../../shared/contract.js";
import {
  INITIAL_FOLLOW,
  follow,
  jumpTo,
  stepSentences,
  tokenise,
  vocabulary,
  type FollowState,
  type ScriptWord,
} from "../../shared/teleprompter.js";
import { log } from "../log.js";
import { getRecorder, type ListenUpdate, type Recorder } from "../recorder.js";
import { systemLocale } from "../transcribe/apple.js";
import type { TeleprompterKeys } from "../shortcuts.js";
import type { ScriptWindow } from "../windows/script.js";
import type { Notch, TeleprompterWindow } from "../windows/teleprompter.js";
import type { ScriptStore } from "./script.js";

export interface TeleprompterDeps {
  island: TeleprompterWindow;
  script: ScriptWindow;
  store: ScriptStore;
  preferences: () => RecordingPreferences;
  onChange: (state: TeleprompterState) => void;
  /** The global keys, bound while the island shows. Injected so tests need no `globalShortcut`. */
  keys: { bind: (keys: TeleprompterKeys) => void; unbind: () => void };
  recorder?: () => Promise<Recorder>;
}

/**
 * Something moving the position: the recogniser, or the auto-scroll clock.
 * Exactly one runs while the island shows, chosen by the mode. `kind` is the
 * mode it serves rather than what it is doing — a voice engine that fell back
 * to scrolling still answers for voice, so a size change does not send it back
 * to a microphone it already knows it cannot use. `speed` is the clock's rate,
 * so a change of pace restarts it.
 */
type Engine = { kind: "voice" | "timed"; speed?: number; stop: () => void };

export class Teleprompter {
  private words: ScriptWord[] = [];
  private state: FollowState = INITIAL_FOLLOW;
  private paused = false;
  private listening: ListeningState = "off";
  private level = 0;
  private notch: Notch | null = null;
  private engine: Engine | null = null;
  /** Between `recordingStarted` and `recordingStopped`: the only time an engine runs. */
  private recording = false;
  private readonly recorder: () => Promise<Recorder>;

  constructor(private readonly deps: TeleprompterDeps) {
    this.recorder = deps.recorder ?? getRecorder;
    this.words = tokenise(deps.store.get());
  }

  /** Creates the island without showing it, so its id exists to be excluded. */
  prepare(): BrowserWindow {
    return this.deps.island.prepare();
  }

  /**
   * Shows or hides the island to match the panel and the preference.
   *
   * Called whenever either changes. Also where a change of size, width or
   * mode lands, since all of them ride on the same preferences object.
   */
  sync(panelVisible: boolean): void {
    const preferences = this.deps.preferences();
    // With a microphone only: the panel offers the prompter beside the
    // microphone and only while one is chosen, and the island follows the
    // control rather than outliving it.
    if (!panelVisible || !preferences.teleprompter || preferences.micId === null) {
      this.hide();
      return;
    }

    this.deps.island.setShape(preferences.teleprompterSize, preferences.teleprompterWidth);
    const wasVisible = this.deps.island.isVisible;
    const notch = this.deps.island.show();
    if (notch?.height !== this.notch?.height || notch?.width !== this.notch?.width) {
      this.notch = notch;
      this.emit();
    }

    if (!wasVisible)
      this.deps.keys.bind({
        onStep: (sentences) => this.jump({ sentences }),
        onPause: () => this.togglePause(),
        onTop: () => this.jump({ to: "top" }),
      });

    // The engine runs only for the length of a take — see `recordingStarted`
    // — so this is for a mode changed mid-take, not for a fresh show.
    if (this.recording) this.runEngine(preferences.teleprompterMode);
  }

  hide(): void {
    if (!this.deps.island.isVisible) return;
    this.deps.island.hide();
    this.deps.keys.unbind();
    this.stopEngine();
  }

  /**
   * A take has begun. The script window would be in it, so it goes; the
   * island stays, and whatever moves the words starts now.
   *
   * Now and not when the island appears: the microphone stays closed — and
   * its menu-bar light off — while the panel is merely open, and auto-scroll
   * does not run the script off the screen before the countdown ends. The
   * keys and a click still move it beforehand, for reading it over.
   */
  recordingStarted(): void {
    this.deps.script.close();
    this.recording = true;
    if (this.deps.island.isVisible) this.runEngine(this.deps.preferences().teleprompterMode);
  }

  /** A take has ended. The engine stops, and it is back to the top for the next one. */
  recordingStopped(): void {
    this.recording = false;
    this.stopEngine();
    this.state = { ...INITIAL_FOLLOW, session: this.state.session };
    this.sendPosition();
  }

  openScript(): void {
    this.deps.script.open();
  }

  /**
   * The script changed under the reader.
   *
   * The position is kept where it can be: an edit to the paragraph after the
   * one being read should not send the highlight back to the top. Clamped,
   * because the script may now be shorter than the position.
   */
  setScript(text: string): void {
    this.deps.store.set(text);
    this.words = tokenise(text);
    this.state = { ...this.state, position: jumpTo(this.words, this.state.position) };
    this.emit();
    this.sendPosition();
    // A new vocabulary for the engine to favour. Restarted rather than
    // updated: neither engine takes a new list mid-session.
    if (this.engine && this.deps.preferences().teleprompterMode === "voice") {
      this.runEngine("voice", true);
    }
  }

  jump(jump: TeleprompterJump): void {
    const position =
      "sentences" in jump
        ? stepSentences(this.words, this.state.position, jump.sentences)
        : jump.to === "top"
          ? jumpTo(this.words, 0)
          : jumpTo(this.words, jump.to);
    // A jump is the reader saying where they are; the follower's misses are
    // wiped so it does not report them lost from a place they just chose.
    this.state = { ...this.state, position, missed: 0, lost: false };
    this.sendPosition();
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.emit();
  }

  /** The island asked for its first position, having just mounted. */
  ready(): void {
    this.sendPosition();
  }

  snapshot(): TeleprompterState {
    return {
      ...IDLE_TELEPROMPTER,
      script: this.deps.store.get(),
      paused: this.paused,
      listening: this.listening,
      notch: this.notch,
    };
  }

  /** Stops the microphone. For quitting: the island is destroyed separately. */
  stopListening(): void {
    this.stopEngine();
  }

  private emit(): void {
    this.deps.onChange(this.snapshot());
  }

  private sendPosition(): void {
    const contents = this.deps.island.browserWindow()?.webContents;
    if (!contents || contents.isDestroyed()) return;
    const position: TeleprompterPosition = {
      position: this.state.position,
      lost: this.state.lost,
      level: this.level,
    };
    contents.send(IPC_CHANNELS.teleprompterPosition, position);
  }

  /**
   * Starts whatever moves the position in this mode, replacing what ran before.
   *
   * `force` restarts an engine of the same kind, which the voice engine needs
   * when the script — and so its vocabulary — changes.
   */
  private runEngine(mode: RecordingPreferences["teleprompterMode"], force = false): void {
    const wanted = mode === "voice" ? "voice" : mode === "timed" ? "timed" : null;
    const speed = this.deps.preferences().teleprompterSpeed;
    const same =
      this.engine?.kind === wanted && (wanted !== "timed" || this.engine?.speed === speed);
    if (!force && same) return;

    this.stopEngine();
    if (wanted === "voice") this.engine = this.listen();
    else if (wanted === "timed") this.engine = this.scroll("timed");
  }

  private stopEngine(): void {
    this.engine?.stop();
    this.engine = null;
    if (this.listening !== "off") {
      this.listening = "off";
      this.level = 0;
      this.emit();
    }
  }

  /**
   * Auto-scroll: one word per tick at the chosen words per minute.
   *
   * Main keeps the clock rather than the island so the position has one owner
   * whatever moves it; the island eases between ticks.
   */
  private scroll(kind: Engine["kind"]): Engine {
    const speed = this.deps.preferences().teleprompterSpeed;
    const timer = setInterval(() => {
      if (this.paused || this.state.position >= this.words.length) return;
      this.state = { ...this.state, position: jumpTo(this.words, this.state.position + 1) };
      this.sendPosition();
    }, 60_000 / speed);
    return { kind, speed, stop: () => clearInterval(timer) };
  }

  /**
   * Voice follow: the recogniser's running hypothesis, through the follower.
   *
   * Every failure lands in `listening` for the island's footer to explain,
   * and the position simply stops moving — the keys still work, and the
   * reader can switch to auto-scroll from the dock.
   */
  private listen(): Engine {
    let stopped = false;
    // Held once resolved so `stop` is synchronous from then on. It has to be:
    // `will-quit` calls it, and a `.then` scheduled during a quit may never run,
    // which would leave the microphone open in a process that is going away.
    let active: Recorder | null = null;
    this.listening = "starting";
    this.emit();

    void this.recorder()
      .then((recorder) => {
        if (stopped) return;
        active = recorder;
        recorder.startListening(
          { locale: systemLocale(), vocabulary: vocabulary(this.words) },
          (error, update) => {
            if (stopped) return;
            if (error) {
              this.listeningFailed("FAILED", error.message);
              return;
            }
            this.onListenUpdate(update);
          },
        );
      })
      .catch((cause: unknown) => {
        this.listeningFailed("FAILED", cause instanceof Error ? cause.message : String(cause));
      });

    return {
      kind: "voice",
      stop: () => {
        stopped = true;
        active?.stopListening();
      },
    };
  }

  private onListenUpdate(update: ListenUpdate): void {
    switch (update.stage) {
      case "listening":
        log("info", "teleprompter: listening");
        this.listening = "on";
        this.emit();
        return;
      case "level":
        // Ten a second, to the island alone: the meter is the one thing that
        // shows the microphone is live before a word has been said.
        this.level = update.level ?? 0;
        this.sendPosition();
        return;
      case "partial":
      case "final": {
        if (this.paused) return;
        const heard = (update.text ?? "").split(/\s+/).filter(Boolean);
        const session = update.session ?? this.state.session;
        const next = follow(this.words, this.state, heard, session);
        const moved = next.position !== this.state.position || next.lost !== this.state.lost;
        this.state = next;
        if (moved) this.sendPosition();
        return;
      }
      case "failed":
        this.listeningFailed(update.code ?? "FAILED", update.message ?? "");
        return;
      case "stopped":
        return;
    }
  }

  private listeningFailed(code: string, message: string): void {
    log("warn", `teleprompter: listening failed (${code}): ${message}`);
    this.listening =
      code === "NO_LOCAL_MODEL" ? "unavailable" : code === "NOT_AUTHORISED" ? "denied" : "failed";
    this.emit();
    // Nothing to follow, so the words scroll instead. The engine is swapped
    // rather than the preference rewritten: a model installed tomorrow should
    // find voice still chosen. It answers for voice — see `Engine` — so the
    // microphone is tried again on the next show, not on the next size change.
    this.engine?.stop();
    this.engine = this.scroll("voice");
  }
}
