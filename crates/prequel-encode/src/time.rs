//! The host clock, and the conversion every capture pipeline needs.
//!
//! [`prequel_session`] deliberately knows nothing about Apple frameworks, so it
//! defines `HostTime` as "nanoseconds on the host clock" and leaves someone
//! else to produce them. This is that someone — one implementation, shared by
//! the screen and camera pipelines, rather than a copy in each.

use cidre::cm;
use prequel_session::HostTime;

/// Converts a `CMTime` to nanoseconds on the host clock.
///
/// Returns `None` for a timestamp that cannot be placed on a timeline at all:
/// a zero timescale would divide by zero, and a negative value would wrap into
/// an enormous `u64` and shove the sample into the far future.
pub fn host_nanos(time: cm::Time) -> Option<HostTime> {
    if time.scale <= 0 || time.value < 0 {
        return None;
    }
    // In u128: host clock values are large enough that nanoseconds overflow a
    // u64 multiplication partway through the arithmetic.
    Some((time.value as u128 * 1_000_000_000 / time.scale as u128) as HostTime)
}

/// The host clock, now.
///
/// The *same* clock CoreMedia stamps capture samples with — which is time since
/// boot, not time since the epoch. Anchoring a recording with a wall-clock
/// reading instead puts the origin decades ahead of every sample, and the whole
/// recording is silently discarded as "arrived before the start".
pub fn host_now() -> HostTime {
    host_nanos(cm::Clock::host_time_clock().time()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cmtime_converts_to_nanoseconds() {
        // 1/60 s at a 600 timescale.
        assert_eq!(host_nanos(cm::Time::new(10, 600)), Some(16_666_666));
        assert_eq!(host_nanos(cm::Time::new(1, 1)), Some(1_000_000_000));
        assert_eq!(host_nanos(cm::Time::new(1, 30)), Some(33_333_333));
    }

    #[test]
    fn invalid_cmtimes_are_rejected_rather_than_wrapping() {
        assert_eq!(host_nanos(cm::Time::new(10, 0)), None);
        assert_eq!(host_nanos(cm::Time::new(-1, 600)), None);
    }

    #[test]
    fn large_timestamps_do_not_overflow() {
        let hours = cm::Time::new(24 * 60 * 60 * 24_000_000, 24_000_000);
        assert_eq!(host_nanos(hours), Some(86_400 * 1_000_000_000));
    }

    #[test]
    fn the_host_clock_is_uptime_not_wall_clock() {
        // The bug this guards against: a wall-clock reading is ~1.7e18 ns since
        // the epoch, while sample timestamps are time since boot. Anchoring
        // with the wrong one drops every frame in the recording.
        let epoch_nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64;

        let now = host_now();
        assert!(now > 0, "the host clock must be readable");
        assert!(
            now < epoch_nanos / 100,
            "host_now looks like a wall clock: {now} vs epoch {epoch_nanos}"
        );
    }

    #[test]
    fn the_host_clock_advances() {
        let first = host_now();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let second = host_now();
        assert!(second > first, "{second} must be after {first}");
    }
}
