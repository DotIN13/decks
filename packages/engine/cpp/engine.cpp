// The Decks stage engine: one scene of rectangles, one camera, two layers, drawn on the graphics card.
//
// This is the first piece of the engine that is meant to own the whole stage, the way Figma's C++
// editor owns its document (see the "Following Figma closely" board). Today it composites: board
// pictures, papers and news outlines on the layer under the live board pages, and drawing tiles on
// the layer over them. It draws only what changed since the last frame asked, and only what is in
// view, and it keeps no picture of its own: a frame is the items in view, drawn again.
//
// Two backends sit behind one interface, chosen by the page at start: WebGPU, through Dawn's
// Emscripten bindings, and WebGL 2, through Emscripten's GLES 3. The page owns the device or the
// contexts and uploads textures (it has the ImageBitmaps); the engine owns everything else.

#include <emscripten/emscripten.h>
#include <emscripten/html5.h>
#include <webgpu/webgpu.h>
#include <GLES3/gl3.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <unordered_map>
#include <vector>

namespace {

// What one rectangle carries to the graphics card: 16 floats, read as four vec4s.
struct Quad {
	float x, y, w, h;      // in stage pixels
	float u0, v0, u1, v1;  // the part of the texture it shows
	float r, g, b, a;      // a colour, premultiplied; for a texture, its opacity in a
	float radius;          // corner radius, stage pixels
	float stroke;          // > 0: an outline this many screen pixels wide, not a fill
	float kind;            // 0 colour, 1 texture
	float crisp;           // 1: corners on whole device pixels and no soft edge, for tiles that meet edge to edge
};
static_assert(sizeof(Quad) == 64, "Quad is four vec4s");

enum Kind : int { KIND_COLOUR = 0, KIND_TEXTURE = 1 };
constexpr int LAYERS = 2;  // 0 under the board pages, 1 over them

struct Item {
	int layer = 0;
	double order = 0;
	int texture = 0;  // 0: none
	Quad quad{};
};

struct Camera {
	float x = 0, y = 0, zoom = 1;
};

struct View {
	float width = 0, height = 0, dpr = 1;  // CSS pixels and device pixels per CSS pixel
};

// Uniforms, as both shaders read them: the view in CSS pixels, the camera, the pixel ratio.
struct Uniforms {
	float viewW, viewH, camX, camY;
	float zoom, dpr, pad0, pad1;
};

class Backend {
public:
	virtual ~Backend() = default;
	virtual bool frame(int layer, const Uniforms& u, const std::vector<Quad>& quads, const std::vector<std::pair<int, int>>& runs, const std::vector<int>& textures) = 0;
	virtual void forget(int texture) = 0;
};

// ---------------------------------------------------------------------------------------------
// WebGPU
// ---------------------------------------------------------------------------------------------

const char* WGSL = R"(
struct U { view: vec2f, cam: vec2f, zoom: f32, dpr: f32, pad: vec2f };
@group(0) @binding(0) var<uniform> u: U;
@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;

struct Q { @location(0) rect: vec4f, @location(1) uv: vec4f, @location(2) colour: vec4f, @location(3) style: vec4f };
struct V {
	@builtin(position) pos: vec4f,
	@location(0) uv: vec2f,
	@location(1) colour: vec4f,
	@location(2) local: vec2f,
	@location(3) half: vec2f,
	@location(4) style: vec4f,
};

@vertex fn vs(@builtin(vertex_index) i: u32, q: Q) -> V {
	let corner = vec2f(f32(i & 1u), f32((i >> 1u) & 1u));
	let stage = q.rect.xy + corner * q.rect.zw;
	var css = (stage - u.cam) * u.zoom + u.view * 0.5;
	// A crisp quad's corners land on whole device pixels: neighbours share their edges exactly, and a
	// texture drawn at the screen's own scale maps one texel to one pixel.
	if (q.style.w > 0.5) {
		css = round(css * u.dpr) / u.dpr;
	}
	var o: V;
	o.pos = vec4f(css.x / u.view.x * 2.0 - 1.0, 1.0 - css.y / u.view.y * 2.0, 0.0, 1.0);
	o.uv = mix(q.uv.xy, q.uv.zw, corner);
	o.colour = q.colour;
	let sizePx = q.rect.zw * u.zoom * u.dpr;
	o.half = sizePx * 0.5;
	o.local = (corner - 0.5) * sizePx;
	o.style = vec4f(q.style.x * u.zoom * u.dpr, q.style.y * u.dpr, q.style.z, q.style.w);
	return o;
}

fn coverage(v: V) -> f32 {
	// No soft edge on a crisp quad: a tile's edge is another tile's edge, and a soft one is a seam.
	if (v.style.w > 0.5) {
		return 1.0;
	}
	// Signed distance to a rounded rectangle, in device pixels: negative inside.
	let r = min(v.style.x, min(v.half.x, v.half.y));
	let q = abs(v.local) - v.half + r;
	let d = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
	let inside = clamp(0.5 - d, 0.0, 1.0);
	if (v.style.y > 0.0) {
		return inside * clamp(v.style.y + 0.5 + d, 0.0, 1.0);
	}
	return inside;
}

@fragment fn fs_colour(v: V) -> @location(0) vec4f {
	return v.colour * coverage(v);
}

@fragment fn fs_texture(v: V) -> @location(0) vec4f {
	return textureSample(tex, samp, v.uv) * v.colour.a * coverage(v);
}
)";

