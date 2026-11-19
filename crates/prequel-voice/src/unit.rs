//! One Apple audio unit, driven offline over a buffer in memory.
//!
//! Every effect this crate uses is an `aufx` component that Apple ships with
//! the OS, opened the same way and rendered the same way; only the subtype and
//! the parameters differ. This is that shape, once.
//!
//! **Once, deliberately.** The render loop below has a trap in it that costs a
//! day to find and returns `noErr` the whole time — see [`Effect::process`].
//! Four copies of it, one per stage of the chain, is four chances to paste it
//! slightly wrong, and the symptom is a silent track rather than an error.
//!
//! Driven through AudioToolbox rather than `AVAudioEngine`: the input is
//! already a buffer in memory and each unit is rendered on its own, so an
//! engine would add a player node, a mixer and a format negotiation to arrive
//! at the same samples.

use cidre::{
    at::{
        au,
        audio::{self, ComponentDesc},
    },
    cat, os,
};

use crate::{Error, Result};

/// How many frames go through a unit at a time.
///
/// Nothing here is real time, so this is a memory decision rather than a
/// latency one: a forty-minute take never has to be resident, only a chunk of
/// it and the units' own lookahead.
pub const CHUNK: usize = 4096;

/// The input the render callback hands over, and how much of it is real.
struct Chunk {
    samples: Vec<f32>,
    /// Frames of `samples` that came from the file. The rest is the silence
    /// that pushes the unit's lookahead out at the end of the track.
    frames: usize,
}

/// Serves the unit its input.
///
/// Called from inside `render`, on this thread, before `render` returns —
/// there is no audio thread anywhere in this crate, so nothing else can be
/// looking at the chunk while this runs.
extern "C-unwind" fn feed(
    ref_con: *mut Chunk,
    _flags: &mut au::RenderActionFlags,
    _timestamp: &cat::AudioTimeStamp,
    _bus: u32,
    frames: u32,
    io_data: *mut cat::AudioBufList<1>,
) -> os::Status {
    // Safety: `io_data` is the unit's list for this call and `ref_con` is the
    // box `Effect` keeps alive for the unit's whole life.
    let (list, chunk) = unsafe {
        match (io_data.as_mut(), ref_con.as_mut()) {
            (Some(list), Some(chunk)) => (list, chunk),
            // `kAudio_ParamError`. Reached only if AudioToolbox hands back a
            // null list, which would be a framework bug — but a status is a
            // better answer than a dereference.
            _ => return os::Status(-50),
        }
    };

    let buffer = &mut list.buffers[0];
    let have = chunk.frames.min(frames as usize);

    if buffer.data.is_null() {
        // The unit allocated nothing and wants to be pointed at ours.
        buffer.data = chunk.samples.as_ptr().cast_mut().cast::<u8>();
        buffer.data_bytes_size = frames * 4;
        buffer.number_channels = 1;
        return os::Status::NO_ERR;
    }

    // Safety: the buffer holds `data_bytes_size` bytes of `f32`, which is what
    // the stream format set on the input scope promised the unit.
    let target = unsafe {
        std::slice::from_raw_parts_mut(
            buffer.data.cast::<f32>(),
            (buffer.data_bytes_size / 4) as usize,
        )
    };
    let run = have.min(target.len());
    target[..run].copy_from_slice(&chunk.samples[..run]);
    // Silence past the end of the file rather than whatever the buffer held
    // last time, which would replay the previous chunk into the tail.
    target[run..].fill(0.0);

    os::Status::NO_ERR
}

/// One open unit, fed a chunk at a time.
pub struct Effect {
    unit: au::UnitRef<audio::component::InitializedState>,
    /// The chunk the render callback serves. Boxed so it keeps one address for
    /// as long as the unit holds a pointer to it.
    input: Box<Chunk>,
    output: Vec<f32>,
    latency: u64,
    /// Frames rendered so far, which is the timestamp of the next render.
    ///
    /// Not bookkeeping — the unit reads it. See [`Effect::process`].
    rendered: f64,
}

