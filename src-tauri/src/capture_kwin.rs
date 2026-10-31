//! Native full-desktop capture through the compositor's ScreenShot2 interface.
//!
//! The compositor hands back the frame as raw pixels over a pipe, which avoids
//! starting an external capture utility and avoids encoding the frame at all.

use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use zbus::blocking::Connection;
use zbus::zvariant::{Fd, Value};

pub struct RawFrame {
    pub width: u32,
    pub height: u32,
    /// Tightly packed RGBA rows, `width * height * 4` bytes.
    pub data: Vec<u8>,
}

pub enum CaptureError {
    /// The compositor refused the request for this process.
    Unauthorized,
    /// Anything else: no compositor service, protocol mismatch, read timeout.
    Unavailable,
}

/// Set once the compositor refuses us, so later snips skip straight to the
/// external capture path instead of paying for a failing D-Bus round trip.
static DISABLED: AtomicBool = AtomicBool::new(false);

pub fn is_disabled() -> bool {
    DISABLED.load(Ordering::Relaxed)
}

pub fn capture_workspace() -> Result<RawFrame, CaptureError> {
    if is_disabled() {
        return Err(CaptureError::Unauthorized);
    }

    match capture_inner() {
        Ok(frame) => Ok(frame),
        Err(CaptureError::Unauthorized) => {
            DISABLED.store(true, Ordering::Relaxed);
            Err(CaptureError::Unauthorized)
        }
        Err(err) => Err(err),
    }
}

fn capture_inner() -> Result<RawFrame, CaptureError> {
    let connection = Connection::session().map_err(|_| CaptureError::Unavailable)?;
    let (reader, writer) = std::io::pipe().map_err(|_| CaptureError::Unavailable)?;

    let mut options: HashMap<String, Value<'_>> = HashMap::new();
    options.insert("include-cursor".to_string(), Value::from(false));
    options.insert("native-resolution".to_string(), Value::from(true));

    let reply = connection.call_method(
        Some("org.kde.KWin"),
        "/org/kde/KWin/ScreenShot2",
        Some("org.kde.KWin.ScreenShot2"),
        "CaptureWorkspace",
        &(options, Fd::from(&writer)),
    );

    // Our write end must be gone before the reader can observe the end of the
    // stream the compositor writes into the same pipe.
    drop(writer);

    let reply = match reply {
        Ok(reply) => reply,
        Err(zbus::Error::MethodError(name, _, _))
            if name.as_str() == "org.kde.KWin.ScreenShot2.Error.NoAuthorized" =>
        {
            return Err(CaptureError::Unauthorized);
        }
        Err(_) => return Err(CaptureError::Unavailable),
    };

    let body = reply.body();
    let metadata: HashMap<String, Value<'_>> =
        body.deserialize().map_err(|_| CaptureError::Unavailable)?;

    let width = integer(&metadata, "width").ok_or(CaptureError::Unavailable)?;
    let height = integer(&metadata, "height").ok_or(CaptureError::Unavailable)?;
    let stride = integer(&metadata, "stride").ok_or(CaptureError::Unavailable)?;
    let format = integer(&metadata, "format").unwrap_or(6);

    if width == 0 || height == 0 || stride < width.saturating_mul(4) {
        return Err(CaptureError::Unavailable);
    }

    let pixels = read_stream(reader, Duration::from_secs(3))?;
    let needed = stride as usize * height as usize;
    if pixels.len() < needed {
        return Err(CaptureError::Unavailable);
    }

    Ok(RawFrame {
        width,
        height,
        data: to_rgba(&pixels, width, height, stride, format),
    })
}

fn integer(metadata: &HashMap<String, Value<'_>>, key: &str) -> Option<u32> {
    match metadata.get(key)? {
        Value::U32(value) => Some(*value),
        Value::I32(value) => u32::try_from(*value).ok(),
        Value::U64(value) => u32::try_from(*value).ok(),
        Value::I64(value) => u32::try_from(*value).ok(),
        _ => None,
    }
}

/// Reads the frame stream on a worker thread so a stalled compositor cannot
/// block the capture thread indefinitely.
fn read_stream(mut reader: std::io::PipeReader, timeout: Duration) -> Result<Vec<u8>, CaptureError> {
    let (sender, receiver) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let mut chunk = vec![0u8; 512 * 1024];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => buffer.extend_from_slice(&chunk[..read]),
                Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        let _ = sender.send(buffer);
    });

    receiver.recv_timeout(timeout).map_err(|_| CaptureError::Unavailable)
}

/// Converts the compositor's pixel buffer to packed RGBA.
///
/// The frame is opaque, so the alpha channel is normalised to fully opaque,
/// which also removes any premultiplication the compositor may have applied.
fn to_rgba(source: &[u8], width: u32, height: u32, stride: u32, format: u32) -> Vec<u8> {
    let row_bytes = width as usize * 4;
    let stride = stride as usize;
    let mut rgba = vec![0u8; row_bytes * height as usize];

    // QImage::Format_ARGB32, _Premultiplied and RGB32 store 0xAARRGGBB words,
    // which land in memory as B, G, R, A.
    let is_bgra = matches!(format, 4 | 5 | 6);

    for row in 0..height as usize {
        let start = row * stride;
        let source_row = &source[start..start + row_bytes];
        let target_row = &mut rgba[row * row_bytes..(row + 1) * row_bytes];

        if is_bgra {
            for (target, pixel) in target_row.chunks_exact_mut(4).zip(source_row.chunks_exact(4)) {
                target[0] = pixel[2];
                target[1] = pixel[1];
                target[2] = pixel[0];
                target[3] = 255;
            }
        } else {
            target_row.copy_from_slice(source_row);
        }
    }

    rgba
}
