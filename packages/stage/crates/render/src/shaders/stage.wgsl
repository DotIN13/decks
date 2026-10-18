// The stage's shaders, one source for every backend wgpu translates to.
//
// Shapes are instanced quads whose fragment works out how much of each pixel a rounded rectangle
// or an ellipse covers, so edges are exact at any zoom and turn. Meshes (paths) are triangles the
// painter cut, smoothed by multisampling. Both read their paint and clip from a per-frame table: a
// float texture of 64-byte records, four texels each, paints from 0 and clips from `clip_base`
// (render/src/table.rs packs it). It is a texture and not storage buffers so WebGL 2 can run it.

struct Frame {
	size: vec2<f32>,
	clip_base: u32,
	_pad: u32,
};

// A paint: [kind, ramp row, opacity, 0], colour, gradient geometry, picture uv.
// kind: 0 solid, 1 linear, 2 radial, 3 picture.
struct PaintRec {
	head: vec4<f32>,
	color: vec4<f32>,
	geo: vec4<f32>,
	uv: vec4<f32>,
};

// A clip: the inverse of its transform (target pixels → its own space), its size, its radii.
struct ClipRec {
	inv0: vec4<f32>,
	inv1: vec4<f32>,
	radii: vec4<f32>,
	flags: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var table: texture_2d<f32>;
@group(0) @binding(2) var ramp: texture_2d<f32>;
@group(0) @binding(3) var smooth_sampler: sampler;
@group(1) @binding(0) var picture: texture_2d<f32>;

// The `part`th texel of record `index`; the table is as wide as its texture.
fn record(index: u32, part: u32) -> vec4<f32> {
	let width = textureDimensions(table).x;
	let texel = index * 4u + part;
	return textureLoad(table, vec2<u32>(texel % width, texel / width), 0);
}

fn paint_rec(index: i32) -> PaintRec {
	let i = u32(index);
	return PaintRec(record(i, 0u), record(i, 1u), record(i, 2u), record(i, 3u));
}

fn clip_rec(index: i32) -> ClipRec {
	let i = frame.clip_base + u32(index);
	return ClipRec(record(i, 0u), record(i, 1u), record(i, 2u), record(i, 3u));
}

// A paint's colour only: shadows and glyphs need no more of it.
fn paint_color(index: i32) -> vec4<f32> {
	return record(u32(index), 1u);
}

struct Instance {
	@location(0) xf0: vec4<f32>,   // a, b, c, d
	@location(1) xf1: vec4<f32>,   // e, f, w, h
	@location(2) radii: vec4<f32>,
	@location(3) params: vec4<f32>, // mode (0 fill, 1 stroke, 2 shadow), stroke width, align (-1 in, 0 centre, 1 out), ellipse
	@location(4) extra: vec4<f32>,  // shadow sigma, spread, paint, clip
};

struct ShapeOut {
	@builtin(position) pos: vec4<f32>,
	@location(0) local: vec2<f32>,
	@location(1) @interpolate(flat) size: vec2<f32>,
	@location(2) @interpolate(flat) radii: vec4<f32>,
	@location(3) @interpolate(flat) params: vec4<f32>,
	@location(4) @interpolate(flat) extra: vec4<f32>,
	@location(5) @interpolate(flat) scale: f32,
};

fn to_clip_space(p: vec2<f32>) -> vec4<f32> {
	let n = p / frame.size * 2.0 - 1.0;
	return vec4<f32>(n.x, -n.y, 0.0, 1.0);
}

@vertex
fn vs_shape(@builtin(vertex_index) v: u32, inst: Instance) -> ShapeOut {
	let corner = vec2<f32>(f32(v & 1u), f32((v >> 1u) & 1u));
	let a = inst.xf0;
	let scale = max(length(a.xy), length(a.zw));
	let size = inst.xf1.zw;
	// Room past the box: a pixel and a half for the soft edge, the stroke's reach, the shadow's blur.
	var grow = 1.5 / max(scale, 1e-6);
	if (inst.params.x >= 3.0) {
		grow = 0.0;
	}
	if (inst.params.x == 1.0) {
		grow += inst.params.y * (0.5 + 0.5 * max(inst.params.z, 0.0)) + inst.params.y * 0.5;
	}
	if (inst.params.x == 2.0) {
		grow += inst.extra.x * 3.0 + max(inst.extra.y, 0.0);
	}
	let local = mix(vec2<f32>(-grow), size + vec2<f32>(grow), corner);
	let target_pos = vec2<f32>(a.x * local.x + a.z * local.y + inst.xf1.x, a.y * local.x + a.w * local.y + inst.xf1.y);
	var out: ShapeOut;
	out.pos = to_clip_space(target_pos);
	out.local = local;
	out.size = size;
	out.radii = inst.radii;
	out.params = inst.params;
	out.extra = inst.extra;
	out.scale = scale;
	return out;
}

// Signed distance to a rounded rectangle whose corner is at the origin: negative inside.
fn sd_rrect(p: vec2<f32>, size: vec2<f32>, radii: vec4<f32>) -> f32 {
	let half = size * 0.5;
	let q = p - half;
	// Top-left, top-right, bottom-right, bottom-left.
	var r = radii.x;
	if (q.x > 0.0 && q.y <= 0.0) { r = radii.y; }
	if (q.x > 0.0 && q.y > 0.0) { r = radii.z; }
	if (q.x <= 0.0 && q.y > 0.0) { r = radii.w; }
	let d = abs(q) - half + vec2<f32>(r);
	return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0) - r;
}

