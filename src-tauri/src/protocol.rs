//! moyu-bg:// 只读协议（移植自 backgrounds.js 的 handle），支持 Range（视频循环/拖动）

use std::fs;
use std::io::{Read, Seek, SeekFrom};

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, UriSchemeContext};

use crate::backgrounds;
use crate::state::AppState;

fn is_hex16(s: &str) -> bool {
    s.len() == 16 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// 校验并返回磁盘文件名（`<id>.<ext>` 或 `<id>.thumb.png`）
fn parse_name(name: &str) -> Option<String> {
    if let Some(id) = name.strip_suffix(".thumb.png") {
        if is_hex16(id) {
            return Some(name.to_string());
        }
    }
    if let Some(dot) = name.rfind('.') {
        let (id, ext) = name.split_at(dot);
        let ext = &ext[1..];
        if is_hex16(id) && backgrounds::format_info(ext).is_some() {
            return Some(name.to_string());
        }
    }
    None
}

fn mime_of(name: &str) -> String {
    if name.ends_with(".thumb.png") {
        return "image/png".to_string();
    }
    let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    backgrounds::format_info(ext)
        .map(|fi| fi.mime.to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string())
}

/// 解析 Range 头（对应 JS 的 `^bytes=(\d*)-(\d*)$`），返回 (start, end) 闭区间
fn parse_range(range: &str, size: u64) -> Option<(u64, u64)> {
    let rest = range.trim().strip_prefix("bytes=")?;
    let (a, b) = rest.split_once('-')?;
    let last = size.saturating_sub(1);
    let a_has = !a.is_empty();
    let b_has = !b.is_empty();
    if a_has {
        let start: u64 = a.parse().ok()?;
        let end = if b_has {
            b.parse::<u64>().ok()?.min(last)
        } else {
            last
        };
        Some((start, end))
    } else if b_has {
        let n: u64 = b.parse().ok()?;
        Some((size.saturating_sub(n), last))
    } else {
        None
    }
}

pub fn handle(ctx: UriSchemeContext<'_, tauri::Wry>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let app: &AppHandle<tauri::Wry> = ctx.app_handle();

    let path = request.uri().path();
    let name = match parse_name(path.trim_start_matches('/')) {
        Some(n) => n,
        None => {
            return Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap();
        }
    };

    let data_dir = app.state::<AppState>().lock().data_dir.clone();
    let file = data_dir.join("backgrounds").join(&name);

    let mut f = match fs::File::open(&file) {
        Ok(f) => f,
        Err(_) => {
            return Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap();
        }
    };
    let size = match f.metadata() {
        Ok(m) => m.len(),
        Err(_) => {
            return Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap();
        }
    };

    let mime = mime_of(&name);
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let base = Response::builder()
        .header(header::CONTENT_TYPE, &mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-cache");

    if let Some(range) = range {
        let r = parse_range(&range, size);
        let invalid = match &r {
            Some((s, e)) => *s > *e || *s >= size,
            None => true,
        };
        if invalid {
            return base
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{}", size))
                .body(Vec::new())
                .unwrap();
        }
        let (start, end) = r.unwrap();
        let length = end - start + 1;
        if f.seek(SeekFrom::Start(start)).is_ok() {
            let mut buf = vec![0u8; length as usize];
            if f.read_exact(&mut buf).is_ok() {
                return base
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(header::CONTENT_RANGE, format!("bytes {}-{}/{}", start, end, size))
                    .header(header::CONTENT_LENGTH, length)
                    .body(buf)
                    .unwrap();
            }
        }
        return base.status(StatusCode::INTERNAL_SERVER_ERROR).body(Vec::new()).unwrap();
    }

    let mut buf = Vec::with_capacity(size as usize);
    if f.read_to_end(&mut buf).is_err() {
        return base.status(StatusCode::INTERNAL_SERVER_ERROR).body(Vec::new()).unwrap();
    }
    base.status(StatusCode::OK)
        .header(header::CONTENT_LENGTH, size)
        .body(buf)
        .unwrap()
}
