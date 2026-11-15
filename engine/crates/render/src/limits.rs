//! What a device allows, as far as drawing a stage needs to know. Each target fills one in from its
//! own API (WebGPU's limits, WebGL 2's parameters, Metal's device); the rest of the engine reads
//! only this.

/// The paint and clip table is this many texels wide on every device: WebGL 2 guarantees textures
/// 2048 texels across, so 1024 fits everywhere, and a row (16 KiB) is a whole number of the 256-byte
/// rows texture copies want.
pub const TABLE_WIDTH: u32 = 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
	/// The widest and tallest 2D texture, in texels.
	pub max_texture: u32,
	/// The most samples a pixel a render target may have.
	pub max_samples: u32,
	/// How many texels across the paint and clip table is.
	pub table_width: u32,
}

impl Limits {
	/// What WebGPU's defaults promise: 8192 texels, four samples.
	pub const WEBGPU: Limits = Limits { max_texture: 8192, max_samples: 4, table_width: TABLE_WIDTH };
	/// What every WebGL 2 context promises: 2048 texels, four samples.
	pub const WEBGL2: Limits = Limits { max_texture: 2048, max_samples: 4, table_width: TABLE_WIDTH };

	/// How many 64-byte records (paints and clips together) the table can hold on this device.
	pub fn table_records(&self) -> usize {
		(self.table_width / crate::table::RECORD_TEXELS) as usize * self.max_texture as usize
	}
}

/// Samples a pixel the stage draws with (D3): four, unless the device can do fewer than four (WebGL
/// 2's `MAX_SAMPLES`, when the browser tells it: `None` or 0 is a browser that does not say, and
/// WebGL 2 promises four), or is short of memory, where four samples cost four times the memory of
/// every pass's target.
pub fn samples(max_samples: Option<u32>, short_of_memory: bool) -> u32 {
	let can = match max_samples {
		Some(n) if n > 0 => n,
		_ => 4,
	};
	if short_of_memory || can < 4 { 1 } else { 4 }
}

/// Whether a device with this much memory (`navigator.deviceMemory`, in GiB, which browsers round
/// down to 0.25, 0.5, 1, 2, 4 or 8, and Safari does not give) is short of it for four samples.
pub fn short_of_memory(device_memory_gib: Option<f64>) -> bool {
	device_memory_gib.is_some_and(|gib| gib <= 2.0)
}

impl Default for Limits {
	fn default() -> Limits {
		Limits::WEBGPU
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn four_samples_unless_short() {
		assert_eq!(samples(Some(4), false), 4);
		assert_eq!(samples(Some(16), false), 4);
		assert_eq!(samples(None, false), 4);
		assert_eq!(samples(Some(0), false), 4, "a browser that answers 0 does not say");
		assert_eq!(samples(Some(2), false), 1);
		assert_eq!(samples(Some(1), false), 1);
		assert_eq!(samples(Some(8), true), 1);
		assert!(short_of_memory(Some(2.0)));
		assert!(short_of_memory(Some(0.5)));
		assert!(!short_of_memory(Some(4.0)));
		assert!(!short_of_memory(None), "Safari does not say: not short");
	}
}
