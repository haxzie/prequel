//! A small, fixed random number generator.
//!
//! Not `rand`: the variation between presses has to come out the same on every
//! build, or a project exported today and again after an update would sound
//! different for no reason anyone could point to — and the preview would agree
//! with neither. SplitMix64 is a page of code with a published reference
//! output, which is the property that matters here. Its statistical quality is
//! far beyond what a ±6 % detune needs.

/// SplitMix64 (Steele, Lea & Flood, 2014).
#[derive(Debug, Clone)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    /// Seeds from text — a session id, a profile name — by FNV-1a.
    ///
    /// Any stable hash would do; `DefaultHasher` is explicitly not stable
    /// across Rust versions, which is the one thing this may not be.
    pub fn from_str(text: &str) -> Self {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in text.bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        Self(hash)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// Uniform in `[0, 1)`.
    pub fn next_f32(&mut self) -> f32 {
        // The top 24 bits, so the value is exact in an f32 and never rounds
        // up to 1.0.
        (self.next_u64() >> 40) as f32 / (1u32 << 24) as f32
    }

    /// Uniform in `[low, high)`.
    pub fn range(&mut self, low: f32, high: f32) -> f32 {
        low + (high - low) * self.next_f32()
    }

    /// `1 ± spread`, for scaling a nominal value.
    pub fn around(&mut self, spread: f32) -> f32 {
        self.range(1.0 - spread, 1.0 + spread)
    }

    /// Uniform in `0..n`.
    pub fn below(&mut self, n: usize) -> usize {
        (self.next_u64() % n as u64) as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_reference_sequence() {
        // The first outputs of SplitMix64 seeded with 0, from the reference
        // implementation. If this changes, every recording ever made would
        // re-export with different sounds.
        let mut rng = Rng::new(0);
        assert_eq!(rng.next_u64(), 0xe220_a839_7b1d_cdaf);
        assert_eq!(rng.next_u64(), 0x6e78_9e6a_a1b9_65f4);
    }

    #[test]
    fn floats_stay_inside_the_unit_interval() {
        let mut rng = Rng::from_str("prequel");
        for _ in 0..10_000 {
            let value = rng.next_f32();
            assert!((0.0..1.0).contains(&value));
        }
    }

    #[test]
    fn text_seeds_are_stable_and_distinct() {
        assert_eq!(Rng::from_str("a").0, Rng::from_str("a").0);
        assert_ne!(Rng::from_str("a").0, Rng::from_str("b").0);
    }
}