WGPUStringView sv(const char* s) { return WGPUStringView{s, WGPU_STRLEN}; }

class WebGpu final : public Backend {
public:
	explicit WebGpu(WGPUDevice device, WGPUTextureFormat format) : device_(device), format_(format) {
		queue_ = wgpuDeviceGetQueue(device_);
		WGPUShaderSourceWGSL wgsl = WGPU_SHADER_SOURCE_WGSL_INIT;
		wgsl.code = sv(WGSL);
		WGPUShaderModuleDescriptor md = WGPU_SHADER_MODULE_DESCRIPTOR_INIT;
		md.nextInChain = &wgsl.chain;
		WGPUShaderModule module = wgpuDeviceCreateShaderModule(device_, &md);

		WGPUBindGroupLayoutEntry uEntry = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
		uEntry.binding = 0;
		uEntry.visibility = WGPUShaderStage_Vertex;
		uEntry.buffer.type = WGPUBufferBindingType_Uniform;
		WGPUBindGroupLayoutDescriptor uLayout = WGPU_BIND_GROUP_LAYOUT_DESCRIPTOR_INIT;
		uLayout.entryCount = 1;
		uLayout.entries = &uEntry;
		uniformLayout_ = wgpuDeviceCreateBindGroupLayout(device_, &uLayout);

		WGPUBindGroupLayoutEntry tEntries[2] = {WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT, WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT};
		tEntries[0].binding = 0;
		tEntries[0].visibility = WGPUShaderStage_Fragment;
		tEntries[0].sampler.type = WGPUSamplerBindingType_Filtering;
		tEntries[1].binding = 1;
		tEntries[1].visibility = WGPUShaderStage_Fragment;
		tEntries[1].texture.sampleType = WGPUTextureSampleType_Float;
		tEntries[1].texture.viewDimension = WGPUTextureViewDimension_2D;
		WGPUBindGroupLayoutDescriptor tLayout = WGPU_BIND_GROUP_LAYOUT_DESCRIPTOR_INIT;
		tLayout.entryCount = 2;
		tLayout.entries = tEntries;
		textureLayout_ = wgpuDeviceCreateBindGroupLayout(device_, &tLayout);

		WGPUBindGroupLayout layouts[2] = {uniformLayout_, textureLayout_};
		WGPUPipelineLayoutDescriptor pl = WGPU_PIPELINE_LAYOUT_DESCRIPTOR_INIT;
		pl.bindGroupLayoutCount = 2;
		pl.bindGroupLayouts = layouts;
		WGPUPipelineLayout pipelineLayout = wgpuDeviceCreatePipelineLayout(device_, &pl);

		colourPipeline_ = pipeline(module, pipelineLayout, "fs_colour");
		texturePipeline_ = pipeline(module, pipelineLayout, "fs_texture");
		wgpuPipelineLayoutRelease(pipelineLayout);
		wgpuShaderModuleRelease(module);

		WGPUBufferDescriptor ub = WGPU_BUFFER_DESCRIPTOR_INIT;
		ub.size = sizeof(Uniforms);
		ub.usage = WGPUBufferUsage_Uniform | WGPUBufferUsage_CopyDst;
		for (int i = 0; i < LAYERS; i++) {
			uniforms_[i] = wgpuDeviceCreateBuffer(device_, &ub);
			WGPUBindGroupEntry e = WGPU_BIND_GROUP_ENTRY_INIT;
			e.binding = 0;
			e.buffer = uniforms_[i];
			e.size = sizeof(Uniforms);
			WGPUBindGroupDescriptor bg = WGPU_BIND_GROUP_DESCRIPTOR_INIT;
			bg.layout = uniformLayout_;
			bg.entryCount = 1;
			bg.entries = &e;
			uniformGroups_[i] = wgpuDeviceCreateBindGroup(device_, &bg);
		}

		WGPUSamplerDescriptor sd = WGPU_SAMPLER_DESCRIPTOR_INIT;
		sd.magFilter = WGPUFilterMode_Linear;
		sd.minFilter = WGPUFilterMode_Linear;
		sd.mipmapFilter = WGPUMipmapFilterMode_Linear;
		sd.addressModeU = WGPUAddressMode_ClampToEdge;
		sd.addressModeV = WGPUAddressMode_ClampToEdge;
		sampler_ = wgpuDeviceCreateSampler(device_, &sd);

		// A one-pixel white texture, bound for colour quads so every draw has a texture group.
		blank_ = textureGroupFor(nullptr);
	}

