use std::path::PathBuf;
use std::process::Command;

use prequel_render::{
    CancelFlag, ExportRequest, OutputFormat, Paint, PlanItem, PlanSource, Rect, RenderPlan, Shape,
    Size, SliceRender, export, timeline::AudioMix,
};

#[test]
fn exports_the_users_real_session_with_sound() {
    let dir = PathBuf::from("/Users/haxzie/Movies/Prequel/Prequel 2026-08-18 15-21-44");
    let output = PathBuf::from(
        "/private/tmp/claude-501/-Users-haxzie-projects-prequel/dd3474d3-6bf4-478c-ad68-21ce22524dfd/scratchpad/real-check.mp4",
    );
    let _ = std::fs::remove_file(&output);

    let (w, h) = (1280u32, 800u32);
    let plan = RenderPlan {
        frame: Size {
            width: w as f64,
            height: h as f64,
        },
        items: vec![
            PlanItem::Fill {
                rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: w as f64,
                    height: h as f64,
                },
                paint: Paint::Solid {
                    color: "#101014".to_owned(),
                },
            },
            PlanItem::Image {
                source: PlanSource::Screen,
                src_rect: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 3024.0,
                    height: 1898.0,
                },
                dst_rect: Rect {
                    x: 40.0,
                    y: 40.0,
                    width: w as f64 - 80.0,
                    height: h as f64 - 80.0,
                },
                shape: Shape {
                    radius: 12.0,
                    exponent: 4.0,
                },
                mirror: false,
                motion: Vec::new(),
            },
        ],
    };

    // The two clips this project actually has, in source time.
    let slices = vec![
        SliceRender {
            start: 1_522_404_822,
            end: 9_322_724_747,
            plan: plan.clone(),
            audio: AudioMix {
                mic: 1.0,
                system: 1.0,
            },
        },
        SliceRender {
            start: 12_900_601_134,
            end: 36_349_306_625,
            plan,
            audio: AudioMix {
                mic: 1.0,
                system: 1.0,
            },
        },
    ];

    let request = ExportRequest {
        session_dir: dir,
        output: output.clone(),
        width: w,
        height: h,
        fps: 30,
        format: OutputFormat::Mp4,
        slices,
        screen_offset: 0,
        camera_offset: 0,
        mic_offset: 0,
        system_offset: 22_867_500,
    };

    let started = std::time::Instant::now();
    let summary = export(&request, &CancelFlag::new(), &mut |p| {
        if p.frames_done % 30 == 0 {
            println!(
                "  [{:>6.1}s] {:?} {}/{}",
                started.elapsed().as_secs_f64(),
                p.stage,
                p.frames_done,
                p.frames_total
            );
        }
    })
    .expect("export");
    println!(
        "frames {} duration {:.3}s",
        summary.frames,
        summary.duration as f64 / 1e9
    );

    let probe = |stream: &str| {
        let out = Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-select_streams",
                stream,
                "-show_entries",
                "stream=codec_type,codec_name,channels,sample_rate,duration",
                "-of",
                "default=noprint_wrappers=1",
            ])
            .arg(&output)
            .output()
            .expect("ffprobe");
        String::from_utf8_lossy(&out.stdout).trim().to_owned()
    };
    println!("--- video ---\n{}", probe("v:0"));
    println!("--- audio ---\n{}", probe("a:0"));
    println!(
        "sidecar left behind: {}",
        output.with_extension("m4a").exists()
    );
    println!("size {} bytes", std::fs::metadata(&output).unwrap().len());

    assert!(
        probe("a:0").contains("codec_type=audio"),
        "the real export must carry sound"
    );
}
