// A small, stable surface over libx264.
//
// Hand-written rather than generated, and C rather than Rust, for one reason:
// `x264_param_t` is around two hundred fields whose layout changes between
// builds. A Rust mirror of it compiles against any version and silently reads
// the wrong offsets against the one it was not written for — a corrupt
// bitstream with nothing to say why. Here the real header decides the layout at
// compile time and Rust only ever sees the functions below.

#ifndef PREQUEL_X264_SHIM_H
#define PREQUEL_X264_SHIM_H

#include <stdint.h>

typedef struct pq_x264 pq_x264;

// One encoded access unit, ready for an MP4: length-prefixed rather than
// Annex-B, because that is what `avcC` and `CMBlockBuffer` want and x264 will
// produce it directly when asked.
typedef struct {
    const uint8_t *payload;
    int32_t length;
    int64_t pts;
    int64_t dts;
    // Whether a player may start here, which is what `CMSampleBuffer` calls a
    // sync sample.
    int32_t keyframe;
} pq_x264_sample;

// `error` is filled and NULL returned when the encoder will not open.
pq_x264 *pq_x264_open(int32_t width, int32_t height, int32_t fps_num,
                      int32_t fps_den, const char *preset, float crf,
                      int32_t threads, char *error, int32_t error_len);

// The parameter sets, stripped of their length prefix, for the format
// description. Valid until the first `encode` call.
int32_t pq_x264_headers(pq_x264 *enc, const uint8_t **sps, int32_t *sps_len,
                        const uint8_t **pps, int32_t *pps_len);

// Feeds one NV12 frame and takes whatever comes out. Returns 1 when `out` was
// filled, 0 when the encoder is still filling its lookahead and has nothing to
// give back yet, and -1 on failure.
//
// `out->payload` points into the encoder and is invalidated by the next call,
// which is libx264's own contract rather than a shortcut taken here.
int32_t pq_x264_encode(pq_x264 *enc, const uint8_t *y, int32_t y_stride,
                       const uint8_t *uv, int32_t uv_stride, int64_t pts,
                       pq_x264_sample *out);

// Drains the lookahead once the frames have run out. Returns 1 when `out` was
// filled, 2 when nothing came out this time but frames are still held, 0 when
// the encoder is empty, and -1 on failure.
//
// Three states rather than two because the middle one is real: a flush call
// can come back with nothing while frames remain, and treating that as the end
// of the stream loses every frame of a short export. See the comment on the
// implementation.
int32_t pq_x264_flush(pq_x264 *enc, pq_x264_sample *out);

void pq_x264_close(pq_x264 *enc);

#endif
