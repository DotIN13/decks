//! The stage's one shader source, which every backend translates: wgpu to WGSL for WebGPU, to GLSL
//! ES 3.00 for WebGL 2 and to MSL for Metal. The tests check naga can make each of them from it.

/// The WGSL source: `vs_shape`/`fs_shape` for instanced shapes, `vs_mesh`/`fs_mesh` for meshes.
pub const STAGE_WGSL: &str = include_str!("shaders/stage.wgsl");

/// The entry points, with whether each is a vertex (true) or fragment (false) stage.
pub const ENTRY_POINTS: [(&str, bool); 4] = [("vs_shape", true), ("fs_shape", false), ("vs_mesh", true), ("fs_mesh", false)];

#[cfg(test)]
mod tests {
	use super::*;
	use naga::back::{glsl, msl};
	use naga::valid::{Capabilities, ValidationFlags, Validator};

	fn module() -> (naga::Module, naga::valid::ModuleInfo) {
		let module = naga::front::wgsl::parse_str(STAGE_WGSL).unwrap_or_else(|e| panic!("{}", e.emit_to_string(STAGE_WGSL)));
		let info = Validator::new(ValidationFlags::all(), Capabilities::empty()).validate(&module).unwrap_or_else(|e| panic!("{}", e.emit_to_string(STAGE_WGSL)));
		(module, info)
	}

	/// What WebGL 2 runs: GLSL ES 3.00, which has no storage buffers.
	#[test]
	fn converts_to_glsl_es_300() {
		let (module, info) = module();
		let options = glsl::Options { version: glsl::Version::Embedded { version: 300, is_webgl: true }, ..Default::default() };
		for (name, vertex) in ENTRY_POINTS {
			let pipeline = glsl::PipelineOptions { shader_stage: if vertex { naga::ShaderStage::Vertex } else { naga::ShaderStage::Fragment }, entry_point: name.into(), multiview: None };
			let mut out = String::new();
			let mut w = glsl::Writer::new(&mut out, &module, &info, &options, &pipeline, naga::proc::BoundsCheckPolicies::default()).unwrap_or_else(|e| panic!("{name}: {e}"));
			w.write().unwrap_or_else(|e| panic!("{name}: {e}"));
			assert!(out.starts_with("#version 300 es"), "{name}");
			assert!(!out.contains("buffer "), "{name} has a storage buffer");
		}
	}

	#[test]
	fn converts_to_msl() {
		let (module, info) = module();
		let (out, _) = msl::write_string(&module, &info, &msl::Options::default(), &msl::PipelineOptions::default()).unwrap();
		for (name, _) in ENTRY_POINTS {
			assert!(out.contains(name), "{name}");
		}
	}
}
