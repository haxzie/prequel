//! The rectangles a display is made of, for the area picker to snap to.

use napi::bindgen_prelude::{AsyncTask, Env, Error, Result, Task};
use napi_derive::napi;

/// One rectangle on screen, in points relative to the display's own origin.
///
/// Points rather than pixels, and relative rather than global, because the
/// overlay draws in CSS pixels local to the display it covers — so these
/// numbers go straight into a `style` with no conversion to get wrong.
#[napi(object)]
#[derive(Debug)]
pub struct ShapeRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Looks at a display and works out what rectangles are drawn on it.
///
/// Off the main thread, because it takes one screenshot and walks it — tens of
/// milliseconds, which is a dropped frame in every window the app has open if
/// it ran where the napi call arrives.
///
/// `excludedWindowIds` are kept out of the shot; pass the picker's own overlays
/// or the only shape found is a sheet of dimming.
#[napi(ts_return_type = "Promise<ShapeRect[]>")]
pub fn find_shapes(display_id: u32, excluded_window_ids: Vec<u32>) -> AsyncTask<FindShapes> {
    AsyncTask::new(FindShapes {
        display_id,
        excluded: excluded_window_ids,
    })
}

pub struct FindShapes {
    display_id: u32,
    excluded: Vec<u32>,
}

impl Task for FindShapes {
    type Output = Vec<ShapeRect>;
    type JsValue = Vec<ShapeRect>;

    fn compute(&mut self) -> Result<Self::Output> {
        let shapes = prequel_capture::find_shapes(self.display_id, &self.excluded)
            .map_err(|err| Error::from_reason(format!("SHAPES: {err}")))?;

        Ok(shapes
            .into_iter()
            .map(|rect| ShapeRect {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
            })
            .collect())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}
