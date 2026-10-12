#include "shim.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <x264.h>

struct pq_x264 {
    x264_t *encoder;
    x264_param_t param;
    x264_picture_t picture;
    // The headers, held so `pq_x264_headers` can hand out pointers that
    // outlive x264's own — which the next `encode` call invalidates.
    uint8_t *sps;
    int32_t sps_len;
    uint8_t *pps;
    int32_t pps_len;
    // Where the NALs of one access unit are joined. x264 hands back an array
    // of NALs whose payloads are already contiguous, so this is only needed
    // for the pointer and length of the whole run.
    int64_t next_pts;
};

static void fail(char *error, int32_t len, const char *message) {
    if (error && len > 0) {
        snprintf(error, (size_t)len, "%s", message);
    }
}

pq_x264 *pq_x264_open(int32_t width, int32_t height, int32_t fps_num,
                      int32_t fps_den, const char *preset, float crf,
                      int32_t threads, char *error, int32_t error_len) {
    pq_x264 *enc = calloc(1, sizeof(pq_x264));
    if (!enc) {
        fail(error, error_len, "out of memory");
        return NULL;
    }

    // No tune: every one of them trades picture for something this does not
    // want. `zerolatency` in particular turns off frame threading, which is
    // where most of the speed is.
    if (x264_param_default_preset(&enc->param, preset, NULL) < 0) {
        fail(error, error_len, "unknown preset");
        free(enc);
        return NULL;
    }

    // NV12 rather than I420, and the reason is on the other side: the frame
    // comes out of a Metal kernel into a `CVPixelBuffer`, and
    // `CVMetalTextureCache` wraps a two-plane buffer's planes as textures
    // where a three-plane one is not in its supported list. libx264
    // deinterleaves the chroma itself, over half a megabyte at 1080p, which is
    // nothing beside doing the colour conversion on the CPU.
    enc->param.i_csp = X264_CSP_NV12;
    enc->param.i_width = width;
    enc->param.i_height = height;
    enc->param.i_fps_num = fps_num;
    enc->param.i_fps_den = fps_den;

    // Timestamps in nanoseconds, matching `prequel_session::MediaTime`, so
    // nothing between the export loop and here has to convert a frame index
    // and round it. The frame rate above is still what rate control reads.
    enc->param.b_vfr_input = 1;
    enc->param.i_timebase_num = 1;
    enc->param.i_timebase_den = 1000000000;

    // No B-frames. They cost reordering for a few percent of file size on
    // screen content, and reordering is what would put a DTS before zero.
    enc->param.i_bframe = 0;

    // Length-prefixed NALs and parameter sets only on request: both are what
    // an MP4 wants. With `b_repeat_headers` on, every keyframe carries another
    // copy of the SPS and PPS inside the sample, which some demuxers then read
    // in preference to `avcC`.
    enc->param.b_annexb = 0;
    enc->param.b_repeat_headers = 0;
    enc->param.b_aud = 0;

    // Constant quality rather than a bitrate. A screen recording is mostly
    // still, and a bitrate spends the same bits on a motionless frame as on a
    // fast pan — which is both bigger and worse than letting the quantiser
    // move.
    enc->param.rc.i_rc_method = X264_RC_CRF;
    enc->param.rc.f_rf_constant = crf;

    // Rec. 709, full range off, to match what every other writer here tags and
    // what the compositor's conversion assumes. Untagged H.264 is read as 709
    // by most players and as 601 by some, which shows as a colour shift in one
    // player and not another.
    enc->param.vui.i_colorprim = 1;
    enc->param.vui.i_transfer = 1;
    enc->param.vui.i_colmatrix = 1;
    enc->param.vui.b_fullrange = 0;

    // Keyframes at most two seconds apart, so seeking in the editor and in a
    // browser stays responsive on a long export.
    enc->param.i_keyint_max = fps_num / fps_den * 2;

    // Zero is x264's own "use 1.5 times the core count". See `x264::threads`
    // for why the caller asks for fewer than that.
    enc->param.i_threads = threads > 0 ? threads : 0;

    enc->param.i_log_level = X264_LOG_WARNING;


    if (x264_param_apply_profile(&enc->param, "high") < 0) {
        fail(error, error_len, "the high profile was refused");
        free(enc);
        return NULL;
    }

    enc->encoder = x264_encoder_open(&enc->param);
    if (!enc->encoder) {
        fail(error, error_len, "x264_encoder_open failed");
        free(enc);
        return NULL;
    }

    x264_picture_init(&enc->picture);
    enc->picture.img.i_csp = X264_CSP_NV12;
    enc->picture.img.i_plane = 2;

    return enc;
}