// Distance to an ellipse filling the box, close enough for a pixel's edge.
fn sd_ellipse(p: vec2<f32>, size: vec2<f32>) -> f32 {
	let r = max(size * 0.5, vec2<f32>(1e-4));
	let q = (p - r) / r;
	let k = length(q);
	let grad = length(q / r);
	return (k - 1.0) * k / max(grad, 1e-6);
}

fn sd_shape(p: vec2<f32>, size: vec2<f32>, radii: vec4<f32>, ellipse: f32) -> f32 {
	if (ellipse > 0.5) {
		return sd_ellipse(p, size);
	}
	return sd_rrect(p, size, radii);
}

fn cover(d_pixels: f32) -> f32 {
	return clamp(0.5 - d_pixels, 0.0, 1.0);
}

fn erf_approx(x: vec2<f32>) -> vec2<f32> {
	let s = sign(x);
	let a = abs(x);
	var r = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
	r = r * r;
	return s - s / (r * r);
}

// Evan Wallace's closed-form blur of a rounded rectangle, along x for a given y.
fn shadow_x(x: f32, y: f32, sigma: f32, corner: f32, half: vec2<f32>) -> f32 {
	let delta = min(half.y - corner - abs(y), 0.0);
	let curved = half.x - corner + sqrt(max(0.0, corner * corner - delta * delta));
	let integral = 0.5 + 0.5 * erf_approx((x + vec2<f32>(-curved, curved)) * (sqrt(0.5) / sigma));
	return integral.y - integral.x;
}

fn shadow(p: vec2<f32>, size: vec2<f32>, sigma: f32, corner: f32) -> f32 {
	let half = size * 0.5;
	let q = p - half;
	let s = max(sigma, 1e-3);
	let low = q.y - half.y;
	let high = q.y + half.y;
	let start = clamp(-3.0 * s, low, high);
	let end = clamp(3.0 * s, low, high);
	let step = (end - start) / 4.0;
	var y = start + step * 0.5;
	var value = 0.0;
	for (var i = 0; i < 4; i++) {
		value += shadow_x(q.x, q.y - y, s, corner, half) * exp(-(y * y) / (2.0 * s * s)) / (sqrt(2.0 * 3.14159265) * s) * step;
		y += step;
	}
	return value;
}

