//! 自定义背景素材库（移植自 main/backgrounds.js）
//!
//! - 按文件头识别真实格式（不信任扩展名）
//! - 内容哈希去重，复制到用户数据目录
//! - 缩略图暂不生成（thumb = false，前端直接渲染素材首帧）
#![allow(dead_code)] // import/remove 等将在 commands（bridge 阶段）中被调用

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const SCHEME: &str = "moyu-bg";
pub const MAX_BYTES: u64 = 200 * 1024 * 1024;
pub const MAX_ITEMS: usize = 60;
pub const PICK_EXTENSIONS: [&str; 10] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "mp4", "m4v", "webm", "mov"];

#[derive(Debug, Clone, Copy)]
pub struct FormatInfo {
    pub kind: &'static str, // image | video
    pub mime: &'static str,
    pub label: &'static str,
}

pub fn format_info(ext: &str) -> Option<FormatInfo> {
    Some(match ext {
        "png" => FormatInfo { kind: "image", mime: "image/png", label: "图片" },
        "jpg" => FormatInfo { kind: "image", mime: "image/jpeg", label: "图片" },
        "gif" => FormatInfo { kind: "image", mime: "image/gif", label: "GIF" },
        "webp" => FormatInfo { kind: "image", mime: "image/webp", label: "图片" },
        "bmp" => FormatInfo { kind: "image", mime: "image/bmp", label: "图片" },
        "mp4" => FormatInfo { kind: "video", mime: "video/mp4", label: "视频" },
        "webm" => FormatInfo { kind: "video", mime: "video/webm", label: "视频" },
        "mov" => FormatInfo { kind: "video", mime: "video/quicktime", label: "视频" },
        _ => return None,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundItem {
    pub id: String,
    pub ext: String,
    pub kind: String,
    pub animated: bool,
    pub name: String,
    pub size: u64,
    pub thumb: bool,
    pub added_at: i64,
}

pub struct ImportResult {
    pub ok: bool,
    pub duplicate: bool,
    pub item: Option<BackgroundItem>,
    pub error: Option<String>,
}

fn ascii(head: &[u8], a: usize, b: usize) -> String {
    head[a..b].iter().map(|&c| c as char).collect()
}

/// 按文件头识别真实格式（与 backgrounds.js sniff 一致）
pub fn sniff(head: &[u8]) -> Option<&'static str> {
    if head.len() < 12 {
        return None;
    }
    if head[0] == 0x89 && &head[1..4] == b"PNG" {
        return Some("png");
    }
    if head[0] == 0xff && head[1] == 0xd8 && head[2] == 0xff {
        return Some("jpg");
    }
    if &head[0..4] == b"GIF8" {
        return Some("gif");
    }
    if &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        return Some("webp");
    }
    if &head[0..2] == b"BM" {
        return Some("bmp");
    }
    if head.len() >= 4 && u32::from_be_bytes([head[0], head[1], head[2], head[3]]) == 0x1a45dfa3 {
        return Some("webm");
    }
    if head.len() >= 12 && &head[4..8] == b"ftyp" {
        let brand = ascii(head, 8, 12);
        for p in ["avif", "avis", "heic", "heix", "hevc", "mif1", "msf1"] {
            if brand.starts_with(p) {
                return None;
            }
        }
        return if brand == "qt  " { Some("mov") } else { Some("mp4") };
    }
    None
}

fn is_animated(ext: &str, head: &[u8]) -> bool {
    if ext == "gif" {
        return true;
    }
    let s = String::from_utf8_lossy(head);
    if ext == "png" {
        return s.contains("acTL");
    }
    if ext == "webp" {
        return s.contains("ANIM");
    }
    false
}

fn read_head(file: &Path, n: usize) -> std::io::Result<Vec<u8>> {
    let mut f = fs::File::open(file)?;
    let mut buf = vec![0u8; n];
    let read = f.read(&mut buf)?;
    buf.truncate(read);
    Ok(buf)
}

/// 内容哈希：sha256 前 16 个 hex 字符（对应 backgrounds.js hashFile）
pub fn hash_file(file: &Path) -> std::io::Result<String> {
    let mut f = fs::File::open(file)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    Ok(digest.iter().take(8).map(|b| format!("{:02x}", b)).collect())
}

pub fn media_file(dir: &Path, item: &BackgroundItem) -> PathBuf {
    dir.join(format!("{}.{}", item.id, item.ext))
}

pub fn remove(dir: &Path, item: &BackgroundItem) {
    for name in [format!("{}.{}", item.id, item.ext), format!("{}.thumb.png", item.id)] {
        let _ = fs::remove_file(dir.join(name));
    }
}

pub fn format_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / 1024.0 / 1024.0)
    } else {
        format!("{} KB", (bytes as f64 / 1024.0).ceil() as u64)
    }
}