	// A texture view the page imported, as the group a draw binds.
	void adopt(int id, WGPUTextureView view) {
		forget(id);
		groups_[id] = textureGroupFor(view);
		wgpuTextureViewRelease(view);
	}

	void setTarget(int layer, WGPUTextureView view) { target_[layer] = view; }

	bool frame(int layer, const Uniforms& u, const std::vector<Quad>& quads, const std::vector<std::pair<int, int>>& runs, const std::vector<int>& textures) override {
		WGPUTextureView target = target_[layer];
		target_[layer] = nullptr;
		if (!target) return false;
		wgpuQueueWriteBuffer(queue_, uniforms_[layer], 0, &u, sizeof(u));
		size_t bytes = std::max<size_t>(quads.size(), 1) * sizeof(Quad);
		if (bytes > capacity_[layer]) {
			if (instances_[layer]) wgpuBufferRelease(instances_[layer]);
			size_t grown = std::max<size_t>(bytes, capacity_[layer] * 2);
			WGPUBufferDescriptor bd = WGPU_BUFFER_DESCRIPTOR_INIT;
			bd.size = grown;
			bd.usage = WGPUBufferUsage_Vertex | WGPUBufferUsage_CopyDst;
			instances_[layer] = wgpuDeviceCreateBuffer(device_, &bd);
			capacity_[layer] = grown;
		}
		if (!quads.empty()) wgpuQueueWriteBuffer(queue_, instances_[layer], 0, quads.data(), quads.size() * sizeof(Quad));

		WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(device_, nullptr);
		WGPURenderPassColorAttachment colour = WGPU_RENDER_PASS_COLOR_ATTACHMENT_INIT;
		colour.view = target;
		colour.loadOp = WGPULoadOp_Clear;
		colour.storeOp = WGPUStoreOp_Store;
		colour.clearValue = WGPUColor{0, 0, 0, 0};
		WGPURenderPassDescriptor rp = WGPU_RENDER_PASS_DESCRIPTOR_INIT;
		rp.colorAttachmentCount = 1;
		rp.colorAttachments = &colour;
		WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder, &rp);
		wgpuRenderPassEncoderSetBindGroup(pass, 0, uniformGroups_[layer], 0, nullptr);
		if (!quads.empty()) wgpuRenderPassEncoderSetVertexBuffer(pass, 0, instances_[layer], 0, quads.size() * sizeof(Quad));
		for (size_t i = 0; i < runs.size(); i++) {
			int texture = textures[i];
			auto found = texture ? groups_.find(texture) : groups_.end();
			bool textured = found != groups_.end();
			wgpuRenderPassEncoderSetPipeline(pass, textured ? texturePipeline_ : colourPipeline_);
			wgpuRenderPassEncoderSetBindGroup(pass, 1, textured ? found->second : blank_, 0, nullptr);
			wgpuRenderPassEncoderDraw(pass, 4, runs[i].second, 0, runs[i].first);
		}
		wgpuRenderPassEncoderEnd(pass);
		wgpuRenderPassEncoderRelease(pass);
		WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder, nullptr);
		wgpuQueueSubmit(queue_, 1, &commands);
		wgpuCommandBufferRelease(commands);
		wgpuCommandEncoderRelease(encoder);
		wgpuTextureViewRelease(target);
		return true;
	}

	void forget(int texture) override {
		auto found = groups_.find(texture);
		if (found == groups_.end()) return;
		wgpuBindGroupRelease(found->second);
		groups_.erase(found);
	}

