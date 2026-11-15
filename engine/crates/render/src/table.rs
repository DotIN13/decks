//! The paints and clips a draw refers to, packed into one table the shader reads as an Rgba32Float
//! texture with `textureLoad`: storage buffers would be simpler, but WebGL 2 has none.
//!
//! Each record is 64 bytes (16 floats), four texels in a row; a row of the table is
//! [`TABLE_WIDTH`](crate::limits::TABLE_WIDTH) texels. Paints come first, from record 0; clips follow
//! from `clip_base`, which the shader gets in its frame uniform.

/// Texels a record takes: 16 floats, four to a texel.
pub const RECORD_TEXELS: u32 = 4;

pub struct Table {
	/// The texels, row after row, `width × rows × 4` floats; the last row padded with zeros.
	pub texels: Vec<f32>,
	pub width: u32,
	pub rows: u32,
	/// The record the first clip is at.
	pub clip_base: u32,
}

impl Table {
	/// Paints then clips, `width` texels a row, at least one row. Records past what `max_rows` holds
	/// are dropped (they would draw with an empty paint or clip); no stage comes near it.
	pub fn pack(paints: &[[f32; 16]], clips: &[[f32; 16]], width: u32, max_rows: u32) -> Table {
		let per_row = (width / RECORD_TEXELS).max(1) as usize;
		let capacity = per_row * max_rows.max(1) as usize;
		let records = (paints.len() + clips.len()).min(capacity);
		let rows = records.div_ceil(per_row).max(1);
		let mut texels = Vec::with_capacity(rows * width as usize * 4);
		for rec in paints.iter().chain(clips).take(records) {
			texels.extend_from_slice(rec);
		}
		texels.resize(rows * width as usize * 4, 0.0);
		Table { texels, width, rows: rows as u32, clip_base: paints.len() as u32 }
	}

	/// The table's bytes, for a texture upload.
	pub fn bytes(&self) -> &[u8] {
		bytemuck::cast_slice(&self.texels)
	}

	/// Bytes a row of texels takes.
	pub fn row_bytes(&self) -> u32 {
		self.width * 16
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn paints_then_clips_four_texels_each() {
		let paints: Vec<[f32; 16]> = (0..300).map(|i| [i as f32; 16]).collect();
		let clips = vec![[-1.0; 16]; 2];
		let t = Table::pack(&paints, &clips, 1024, 2048);
		assert_eq!((t.rows, t.clip_base), (2, 300));
		assert_eq!(t.texels.len(), 2 * 1024 * 4);
		// Record 257 is the second of row 1: texel 4 there, float (1024 + 4) × 4.
		assert_eq!(t.texels[(1024 + 4) * 4], 257.0);
		// The first clip, record 300: row 1, texel (300 − 256) × 4.
		assert_eq!(t.texels[(1024 + 44 * 4) * 4], -1.0);
		assert_eq!(*t.texels.last().unwrap(), 0.0);
		assert_eq!(t.row_bytes() % 256, 0);
	}

	#[test]
	fn an_empty_draw_still_has_a_row() {
		let t = Table::pack(&[], &[], 1024, 2048);
		assert_eq!((t.rows, t.clip_base, t.texels.len()), (1, 0, 4096));
	}
}