impl Effect {
    /// Opens the Apple effect with this subtype, mono, at `sample_rate`.
    ///
    /// `configure` runs **after** `initialize`, which is where the parameters
    /// have to be set: a parameter set on an uninitialised unit is taken and
    /// then thrown away with the rest of the state the unit rebuilds when it
    /// allocates, so the render would run at the defaults whatever was asked
    /// for. This cost a day on the isolation unit; the closure exists so no
    /// caller has to remember.
    ///
    /// `prepare` runs **before** it, for the handful of settings that are
    /// properties rather than parameters and so have to be in place before the
    /// unit allocates — the band count on the EQ is the only one here.
    pub fn open(
        sub_type: au::SubType,
        sample_rate: f64,
        prepare: impl FnOnce(&mut au::UnitRef<audio::component::UninitializedState>) -> Result<()>,
        configure: impl FnOnce(&mut Self) -> Result<()>,
    ) -> Result<Self> {
        let desc = ComponentDesc {
            type_: au::Type::EFFECT.0,
            sub_type: sub_type.0,
            manufacturer: au::Manufacturer::APPLE.0,
            flags: 0,
            flags_mask: 0,
        };

        let component = desc.into_iter().next().ok_or(Error::Unavailable)?;
        let mut unit = component.open_unit().map_err(Error::unit)?;

        let format = mono_float(sample_rate);
        unit.set_stream_format(au::Scope::INPUT, 0, &format)
            .map_err(Error::unit)?;
        unit.set_stream_format(au::Scope::OUTPUT, 0, &format)
            .map_err(Error::unit)?;
        unit.set_max_frames_per_slice(CHUNK as u32)
            .map_err(Error::unit)?;
        // "This is not a live render, take the time you need." Offered rather
        // than required: several of these units have no
        // `kAudioUnitProperty_OfflineRender` and answer -10879,
        // `kAudioUnitErr_InvalidProperty`, which is not a failure — they
        // render the same either way. Units that do have it are allowed to
        // spend more on a chunk than a deadline would permit.
        let _ = unit.set_offline_render(true);

        prepare(&mut unit)?;

        let input = Box::new(Chunk {
            samples: vec![0.0; CHUNK],
            frames: 0,
        });
        unit.set_input_cb(0, feed, std::ptr::from_ref(input.as_ref()))
            .map_err(Error::unit)?;

        let unit = unit.initialize().map_err(Error::unit)?;

        // The unit may look ahead, and AudioToolbox does not compensate for
        // it: what comes out of a render is what went in some milliseconds
        // before it. Measured at 56 ms on the isolation unit, 2705 frames at
        // 48 kHz. Left in, the cleaned microphone lands that far behind the
        // picture — which reads as bad lip sync rather than as a bug, and only
        // on the take, not the file.
        let latency: f64 = unit
            .unit()
            .prop(au::PropId::LATENCY, au::Scope::GLOBAL, au::Element(0))
            .unwrap_or(0.0);

        let mut effect = Self {
            unit,
            input,
            output: vec![0.0; CHUNK],
            latency: (latency * sample_rate).round() as u64,
            rendered: 0.0,
        };

        configure(&mut effect)?;
        Ok(effect)
    }

    /// Frames of lookahead this unit adds, which the caller has to drop.
    pub fn latency(&self) -> u64 {
        self.latency
    }

    /// Sets one global parameter, naming the unit's refusal.
    pub fn set(&mut self, param: au::ParamId, value: f32) -> Result<()> {
        self.unit
            .unit_mut()
            .set_param(param, au::Scope::GLOBAL, au::Element(0), value, 0)
            .map_err(Error::unit)
    }

    /// Runs one chunk: `samples` in, the unit's answer back in its place.
    ///
    /// `samples` may be shorter than [`CHUNK`] only at the end of the track.
    /// The unit is rendered a full chunk regardless, so its state advances at
    /// one rate from end to end, and the short tail is padded with silence.
    pub fn process(&mut self, samples: &mut [f32]) -> Result<()> {
        debug_assert!(samples.len() <= CHUNK);

        self.input.samples[..samples.len()].copy_from_slice(samples);
        self.input.samples[samples.len()..].fill(0.0);
        self.input.frames = samples.len();

        let mut list = cat::AudioBufList::<1> {
            number_buffers: 1,
            buffers: [cat::AudioBuf {
                number_channels: 1,
                data_bytes_size: (CHUNK * 4) as u32,
                data: self.output.as_mut_ptr().cast::<u8>(),
            }],
        };

        // The timestamp has to advance, and this is the trap in the whole
        // file. An audio unit treats a render at a sample time it has already
        // rendered as a *second ask for the same frames* and hands back what
        // it produced then, without pulling its input at all — which is
        // correct for a graph where two nodes share a source, and fatal here.
        // With `AudioTimeStamp::invalid()` every chunk looked like time zero:
        // the unit ran once, cached, and replayed that first chunk for the
        // whole track. A take whose first chunk is silence — every take, since
        // nobody starts talking on the first sample — came back silent from
        // end to end, with every call returning `noErr`.
        let timestamp = cat::AudioTimeStamp::with_sample_time(self.rendered);
        self.unit
            .render(&timestamp, 0, CHUNK as u32, &mut list)
            .map_err(Error::unit)?;
        self.rendered += CHUNK as f64;

        samples.copy_from_slice(&self.output[..samples.len()]);
        Ok(())
    }
}

/// Packed 32-bit float, one channel.
///
/// The canonical audio unit format. Interleaved is accepted by some units and
/// refused by others; this is never refused.
fn mono_float(sample_rate: f64) -> cat::AudioStreamBasicDesc {
    cat::AudioStreamBasicDesc {
        sample_rate,
        format: cat::AudioFormat::LINEAR_PCM,
        format_flags: cat::AudioFormatFlags::IS_FLOAT
            | cat::AudioFormatFlags::IS_PACKED
            | cat::AudioFormatFlags::IS_NON_INTERLEAVED,
        bytes_per_packet: 4,
        frames_per_packet: 1,
        bytes_per_frame: 4,
        channels_per_frame: 1,
        bits_per_channel: 32,
        reserved: 0,
    }
}