private:
	WGPURenderPipeline pipeline(WGPUShaderModule module, WGPUPipelineLayout layout, const char* fragment) {
		WGPUVertexAttribute attributes[4];
		for (int i = 0; i < 4; i++) {
			attributes[i] = WGPU_VERTEX_ATTRIBUTE_INIT;
			attributes[i].format = WGPUVertexFormat_Float32x4;
			attributes[i].offset = i * 16;
			attributes[i].shaderLocation = i;
		}
		WGPUVertexBufferLayout vb = WGPU_VERTEX_BUFFER_LAYOUT_INIT;
		vb.arrayStride = sizeof(Quad);
		vb.stepMode = WGPUVertexStepMode_Instance;
		vb.attributeCount = 4;
		vb.attributes = attributes;

		WGPUBlendState blend = WGPU_BLEND_STATE_INIT;
		blend.color = WGPUBlendComponent{WGPUBlendOperation_Add, WGPUBlendFactor_One, WGPUBlendFactor_OneMinusSrcAlpha};
		blend.alpha = WGPUBlendComponent{WGPUBlendOperation_Add, WGPUBlendFactor_One, WGPUBlendFactor_OneMinusSrcAlpha};
		WGPUColorTargetState target = WGPU_COLOR_TARGET_STATE_INIT;
		target.format = format_;
		target.blend = &blend;
		target.writeMask = WGPUColorWriteMask_All;
		WGPUFragmentState fs = WGPU_FRAGMENT_STATE_INIT;
		fs.module = module;
		fs.entryPoint = sv(fragment);
		fs.targetCount = 1;
		fs.targets = &target;

		WGPURenderPipelineDescriptor d = WGPU_RENDER_PIPELINE_DESCRIPTOR_INIT;
		d.layout = layout;
		d.vertex.module = module;
		d.vertex.entryPoint = sv("vs");
		d.vertex.bufferCount = 1;
		d.vertex.buffers = &vb;
		d.primitive.topology = WGPUPrimitiveTopology_TriangleStrip;
		d.fragment = &fs;
		return wgpuDeviceCreateRenderPipeline(device_, &d);
	}

	WGPUBindGroup textureGroupFor(WGPUTextureView view) {
		WGPUTextureView owned = nullptr;
		if (!view) {
			WGPUTextureDescriptor td = WGPU_TEXTURE_DESCRIPTOR_INIT;
			td.size = WGPUExtent3D{1, 1, 1};
			td.format = WGPUTextureFormat_RGBA8Unorm;
			td.usage = WGPUTextureUsage_TextureBinding | WGPUTextureUsage_CopyDst;
			WGPUTexture white = wgpuDeviceCreateTexture(device_, &td);
			uint32_t pixel = 0xffffffff;
			WGPUTexelCopyTextureInfo dst = WGPU_TEXEL_COPY_TEXTURE_INFO_INIT;
			dst.texture = white;
			WGPUTexelCopyBufferLayout layout = WGPU_TEXEL_COPY_BUFFER_LAYOUT_INIT;
			layout.bytesPerRow = 4;
			layout.rowsPerImage = 1;
			WGPUExtent3D size{1, 1, 1};
			wgpuQueueWriteTexture(queue_, &dst, &pixel, 4, &layout, &size);
			owned = wgpuTextureCreateView(white, nullptr);
			wgpuTextureRelease(white);
			view = owned;
		}
		WGPUBindGroupEntry entries[2] = {WGPU_BIND_GROUP_ENTRY_INIT, WGPU_BIND_GROUP_ENTRY_INIT};
		entries[0].binding = 0;
		entries[0].sampler = sampler_;
		entries[1].binding = 1;
		entries[1].textureView = view;
		WGPUBindGroupDescriptor bg = WGPU_BIND_GROUP_DESCRIPTOR_INIT;
		bg.layout = textureLayout_;
		bg.entryCount = 2;
		bg.entries = entries;
		WGPUBindGroup group = wgpuDeviceCreateBindGroup(device_, &bg);
		if (owned) wgpuTextureViewRelease(owned);
		return group;
	}

	WGPUDevice device_;
	WGPUQueue queue_;
	WGPUTextureFormat format_;
	WGPUBindGroupLayout uniformLayout_ = nullptr, textureLayout_ = nullptr;
	WGPURenderPipeline colourPipeline_ = nullptr, texturePipeline_ = nullptr;
	WGPUBuffer uniforms_[LAYERS] = {};
	WGPUBindGroup uniformGroups_[LAYERS] = {};
	WGPUBuffer instances_[LAYERS] = {};
	size_t capacity_[LAYERS] = {};
	WGPUTextureView target_[LAYERS] = {};
	WGPUSampler sampler_ = nullptr;
	WGPUBindGroup blank_ = nullptr;
	std::unordered_map<int, WGPUBindGroup> groups_;
};

