//! Purpose: evidence hashing and image normalization helpers for Rust services and workers.
//! Governing docs:
//! - AGENTS.md
//! - Implementation Plan.txt
//! - docs\reference-baseline.md
//! - docs\data-platform.md
//! - docs\observability-security.md
//!
//! Upstream docs:
//! - https://docs.rs/image/latest/image/
//! - https://docs.rs/fast_image_resize/latest/fast_image_resize/
//! - https://docs.rs/blake3/latest/blake3/
//! - https://docs.rs/xxhash-rust/latest/xxhash_rust/
//!
//! Tests:
//! - cargo test --workspace

use fast_image_resize::{
    FilterType, ResizeAlg, ResizeOptions, Resizer, images::Image, pixels::PixelType,
};
use image::{DynamicImage, GenericImageView, load_from_memory};
use serde::Serialize;
use std::{error::Error, fmt, io::Cursor};
use xxhash_rust::xxh3::xxh3_64;

/// Opaque capabilities exposed by the evidence service skeleton.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceCapabilities {
    /// Supported hashing algorithms.
    pub hashing_algorithms: Vec<&'static str>,
    /// Supported image formats for the current scaffold.
    pub image_formats: Vec<&'static str>,
    /// Resize algorithm used during normalization.
    pub resize_algorithm: &'static str,
}

/// Content-addressed hashes for evidence bytes.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceHashes {
    /// BLAKE3 digest prefixed for traceability.
    pub blake3: String,
    /// XXH3 digest prefixed for traceability.
    pub xxh3_64: String,
    /// Input size in bytes.
    pub bytes: usize,
}

/// Normalized in-memory image artifact.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedImage {
    /// Final width in pixels.
    pub width: u32,
    /// Final height in pixels.
    pub height: u32,
    /// RGBA8 pixel buffer.
    pub rgba8: Vec<u8>,
    /// Hashes computed over the normalized RGBA buffer.
    pub hashes: EvidenceHashes,
}

/// Errors surfaced by image decoding and resizing.
#[derive(Debug)]
pub enum EvidenceError {
    /// The image decoder rejected the input bytes.
    Decode(image::ImageError),
    /// The resize source or destination buffer was invalid.
    Buffer(fast_image_resize::ImageBufferError),
    /// The resize operation failed.
    Resize(fast_image_resize::ResizeError),
    /// The requested max edge was zero.
    InvalidMaxEdge,
}

impl fmt::Display for EvidenceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Decode(error) => write!(f, "image decode failed: {error}"),
            Self::Buffer(error) => write!(f, "image buffer setup failed: {error}"),
            Self::Resize(error) => write!(f, "image resize failed: {error}"),
            Self::InvalidMaxEdge => write!(f, "max edge must be greater than zero"),
        }
    }
}

impl Error for EvidenceError {}

impl From<image::ImageError> for EvidenceError {
    fn from(value: image::ImageError) -> Self {
        Self::Decode(value)
    }
}

impl From<fast_image_resize::ImageBufferError> for EvidenceError {
    fn from(value: fast_image_resize::ImageBufferError) -> Self {
        Self::Buffer(value)
    }
}

impl From<fast_image_resize::ResizeError> for EvidenceError {
    fn from(value: fast_image_resize::ResizeError) -> Self {
        Self::Resize(value)
    }
}

/// Returns the current evidence-service capabilities.
pub fn capabilities() -> EvidenceCapabilities {
    EvidenceCapabilities {
        hashing_algorithms: vec!["blake3", "xxh3_64"],
        image_formats: vec!["png", "jpeg", "webp"],
        resize_algorithm: "convolution_catmull_rom",
    }
}

/// Hashes any byte slice with the approved evidence digests.
pub fn hash_bytes(bytes: &[u8]) -> EvidenceHashes {
    EvidenceHashes {
        blake3: format!("blake3:{}", blake3::hash(bytes)),
        xxh3_64: format!("xxh3_64:{:016x}", xxh3_64(bytes)),
        bytes: bytes.len(),
    }
}

/// Decodes an image, resizes it to fit inside `max_edge`, and returns RGBA8 bytes.
pub fn normalize_image(bytes: &[u8], max_edge: u32) -> Result<NormalizedImage, EvidenceError> {
    if max_edge == 0 {
        return Err(EvidenceError::InvalidMaxEdge);
    }

    let decoded = load_from_memory(bytes)?;
    let rgba = decoded.to_rgba8();
    let (width, height) = decoded.dimensions();
    let (target_width, target_height) = fit_inside(width, height, max_edge);

    let rgba8 = if (width, height) == (target_width, target_height) {
        rgba.into_raw()
    } else {
        let source = Image::from_vec_u8(width, height, rgba.into_raw(), PixelType::U8x4)?;
        let mut destination = Image::new(target_width, target_height, PixelType::U8x4);
        let mut resizer = Resizer::new();
        let options = ResizeOptions {
            algorithm: ResizeAlg::Convolution(FilterType::CatmullRom),
            ..ResizeOptions::default()
        };

        resizer.resize(&source, &mut destination, &options)?;
        destination.into_vec()
    };

    Ok(NormalizedImage {
        width: target_width,
        height: target_height,
        hashes: hash_bytes(&rgba8),
        rgba8,
    })
}

fn fit_inside(width: u32, height: u32, max_edge: u32) -> (u32, u32) {
    if width <= max_edge && height <= max_edge {
        return (width, height);
    }

    if width >= height {
        let scaled_height = ((height as f64 / width as f64) * max_edge as f64).round() as u32;
        (max_edge, scaled_height.max(1))
    } else {
        let scaled_width = ((width as f64 / height as f64) * max_edge as f64).round() as u32;
        (scaled_width.max(1), max_edge)
    }
}

fn write_png(image: DynamicImage) -> Vec<u8> {
    let mut bytes = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
        .expect("test image should encode");
    bytes
}

#[cfg(test)]
mod tests {
    use super::{capabilities, hash_bytes, normalize_image, write_png};
    use image::{DynamicImage, ImageBuffer, Rgba};

    #[test]
    fn hash_bytes_is_stable_and_prefixed() {
        let hashes = hash_bytes(b"humanify");

        assert!(hashes.blake3.starts_with("blake3:"));
        assert!(hashes.xxh3_64.starts_with("xxh3_64:"));
        assert_eq!(hashes.bytes, 8);
    }

    #[test]
    fn normalize_image_resizes_large_images() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(64, 32, Rgba([120, 33, 200, 255])));
        let png = write_png(image);

        let normalized = normalize_image(&png, 16).expect("image should normalize");

        assert_eq!(normalized.width, 16);
        assert_eq!(normalized.height, 8);
        assert_eq!(normalized.rgba8.len(), 16 * 8 * 4);
    }

    #[test]
    fn capabilities_surface_supported_algorithms() {
        let capabilities = capabilities();

        assert!(capabilities.hashing_algorithms.contains(&"blake3"));
        assert_eq!(capabilities.resize_algorithm, "convolution_catmull_rom");
    }
}
