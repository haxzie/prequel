use prequel_render::plan::{Rect, RectKey};

#[test]
fn test_blur_rect() {
    let keys = vec![
        RectKey { at: 4999999999, x: 0.0, y: 0.0, width: 0.0, height: 0.0, radius: 0.0, focus: None, vignette: None, quad: vec![] },
        RectKey { at: 5000000000, x: 100.0, y: 100.0, width: 200.0, height: 200.0, radius: 0.0, focus: None, vignette: None, quad: vec![] },
        RectKey { at: 10000000000, x: 100.0, y: 100.0, width: 200.0, height: 200.0, radius: 0.0, focus: None, vignette: None, quad: vec![] },
    ];
    let at = 5500000000;
    let active_rect = prequel_render::plan::rect_at(&keys, at, Rect { x: 0.0, y: 0.0, width: 0.0, height: 0.0 }, 0.0).rect;
    println!("active_rect at {}: {:?}", at, active_rect);
    assert!(active_rect.width > 0.0);
}