// ---------------------------------------------------------------------------------------------
// WebGL 2: one context per layer, since a WebGL context draws only into its own canvas. A texture
// belongs to the layer whose context the page uploaded it into.
// ---------------------------------------------------------------------------------------------

const char* GLSL_VS = R"(#version 300 es
layout(location=0) in vec4 rect;
layout(location=1) in vec4 uvr;
layout(location=2) in vec4 colour;
layout(location=3) in vec4 style;
uniform vec4 u0; // view.xy, cam.xy
uniform vec4 u1; // zoom, dpr
out vec2 vUv; out vec4 vColour; out vec2 vLocal; out vec2 vHalf; out vec4 vStyle;
void main() {
	vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
	vec2 stage = rect.xy + corner * rect.zw;
	vec2 css = (stage - u0.zw) * u1.x + u0.xy * 0.5;
	if (style.w > 0.5) css = floor(css * u1.y + 0.5) / u1.y;
	gl_Position = vec4(css.x / u0.x * 2.0 - 1.0, 1.0 - css.y / u0.y * 2.0, 0.0, 1.0);
	vUv = mix(uvr.xy, uvr.zw, corner);
	vColour = colour;
	vec2 sizePx = rect.zw * u1.x * u1.y;
	vHalf = sizePx * 0.5;
	vLocal = (corner - 0.5) * sizePx;
	vStyle = vec4(style.x * u1.x * u1.y, style.y * u1.y, style.z, style.w);
}
)";

const char* GLSL_FS = R"(#version 300 es
// highp: at medium precision a phone or a Mac GPU may keep texture places to 1/2048, a quarter of a
// tile's pixel, which softens what should land texel for pixel.
precision highp float;
in vec2 vUv; in vec4 vColour; in vec2 vLocal; in vec2 vHalf; in vec4 vStyle;
uniform sampler2D tex;
uniform float textured;
out vec4 outColour;
void main() {
	float r = min(vStyle.x, min(vHalf.x, vHalf.y));
	vec2 q = abs(vLocal) - vHalf + r;
	float d = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
	float cover = clamp(0.5 - d, 0.0, 1.0);
	if (vStyle.y > 0.0) cover *= clamp(vStyle.y + 0.5 + d, 0.0, 1.0);
	if (vStyle.w > 0.5) cover = 1.0;
	outColour = textured > 0.5 ? texture(tex, vUv) * vColour.a * cover : vColour * cover;
}
)";

GLuint compile(GLenum type, const char* source) {
	GLuint shader = glCreateShader(type);
	glShaderSource(shader, 1, &source, nullptr);
	glCompileShader(shader);
	return shader;
}

