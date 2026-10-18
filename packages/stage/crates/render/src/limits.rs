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

impl Default for Limits {
	fn default() -> Limits {
		Limits::WEBGPU
	}
}