fn paint_at(index: i32, local: vec2<f32>, size: vec2<f32>) -> vec4<f32> {
	let rec = paint_rec(index);
	let kind = rec.head.x;
	if (kind == 0.0) {
		return rec.color;
	}
	if (kind == 1.0 || kind == 2.0) {
		var t = 0.0;
		if (kind == 1.0) {
			let start = rec.geo.xy;
			let dir = rec.geo.zw - start;
			t = dot(local - start, dir) / max(dot(dir, dir), 1e-6);
		} else {
			t = length((local - rec.geo.xy) / max(rec.geo.zw, vec2<f32>(1e-6)));
		}
		let row = (rec.head.y + 0.5) / f32(textureDimensions(ramp).y);
		return textureSampleLevel(ramp, smooth_sampler, vec2<f32>(clamp(t, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, row), 0.0);
	}
	// A picture: the uv rectangle across the box; past the picture's edge is transparent.
	let f = local / max(size, vec2<f32>(1e-6));
	let uv = mix(rec.uv.xy, rec.uv.zw, f);
	let inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
	return textureSampleLevel(picture, smooth_sampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0) * rec.head.z * inside;
}

fn clip_at(index: i32, target_pos: vec2<f32>) -> f32 {
	if (index < 0) {
		return 1.0;
	}
	let c = clip_rec(index);
	let p = vec2<f32>(c.inv0.x * target_pos.x + c.inv0.z * target_pos.y + c.inv1.x, c.inv0.y * target_pos.x + c.inv0.w * target_pos.y + c.inv1.y);
	let back_scale = max(length(c.inv0.xy), 1e-6);
	let d = sd_shape(p, c.inv1.zw, c.radii, c.flags.x);
	return cover(d / back_scale);
}

@fragment
fn fs_shape(in: ShapeOut) -> @location(0) vec4<f32> {
	let mode = in.params.x;
	var coverage = 0.0;
	if (mode == 2.0) {
		let spread = in.extra.y;
		let size = in.size + vec2<f32>(spread * 2.0);
		coverage = shadow(in.local + vec2<f32>(spread), size, in.extra.x, max(in.radii.x, 0.0) + spread);
	} else {
		let d = sd_shape(in.local, in.size, in.radii, in.params.w) * in.scale;
		if (mode >= 3.0) {
			// A picture or a glyph with hard edges: the quad is exactly its box.
			coverage = 1.0;
		} else if (mode == 1.0) {
			let w = in.params.y * in.scale;
			let align = in.params.z;
			// Where the outline's outer and inner edges sit from the shape's edge, in pixels.
			let outer = w * (0.5 + 0.5 * align);
			let inner = outer - w;
			coverage = cover(d - outer) - cover(d - inner);
		} else {
			coverage = cover(d);
		}
	}
	coverage *= clip_at(i32(in.extra.w), in.pos.xy);
	if (coverage <= 0.0) {
		discard;
	}
	if (mode == 2.0) {
		return paint_color(i32(in.extra.z)) * coverage;
	}
	if (mode == 4.0 || mode == 5.0) {
		// A glyph: its part of the glyph texture, carried in `radii` as a uv rectangle.
		let uv = mix(in.radii.xy, in.radii.zw, in.local / max(in.size, vec2<f32>(1e-6)));
		let texel = textureSampleLevel(picture, smooth_sampler, uv, 0.0);
		let color = paint_color(i32(in.extra.z));
		if (mode == 4.0) {
			return color * texel.r * coverage;
		}
		return texel * color.a * coverage;
	}
	return paint_at(i32(in.extra.z), in.local, in.size) * coverage;
}

struct MeshIn {
	@location(0) target_pos: vec2<f32>,
	@location(1) local: vec2<f32>,
	@location(2) refs: vec2<f32>, // paint, clip
	@location(3) size: vec2<f32>,
};

struct MeshOut {
	@builtin(position) pos: vec4<f32>,
	@location(0) local: vec2<f32>,
	@location(1) @interpolate(flat) refs: vec2<f32>,
	@location(2) @interpolate(flat) size: vec2<f32>,
};

@vertex
fn vs_mesh(v: MeshIn) -> MeshOut {
	var out: MeshOut;
	out.pos = to_clip_space(v.target_pos);
	out.local = v.local;
	out.refs = v.refs;
	out.size = v.size;
	return out;
}

@fragment
fn fs_mesh(in: MeshOut) -> @location(0) vec4<f32> {
	let coverage = clip_at(i32(in.refs.y), in.pos.xy);
	if (coverage <= 0.0) {
		discard;
	}
	return paint_at(i32(in.refs.x), in.local, in.size) * coverage;
}