class WebGl final : public Backend {
public:
	explicit WebGl(const EMSCRIPTEN_WEBGL_CONTEXT_HANDLE contexts[LAYERS]) {
		for (int i = 0; i < LAYERS; i++) {
			contexts_[i] = contexts[i];
			if (!contexts_[i]) continue;
			emscripten_webgl_make_context_current(contexts_[i]);
			GLuint program = glCreateProgram();
			glAttachShader(program, compile(GL_VERTEX_SHADER, GLSL_VS));
			glAttachShader(program, compile(GL_FRAGMENT_SHADER, GLSL_FS));
			glLinkProgram(program);
			programs_[i] = program;
			glGenVertexArrays(1, &vaos_[i]);
			glBindVertexArray(vaos_[i]);
			glGenBuffers(1, &buffers_[i]);
			glBindBuffer(GL_ARRAY_BUFFER, buffers_[i]);
			for (int a = 0; a < 4; a++) {
				glEnableVertexAttribArray(a);
				glVertexAttribPointer(a, 4, GL_FLOAT, GL_FALSE, sizeof(Quad), reinterpret_cast<void*>(a * 16));
				glVertexAttribDivisor(a, 1);
			}
			glEnable(GL_BLEND);
			glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
		}
	}

	void adopt(int id, int layer, GLuint texture) {
		forget(id);
		textures_[id] = {layer, texture};
	}

	bool frame(int layer, const Uniforms& u, const std::vector<Quad>& quads, const std::vector<std::pair<int, int>>& runs, const std::vector<int>& textures) override {
		if (!contexts_[layer]) return false;
		emscripten_webgl_make_context_current(contexts_[layer]);
		int w = 0, h = 0;
		emscripten_webgl_get_drawing_buffer_size(contexts_[layer], &w, &h);
		glViewport(0, 0, w, h);
		glClearColor(0, 0, 0, 0);
		glClear(GL_COLOR_BUFFER_BIT);
		if (quads.empty()) return true;
		GLuint program = programs_[layer];
		glUseProgram(program);
		glUniform4f(glGetUniformLocation(program, "u0"), u.viewW, u.viewH, u.camX, u.camY);
		glUniform4f(glGetUniformLocation(program, "u1"), u.zoom, u.dpr, 0, 0);
		glUniform1i(glGetUniformLocation(program, "tex"), 0);
		GLint texturedAt = glGetUniformLocation(program, "textured");
		glBindVertexArray(vaos_[layer]);
		glBindBuffer(GL_ARRAY_BUFFER, buffers_[layer]);
		glBufferData(GL_ARRAY_BUFFER, quads.size() * sizeof(Quad), quads.data(), GL_STREAM_DRAW);
		glActiveTexture(GL_TEXTURE0);
		for (size_t i = 0; i < runs.size(); i++) {
			auto found = textures[i] ? textures_.find(textures[i]) : textures_.end();
			bool textured = found != textures_.end() && found->second.first == layer;
			glUniform1f(texturedAt, textured ? 1.f : 0.f);
			glBindTexture(GL_TEXTURE_2D, textured ? found->second.second : 0);
			// WebGL 2 has no base-instance draw, so each run points the attributes at its first quad.
			for (int a = 0; a < 4; a++) glVertexAttribPointer(a, 4, GL_FLOAT, GL_FALSE, sizeof(Quad), reinterpret_cast<void*>(runs[i].first * sizeof(Quad) + a * 16));
			glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, runs[i].second);
		}
		return true;
	}

	void forget(int texture) override {
		auto found = textures_.find(texture);
		if (found == textures_.end()) return;
		textures_.erase(found);  // the page deletes the GL texture itself
	}

private:
	EMSCRIPTEN_WEBGL_CONTEXT_HANDLE contexts_[LAYERS] = {};
	GLuint programs_[LAYERS] = {}, vaos_[LAYERS] = {}, buffers_[LAYERS] = {};
	std::unordered_map<int, std::pair<int, GLuint>> textures_;
};

// ---------------------------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------------------------

struct Engine {
	Backend* backend = nullptr;
	WebGpu* gpu = nullptr;
	WebGl* gl = nullptr;
	std::unordered_map<int, Item> items;
	std::vector<int> sorted[LAYERS];
	bool orderDirty[LAYERS] = {true, true};
	bool dirty[LAYERS] = {true, true};
	Camera camera;
	View view;
	// What the last frame drew, per layer, for the page to read (`engine_stats`).
	int drawn[LAYERS] = {};
	int runs[LAYERS] = {};
	// Items on each layer: an empty layer that has been cleared once is never drawn again, so a
	// canvas with nothing on it asks the browser for no frame at all.
	int count[LAYERS] = {};
	std::vector<Quad> quads;
	std::vector<std::pair<int, int>> spans;
	std::vector<int> spanTextures;
};