fn display_name(file: &Path) -> String {
    let base = file
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let base = if base.is_empty() { "未命名".to_string() } else { base };
    if base.chars().count() > 40 {
        format!("{}…", base.chars().take(40).collect::<String>())
    } else {
        base
    }
}

pub fn import(src: &Path, dir: &Path, library: &[BackgroundItem]) -> ImportResult {
    let meta = match fs::metadata(src) {
        Ok(m) => m,
        Err(_) => return ImportResult { ok: false, duplicate: false, item: None, error: Some("文件不存在或无法读取".into()) },
    };
    if !meta.is_file() {
        return ImportResult { ok: false, duplicate: false, item: None, error: Some("不是文件".into()) };
    }
    if meta.len() == 0 {
        return ImportResult { ok: false, duplicate: false, item: None, error: Some("文件是空的".into()) };
    }
    if meta.len() > MAX_BYTES {
        return ImportResult {
            ok: false,
            duplicate: false,
            item: None,
            error: Some(format!("文件 {}，超过 {} MB 上限", format_size(meta.len()), MAX_BYTES / 1024 / 1024)),
        };
    }

    let head = match read_head(src, 64 * 1024) {
        Ok(h) => h,
        Err(e) => return ImportResult { ok: false, duplicate: false, item: None, error: Some(format!("读取失败：{}", e)) },
    };
    let ext = match sniff(&head) {
        Some(e) => e,
        None => return ImportResult {
            ok: false,
            duplicate: false,
            item: None,
            error: Some("不支持的格式（支持 PNG/JPG/WebP/GIF/BMP/MP4/WebM/MOV）".into()),
        },
    };
    let id = match hash_file(src) {
        Ok(h) => h,
        Err(e) => return ImportResult { ok: false, duplicate: false, item: None, error: Some(format!("读取失败：{}", e)) },
    };

    // 去重
    if let Some(dup) = library.iter().find(|x| x.id == id) {
        if media_file(dir, dup).exists() {
            return ImportResult { ok: true, duplicate: true, item: Some(dup.clone()), error: None };
        }
    }
    if library.len() >= MAX_ITEMS {
        return ImportResult { ok: false, duplicate: false, item: None, error: Some(format!("素材库最多 {} 个，请先删除一些", MAX_ITEMS)) };
    }

    // 复制（tmp + rename）
    let _ = fs::create_dir_all(dir);
    let dest = dir.join(format!("{}.{}", id, ext));
    let tmp = dir.join(format!("{}.{}.part", id, ext));
    if let Err(e) = fs::copy(src, &tmp) {
        return ImportResult { ok: false, duplicate: false, item: None, error: Some(format!("复制失败：{}", e)) };
    }
    if let Err(e) = fs::rename(&tmp, &dest) {
        let _ = fs::remove_file(&tmp);
        return ImportResult { ok: false, duplicate: false, item: None, error: Some(format!("复制失败：{}", e)) };
    }

    let fi = format_info(ext).unwrap();
    let item = BackgroundItem {
        id: id.clone(),
        ext: ext.to_string(),
        kind: fi.kind.to_string(),
        animated: fi.kind == "video" || is_animated(ext, &head),
        name: display_name(src),
        size: meta.len(),
        thumb: false, // 缩略图暂不生成，前端直接渲染素材首帧
        added_at: chrono::Utc::now().timestamp_millis(),
    };
    ImportResult { ok: true, duplicate: false, item: Some(item), error: None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniff_recognizes_common_formats() {
        // PNG
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];
        assert_eq!(sniff(&png), Some("png"));
        // JPG
        let jpg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0];
        assert_eq!(sniff(&jpg), Some("jpg"));
        // GIF
        let gif = *b"GIF89a0000000";
        assert_eq!(sniff(&gif), Some("gif"));
        // WebP
        let webp = *b"RIFF0000WEBP";
        assert_eq!(sniff(&webp), Some("webp"));
        // BMP
        let bmp = *b"BM0000000000";
        assert_eq!(sniff(&bmp), Some("bmp"));
        // WebM (0x1A45DFA3)
        let webm = [0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0, 0, 0, 0, 0];
        assert_eq!(sniff(&webm), Some("webm"));
        // MP4 (ftypisom)
        let mp4 = *b"\x00\x00\x00\x20ftypisom";
        assert_eq!(sniff(&mp4), Some("mp4"));
        // MOV (ftypqt  )
        let mov = *b"\x00\x00\x00\x20ftypqt  ";
        assert_eq!(sniff(&mov), Some("mov"));
        // 不支持（太短）
        assert_eq!(sniff(b"GIF"), None);
    }
}