int32_t pq_x264_headers(pq_x264 *enc, const uint8_t **sps, int32_t *sps_len,
                        const uint8_t **pps, int32_t *pps_len) {
    x264_nal_t *nals = NULL;
    int count = 0;
    if (x264_encoder_headers(enc->encoder, &nals, &count) < 0) {
        return -1;
    }

    for (int i = 0; i < count; i++) {
        // Four bytes of length in front of each, because `b_annexb` is off.
        // The format description wants the naked NAL.
        const uint8_t *body = nals[i].p_payload + 4;
        int32_t length = nals[i].i_payload - 4;
        if (length <= 0) {
            continue;
        }
        if (nals[i].i_type == NAL_SPS) {
            free(enc->sps);
            enc->sps = malloc((size_t)length);
            if (!enc->sps) return -1;
            memcpy(enc->sps, body, (size_t)length);
            enc->sps_len = length;
        } else if (nals[i].i_type == NAL_PPS) {
            free(enc->pps);
            enc->pps = malloc((size_t)length);
            if (!enc->pps) return -1;
            memcpy(enc->pps, body, (size_t)length);
            enc->pps_len = length;
        }
    }

    if (!enc->sps || !enc->pps) {
        return -1;
    }

    *sps = enc->sps;
    *sps_len = enc->sps_len;
    *pps = enc->pps;
    *pps_len = enc->pps_len;
    return 0;
}

static int32_t take(pq_x264 *enc, x264_nal_t *nals, int count, int size,
                    x264_picture_t *out_pic, pq_x264_sample *out) {
    (void)nals;
    (void)count;
    if (size <= 0) {
        return 0;
    }
    // One access unit, and x264 writes the run of NALs for it into one
    // contiguous buffer, so the first NAL's payload is the start of all of it.
    out->payload = nals[0].p_payload;
    out->length = size;
    out->pts = out_pic->i_pts;
    out->dts = out_pic->i_dts;
    out->keyframe = out_pic->b_keyframe ? 1 : 0;
    (void)enc;
    return 1;
}

int32_t pq_x264_encode(pq_x264 *enc, const uint8_t *y, int32_t y_stride,
                       const uint8_t *uv, int32_t uv_stride, int64_t pts,
                       pq_x264_sample *out) {
    enc->picture.img.plane[0] = (uint8_t *)y;
    enc->picture.img.i_stride[0] = y_stride;
    enc->picture.img.plane[1] = (uint8_t *)uv;
    enc->picture.img.i_stride[1] = uv_stride;
    enc->picture.i_pts = pts;
    // Let x264 decide, rather than forcing an IDR on a cadence of our own.
    enc->picture.i_type = X264_TYPE_AUTO;

    x264_nal_t *nals = NULL;
    int count = 0;
    x264_picture_t out_pic;
    int size = x264_encoder_encode(enc->encoder, &nals, &count, &enc->picture,
                                   &out_pic);
    if (size < 0) {
        return -1;
    }
    return take(enc, nals, count, size, &out_pic, out);
}

int32_t pq_x264_flush(pq_x264 *enc, pq_x264_sample *out) {
    // Driven by the delayed-frame count, and it has to be: a flush call can
    // come back empty while frames are still held. Measured on a three-frame
    // sequence — three frames in, nothing out, `delayed_frames` reporting 3,
    // and the first `encode(NULL)` returning 0 with all three still inside.
    //
    // Stopping at the first empty answer therefore loses every frame of any
    // export shorter than the lookahead, around 28 frames. It fails quietly in
    // the worst way: the file comes out holding no samples, the writer reports
    // success unless it was also asked to optimise for network use, and the
    // summary still counts every frame as written. `a_short_export_keeps_every_frame`
    // pins it.
    if (x264_encoder_delayed_frames(enc->encoder) <= 0) {
        return 0;
    }

    x264_nal_t *nals = NULL;
    int count = 0;
    x264_picture_t out_pic;
    int size = x264_encoder_encode(enc->encoder, &nals, &count, NULL, &out_pic);
    if (size < 0) {
        return -1;
    }
    if (size == 0) {
        // Nothing this time, but there is more in there. Distinct from 0 so the
        // caller keeps asking rather than concluding the stream has ended.
        return 2;
    }
    return take(enc, nals, count, size, &out_pic, out);
}

void pq_x264_close(pq_x264 *enc) {
    if (!enc) {
        return;
    }
    if (enc->encoder) {
        x264_encoder_close(enc->encoder);
    }
    free(enc->sps);
    free(enc->pps);
    free(enc);
}