Engine engine;

void touch(int layer) { engine.dirty[layer] = true; }

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE int engine_init_webgpu(int textureFormat) {
	WGPUDevice device = emscripten_webgpu_get_device();
	if (!device) return 0;
	engine.gpu = new WebGpu(device, static_cast<WGPUTextureFormat>(textureFormat));
	engine.backend = engine.gpu;
	return 1;
}

EMSCRIPTEN_KEEPALIVE int engine_init_webgl(int under, int over) {
	EMSCRIPTEN_WEBGL_CONTEXT_HANDLE contexts[LAYERS] = {static_cast<EMSCRIPTEN_WEBGL_CONTEXT_HANDLE>(under), static_cast<EMSCRIPTEN_WEBGL_CONTEXT_HANDLE>(over)};
	engine.gl = new WebGl(contexts);
	engine.backend = engine.gl;
	return 1;
}

EMSCRIPTEN_KEEPALIVE void engine_view(float width, float height, float dpr) {
	engine.view = View{width, height, dpr};
	touch(0);
	touch(1);
}

EMSCRIPTEN_KEEPALIVE void engine_camera(float x, float y, float zoom) {
	if (engine.camera.x == x && engine.camera.y == y && engine.camera.zoom == zoom) return;
	engine.camera = Camera{x, y, zoom};
	touch(0);
	touch(1);
}

// One rectangle: placed in stage pixels, drawn on a layer in an order, as a colour or a texture.
EMSCRIPTEN_KEEPALIVE void engine_item(int id, int layer, double order, float x, float y, float w, float h, int texture, float u0, float v0, float u1, float v1, uint32_t rgba, float radius, float stroke, int crisp) {
	layer = layer < 0 ? 0 : layer >= LAYERS ? LAYERS - 1 : layer;
	auto found = engine.items.find(id);
	if (found != engine.items.end()) {
		if (found->second.layer != layer || found->second.order != order) {
			engine.orderDirty[found->second.layer] = true;
			touch(found->second.layer);
		}
		engine.count[found->second.layer]--;
	} else {
		engine.orderDirty[layer] = true;
	}
	engine.count[layer]++;
	Item& item = engine.items[id];
	item.layer = layer;
	item.order = order;
	item.texture = texture;
	float a = ((rgba >> 0) & 255) / 255.f;
	float premul = a;
	item.quad = Quad{x, y, w, h, u0, v0, u1, v1, ((rgba >> 24) & 255) / 255.f * premul, ((rgba >> 16) & 255) / 255.f * premul, ((rgba >> 8) & 255) / 255.f * premul, a, radius, stroke, static_cast<float>(texture ? KIND_TEXTURE : KIND_COLOUR), crisp ? 1.f : 0.f};
	touch(layer);
}

EMSCRIPTEN_KEEPALIVE void engine_remove(int id) {
	auto found = engine.items.find(id);
	if (found == engine.items.end()) return;
	engine.orderDirty[found->second.layer] = true;
	touch(found->second.layer);
	engine.count[found->second.layer]--;
	engine.items.erase(found);
}

EMSCRIPTEN_KEEPALIVE void engine_clear() {
	engine.items.clear();
	for (int i = 0; i < LAYERS; i++) {
		engine.count[i] = 0;
		engine.orderDirty[i] = true;
		touch(i);
	}
}

// A texture the page imported into the WebGPU device: `view` is an imported GPUTextureView.
EMSCRIPTEN_KEEPALIVE void engine_texture_gpu(int id, WGPUTextureView view) {
	if (engine.gpu) engine.gpu->adopt(id, view);
	touch(0);
	touch(1);
}

// A texture the page uploaded into one layer's WebGL context.
EMSCRIPTEN_KEEPALIVE void engine_texture_gl(int id, int layer, int glTexture) {
	if (engine.gl) engine.gl->adopt(id, layer, static_cast<GLuint>(glTexture));
	touch(layer);
}

