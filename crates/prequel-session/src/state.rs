//! Recording lifecycle.
//!
//! Modelled explicitly because the UI can issue any command at any moment — a
//! global hotkey during finalisation, a double-click on stop, a pause that
//! races the first frame — and every one of those must resolve to a defined
//! outcome rather than a half-written file.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordingState {
    Idle,
    /// Streams are starting; no samples have been written yet.
    Preparing,
    Recording,
    Paused,
    /// Draining the encoders and closing the files.
    Finalising,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    Start,
    Pause,
    Resume,
    Stop,
    /// The first sample arrived, so capture is genuinely live.
    FirstSample,
    /// Finalisation completed.
    Finalised,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("cannot {command:?} while {state:?}")]
pub struct InvalidTransition {
    pub state: RecordingState,
    pub command: Command,
}

impl RecordingState {
    pub fn is_active(self) -> bool {
        matches!(self, Self::Preparing | Self::Recording | Self::Paused)
    }

    /// Whether samples should be written in this state.
    pub fn accepts_samples(self) -> bool {
        matches!(self, Self::Recording)
    }

    pub fn apply(self, command: Command) -> Result<Self, InvalidTransition> {
        use Command::*;
        use RecordingState::*;

        let next = match (self, command) {
            (Idle, Start) => Preparing,
            (Preparing, FirstSample) => Recording,

            (Recording, Pause) => Paused,
            (Paused, Resume) => Recording,

            // Stopping while still preparing is legitimate — the user hit the
            // hotkey twice, or cancelled before the first frame landed.
            (Preparing | Recording | Paused, Stop) => Finalising,
            (Finalising, Finalised) => Idle,

            // Idempotent: repeating the command that produced the current
            // state is a double-click, not an error.
            (Preparing, Start) | (Recording, Resume) | (Paused, Pause) => self,

            _ => {
                return Err(InvalidTransition {
                    state: self,
                    command,
                });
            }
        };
        Ok(next)
    }
}

#[cfg(test)]
mod tests {
    use super::Command::*;
    use super::RecordingState::*;
    use super::*;

    /// Drives a state through a sequence, asserting each step succeeds.
    fn run(start: RecordingState, commands: &[Command]) -> RecordingState {
        commands.iter().fold(start, |state, &command| {
            state
                .apply(command)
                .unwrap_or_else(|e| panic!("unexpected rejection: {e}"))
        })
    }

    #[test]
    fn happy_path_returns_to_idle() {
        assert_eq!(run(Idle, &[Start, FirstSample, Stop, Finalised]), Idle);
    }

    #[test]
    fn pause_and_resume_round_trip() {
        assert_eq!(
            run(Idle, &[Start, FirstSample, Pause, Resume, Pause, Resume]),
            Recording
        );
    }

    #[test]
    fn stopping_while_paused_still_finalises() {
        assert_eq!(run(Idle, &[Start, FirstSample, Pause, Stop]), Finalising);
    }

    #[test]
    fn stopping_before_the_first_frame_is_allowed() {
        // The user hit the hotkey twice in quick succession.
        assert_eq!(run(Idle, &[Start, Stop]), Finalising);
    }

    #[test]
    fn repeated_commands_are_idempotent() {
        assert_eq!(run(Idle, &[Start, Start]), Preparing);
        assert_eq!(run(Idle, &[Start, FirstSample, Resume]), Recording);
        assert_eq!(run(Idle, &[Start, FirstSample, Pause, Pause]), Paused);
    }

    #[test]
    fn commands_are_rejected_outside_their_state() {
        for &command in &[Pause, Resume, Stop, FirstSample, Finalised] {
            assert!(
                Idle.apply(command).is_err(),
                "Idle should reject {command:?}"
            );
        }
        assert!(Recording.apply(Start).is_err());
        assert!(Finalising.apply(Stop).is_err());
        assert!(Finalising.apply(Pause).is_err());
    }

    #[test]
    fn only_recording_accepts_samples() {
        assert!(Recording.accepts_samples());
        for state in [Idle, Preparing, Paused, Finalising] {
            assert!(
                !state.accepts_samples(),
                "{state:?} must not accept samples"
            );
        }
    }

    #[test]
    fn active_covers_every_state_a_stop_is_valid_in() {
        for state in [Idle, Preparing, Recording, Paused, Finalising] {
            assert_eq!(
                state.is_active(),
                state.apply(Stop).is_ok(),
                "{state:?}: is_active must agree with stoppability"
            );
        }
    }

    #[test]
    fn rejected_transitions_leave_the_state_untouched() {
        let state = Recording;
        assert!(state.apply(Start).is_err());
        assert_eq!(state, Recording);
    }
}