EMSCRIPTEN_KEEPALIVE void engine_forget_texture(int id) {
	if (engine.backend) engine.backend->forget(id);
}

// WebGPU only: where this frame of a layer goes, the canvas's current texture as an imported view.
EMSCRIPTEN_KEEPALIVE void engine_target(int layer, WGPUTextureView view) {
	if (engine.gpu && layer >= 0 && layer < LAYERS) engine.gpu->setTarget(layer, view);
}

// Whether a layer needs drawing: something on it changed, or the camera moved.
EMSCRIPTEN_KEEPALIVE int engine_dirty(int layer) {
	if (layer < 0 || layer >= LAYERS || !engine.dirty[layer]) return 0;
	if (engine.count[layer] == 0 && engine.drawn[layer] == 0) {
		engine.dirty[layer] = false;
		return 0;
	}
	return 1;
}

// How many items of a layer are in view now, without drawing: whether a sleeping canvas must wake.
EMSCRIPTEN_KEEPALIVE int engine_visible(int layer) {
	if (layer < 0 || layer >= LAYERS) return 0;
	const Camera& c = engine.camera;
	const View& v = engine.view;
	float halfW = v.width / 2 / c.zoom, halfH = v.height / 2 / c.zoom;
	float left = c.x - halfW, right = c.x + halfW, top = c.y - halfH, bottom = c.y + halfH;
	int seen = 0;
	for (auto& [id, item] : engine.items) {
		if (item.layer != layer) continue;
		const Quad& q = item.quad;
		float slack = (q.stroke + 2) / c.zoom;
		if (q.x + q.w < left - slack || q.x > right + slack || q.y + q.h < top - slack || q.y > bottom + slack) continue;
		seen++;
	}
	return seen;
}

// Draw one layer: the items in view, in order, batched by texture. Returns how many were drawn.
EMSCRIPTEN_KEEPALIVE int engine_frame(int layer) {
	if (!engine.backend || layer < 0 || layer >= LAYERS) return -1;
	if (engine.orderDirty[layer]) {
		auto& list = engine.sorted[layer];
		list.clear();
		for (auto& [id, item] : engine.items)
			if (item.layer == layer) list.push_back(id);
		std::sort(list.begin(), list.end(), [](int a, int b) {
			const Item& x = engine.items[a];
			const Item& y = engine.items[b];
			return x.order != y.order ? x.order < y.order : a < b;
		});
		engine.orderDirty[layer] = false;
	}
	const Camera& c = engine.camera;
	const View& v = engine.view;
	float halfW = v.width / 2 / c.zoom, halfH = v.height / 2 / c.zoom;
	float left = c.x - halfW, right = c.x + halfW, top = c.y - halfH, bottom = c.y + halfH;
	auto& quads = engine.quads;
	auto& spans = engine.spans;
	auto& spanTextures = engine.spanTextures;
	quads.clear();
	spans.clear();
	spanTextures.clear();
	for (int id : engine.sorted[layer]) {
		const Item& item = engine.items[id];
		const Quad& q = item.quad;
		// A stroke reaches past the box by its width; a few pixels of slack covers it.
		float slack = (q.stroke + 2) / c.zoom;
		if (q.x + q.w < left - slack || q.x > right + slack || q.y + q.h < top - slack || q.y > bottom + slack) continue;
		if (spans.empty() || spanTextures.back() != item.texture) {
			spans.emplace_back(static_cast<int>(quads.size()), 0);
			spanTextures.push_back(item.texture);
		}
		spans.back().second++;
		quads.push_back(q);
	}
	Uniforms u{v.width, v.height, c.x, c.y, c.zoom, v.dpr, 0, 0};
	if (!engine.backend->frame(layer, u, quads, spans, spanTextures)) return -1;
	engine.dirty[layer] = false;
	engine.drawn[layer] = static_cast<int>(quads.size());
	engine.runs[layer] = static_cast<int>(spans.size());
	return engine.drawn[layer];
}

EMSCRIPTEN_KEEPALIVE int engine_stat(int which) {
	switch (which) {
		case 0: return static_cast<int>(engine.items.size());
		case 1: return engine.drawn[0];
		case 2: return engine.drawn[1];
		case 3: return engine.runs[0];
		case 4: return engine.runs[1];
		default: return 0;
	}
}

}  // extern "C"
