// Painting the drawing ourselves, on the GPU: the tiles CanvasKit paints today (`apps/web/src/canvas/
// pen/paint.ts`), drawn into a WebGL 2 canvas the worker hands us, item by item in the document's order.
//
// Each item comes as a paint record the page resolved (`paint-wire.ts` in the app): its kind, opacity,
// turn and mirror, fills, stroke and shadows, with every colour already a number. Shapes are drawn
// exactly: a rounded rectangle with four radii or an ellipse is a quad whose fragment shader works out
// how much of each pixel the shape covers, so edges are anti-aliased as Skia's analytic coverage does.
// A clip is a rounded rectangle every draw inside it multiplies its coverage by; an item with opacity
// is drawn into a layer of its own and laid down faded; a shadow is the closed-form blur of a rounded
// rectangle (Evan Wallace's), Skia's blur sigma being half the blur asked for.
//
// What this step cannot draw yet, it says so (`paint_tile` returns 0) and the worker paints that tile
// with CanvasKit, so the drawing is never wrong while the painter grows.
#include <GLES3/gl3.h>
#include <emscripten/emscripten.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

// The scene's items and their boxes (`scene.cpp`).
struct PaintBox { double x, y, w, h; bool placed; };
int sceneRoots(const int** out);
int sceneChildren(int handle, const int** out);
PaintBox sceneBox(int handle);

namespace {

// --- what the page sends for an item ---------------------------------------------------------------

struct Rgba { float r, g, b, a; };
struct Shadow { Rgba color; double blur, dx, dy; };
struct Stroke {
	bool on = false;
	Rgba color{0, 0, 0, 0};
	double widths[4] = {0, 0, 0, 0};  // top, right, bottom, left
	int align = 1;                    // 0 inside, 1 centred, 2 outside
};
enum Kind : int { K_NONE = 0, K_RECT = 1, K_ELLIPSE = 2, K_NOTE = 6, K_GROUP = 7, K_UNSUPPORTED = 99 };
struct Record {
	int kind = K_NONE;
	double opacity = 1, rotation = 0;
	bool flipX = false, flipY = false;
	bool clip = false;
	double radii[4] = {0, 0, 0, 0};  // top-left, top-right, bottom-right, bottom-left
	std::vector<Rgba> fills;
	Stroke stroke;
	std::vector<Shadow> shadows;
	// A card's paper (a frame marked a card with no fill, or a sound) and a note card: the app's two
	// shadows, the paper and the hairline edge outside the box.
	bool paper = false, sound = false;
	Rgba paperColor{1, 1, 1, 1};
};
std::vector<Record> records;
std::vector<char> skipped, holes;
bool dark = false;

// --- GL ---------------------------------------------------------------------------------------------

GLuint program = 0, layerProgram = 0, vao = 0;
GLint uView, uMatrix, uRect, uRadii, uColor, uMode, uStroke, uSigma, uClipCount, uClipMatrix, uClipRect, uClipRadii, uLevel;
GLint lTex, lAlpha;
int tileW = 0, tileH = 0;

const char* VS = R"(#version 300 es
precision highp float;
uniform vec2 uView;        // the tile, in pixels
uniform mat3 uMatrix;      // item space to tile pixels
uniform vec4 uRect;        // the quad drawn, in item space: x, y, w, h
out vec2 vLocal;           // item space
void main() {
	vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
	vLocal = uRect.xy + corner * uRect.zw;
	vec3 px = uMatrix * vec3(vLocal, 1.0);
	gl_Position = vec4(px.x / uView.x * 2.0 - 1.0, 1.0 - px.y / uView.y * 2.0, 0.0, 1.0);
}
)";

const char* FS = R"(#version 300 es
precision highp float;
in vec2 vLocal;
uniform mat3 uMatrix;
uniform float uLevel;      // tile pixels per item unit, along the item's axes
uniform vec4 uShape;       // unused
uniform vec4 uRadii;       // tl, tr, br, bl, item units
uniform vec4 uColor;       // straight rgba
uniform int uMode;         // 0 rrect fill, 1 rrect stroke, 2 ellipse fill, 3 ellipse stroke, 4 rrect shadow
uniform vec4 uStroke;      // width, align (0 in, 1 centre, 2 out)
uniform float uSigma;      // shadow blur, item units
uniform vec4 uShapeRect;   // the shape's own box: x, y, w, h
uniform vec4 uInnerRect;   // mode 5: the stroke's inner edge, a box and its radii
uniform vec4 uInnerRadii;
uniform int uClipCount;
uniform mat3 uClipMatrix[4];  // tile pixels to each clip's item space
uniform vec4 uClipRect[4];
uniform vec4 uClipRadii[4];
uniform float uClipLevel[4];
uniform int uClipKind[4];      // 0 a rounded rectangle, 1 an ellipse
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 halfSize, vec4 r) {
	vec2 rr = p.x > 0.0 ? vec2(r.y, r.z) : vec2(r.x, r.w);
	float rad = p.y > 0.0 ? rr.y : rr.x;
	vec2 q = abs(p) - halfSize + rad;
	return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rad;
}
float sdEllipse(vec2 p, vec2 r) {
	r = max(r, vec2(1e-4));
	float k0 = length(p / r);
	float k1 = length(p / (r * r));
	return k0 < 1e-6 ? -min(r.x, r.y) : k0 * (k0 - 1.0) / k1;
}
// Coverage of an edge at signed distance d, in pixels: what an analytic rasteriser gives.
float cover(float d) { return clamp(0.5 - d, 0.0, 1.0); }
float band(float d, float w, float align) {
	// Inside the edge (align 0), centred on it (1) or outside it (2): the ring between two distances.
	float inner = align < 0.5 ? -w : align < 1.5 ? -w * 0.5 : 0.0;
	float outer = inner + w;
	return clamp(min(0.5 - (d - outer), 0.5 + (d - inner)), 0.0, 1.0) * step(0.0, w);
}
// The blur of a rounded rectangle's edge, closed form (Evan Wallace, madebyevan.com).
vec4 erf4(vec4 x) {
	vec4 s = sign(x), a = abs(x);
	x = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
	x *= x;
	return s - s / (x * x);
}
float gaussian(float x, float sigma) { return exp(-(x * x) / (2.0 * sigma * sigma)) / (2.5066282746 * sigma); }
float roundedBoxShadowX(float x, float y, float sigma, float corner, vec2 halfSize) {
	float delta = min(halfSize.y - corner - abs(y), 0.0);
	float curved = halfSize.x - corner + sqrt(max(0.0, corner * corner - delta * delta));
	vec2 integral = 0.5 + 0.5 * erf4(vec4((x + vec2(-curved, curved)) * (sqrt(0.5) / sigma), 0.0, 0.0)).xy;
	return integral.y - integral.x;
}
float roundedBoxShadow(vec2 p, vec2 halfSize, float sigma, float corner) {
	float low = p.y - halfSize.y;
	float high = p.y + halfSize.y;
	float start = clamp(-3.0 * sigma, low, high);
	float end = clamp(3.0 * sigma, low, high);
	float step_ = (end - start) / 4.0;
	float y = start + step_ * 0.5;
	float value = 0.0;
	for (int i = 0; i < 4; i++) {
		value += roundedBoxShadowX(p.x, p.y - y, sigma, corner, halfSize) * gaussian(y, sigma) * step_;
		y += step_;
	}
	return value;
}

void main() {
	vec2 centre = uShapeRect.xy + uShapeRect.zw * 0.5;
	vec2 p = vLocal - centre;
	vec2 half_ = uShapeRect.zw * 0.5;
	float c = 0.0;
	if (uMode == 0) c = cover(sdRoundBox(p, half_, uRadii) * uLevel);
	else if (uMode == 1) c = band(sdRoundBox(p, half_, uRadii) * uLevel, uStroke.x * uLevel, uStroke.y);
	else if (uMode == 2) c = cover(sdEllipse(p, half_) * uLevel);
	else if (uMode == 3) c = band(sdEllipse(p, half_) * uLevel, uStroke.x * uLevel, uStroke.y);
	else if (uMode == 5) {
		// A rectangle's stroke: inside its outer edge and outside its inner one.
		float outer = cover(sdRoundBox(p, half_, uRadii) * uLevel);
		float inner = uInnerRect.z > 0.0 && uInnerRect.w > 0.0 ? cover(sdRoundBox(vLocal - (uInnerRect.xy + uInnerRect.zw * 0.5), uInnerRect.zw * 0.5, uInnerRadii) * uLevel) : 0.0;
		c = clamp(outer - inner, 0.0, 1.0);
	}
	else if (uMode == 6) {
		// A blurred ellipse: the blur of an edge at the distance from it, which holds where the ellipse is
		// round against the blur, as an ellipse with a shadow mostly is.
		float d = sdEllipse(p, half_);
		c = uSigma > 0.0 ? 0.5 - 0.5 * erf4(vec4(d / (sqrt(2.0) * uSigma))).x : cover(d * uLevel);
	}
	else if (uMode == 4) {
		float corner = min(max(max(uRadii.x, uRadii.y), max(uRadii.z, uRadii.w)), min(half_.x, half_.y));
		c = uSigma > 0.0 ? roundedBoxShadow(p, half_, uSigma, corner) : cover(sdRoundBox(p, half_, uRadii) * uLevel);
	}
	// Each clip, a rounded rectangle in its own item's space, takes its share of the coverage.
	for (int i = 0; i < 4; i++) {
		if (i >= uClipCount) break;
		vec3 q = uClipMatrix[i] * vec3(gl_FragCoord.x, gl_FragCoord.y, 1.0);
		vec4 r = uClipRect[i];
		vec2 qc = q.xy - (r.xy + r.zw * 0.5);
		c *= cover((uClipKind[i] == 1 ? sdEllipse(qc, r.zw * 0.5) : sdRoundBox(qc, r.zw * 0.5, uClipRadii[i])) * uClipLevel[i]);
	}
	float a = uColor.a * c;
	outColor = vec4(uColor.rgb * a, a);
}
)";

const char* LAYER_VS = R"(#version 300 es
precision highp float;
out vec2 vUv;
void main() {
	vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
	vUv = corner;
	gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
)";
const char* LAYER_FS = R"(#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv) * uAlpha; }
)";

GLuint compile(GLenum type, const char* src) {
	GLuint shader = glCreateShader(type);
	glShaderSource(shader, 1, &src, nullptr);
	glCompileShader(shader);
	GLint ok = 0;
	glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
	if (!ok) {
		char log[2048];
		glGetShaderInfoLog(shader, sizeof(log), nullptr, log);
		emscripten_log(EM_LOG_ERROR, "paint: a shader did not compile: %s", log);
	}
	return shader;
}
GLuint link(const char* vs, const char* fs) {
	GLuint p = glCreateProgram();
	glAttachShader(p, compile(GL_VERTEX_SHADER, vs));
	glAttachShader(p, compile(GL_FRAGMENT_SHADER, fs));
	glLinkProgram(p);
	GLint ok = 0;
	glGetProgramiv(p, GL_LINK_STATUS, &ok);
	if (!ok) {
		char log[2048];
		glGetProgramInfoLog(p, sizeof(log), nullptr, log);
		emscripten_log(EM_LOG_ERROR, "paint: a program did not link: %s", log);
	}
	return p;
}

// --- the transform and clip stacks ------------------------------------------------------------------

// A 2D affine map, item space to tile pixels: x' = a x + c y + e, y' = b x + d y + f.
struct Affine {
	double a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;
	Affine then(const Affine& o) const {  // this, then o
		return {o.a * a + o.c * b, o.b * a + o.d * b, o.a * c + o.c * d, o.b * c + o.d * d, o.a * e + o.c * f + o.e, o.b * e + o.d * f + o.f};
	}
	Affine inverse() const {
		const double det = a * d - b * c;
		const double ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
		return {ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)};
	}
	double scale() const { return std::sqrt(std::fabs(a * d - b * c)); }
};
struct Clip { Affine toItem; double rect[4]; double radii[4]; double level; int kind = 0; };

struct Painter {
	Affine m;
	std::vector<Clip> clips;
	bool supported = true;
	std::vector<GLuint> layers;  // framebuffers of open opacity layers
	std::vector<GLuint> layerTextures;
};
Painter painter;

void setUniforms(const Affine& m, const double rect[4], const double shape[4], const double radii[4], Rgba color, int mode, double strokeWidth, int align, double sigma) {
	const float mat[9] = {float(m.a), float(m.b), 0, float(m.c), float(m.d), 0, float(m.e), float(m.f), 1};
	glUniformMatrix3fv(uMatrix, 1, GL_FALSE, mat);
	glUniform4f(uRect, float(rect[0]), float(rect[1]), float(rect[2]), float(rect[3]));
	glUniform4f(glGetUniformLocation(program, "uShapeRect"), float(shape[0]), float(shape[1]), float(shape[2]), float(shape[3]));
	glUniform4f(uRadii, float(radii[0]), float(radii[1]), float(radii[2]), float(radii[3]));
	glUniform4f(uColor, color.r, color.g, color.b, color.a);
	glUniform1i(uMode, mode);
	glUniform4f(uStroke, float(strokeWidth), float(align), 0, 0);
	glUniform1f(uSigma, float(sigma));
	glUniform1f(uLevel, float(m.scale()));
	const int count = std::min<int>(4, int(painter.clips.size()));
	glUniform1i(uClipCount, count);
	for (int i = 0; i < count; i++) {
		const Clip& clip = painter.clips[painter.clips.size() - size_t(count) + size_t(i)];
		// gl_FragCoord counts from the bottom; the tile's pixels from the top.
		Affine flip{1, 0, 0, -1, 0, double(tileH)};
		Affine toItem = flip.then(clip.toItem);
		const float cm[9] = {float(toItem.a), float(toItem.b), 0, float(toItem.c), float(toItem.d), 0, float(toItem.e), float(toItem.f), 1};
		const std::string at = std::to_string(i);
		glUniformMatrix3fv(glGetUniformLocation(program, ("uClipMatrix[" + at + "]").c_str()), 1, GL_FALSE, cm);
		glUniform4f(glGetUniformLocation(program, ("uClipRect[" + at + "]").c_str()), float(clip.rect[0]), float(clip.rect[1]), float(clip.rect[2]), float(clip.rect[3]));
		glUniform4f(glGetUniformLocation(program, ("uClipRadii[" + at + "]").c_str()), float(clip.radii[0]), float(clip.radii[1]), float(clip.radii[2]), float(clip.radii[3]));
		glUniform1f(glGetUniformLocation(program, ("uClipLevel[" + at + "]").c_str()), float(clip.level));
		glUniform1i(glGetUniformLocation(program, ("uClipKind[" + at + "]").c_str()), clip.kind);
	}
	if (painter.clips.size() > 4) painter.supported = false;
}

void drawQuad() { glDrawArrays(GL_TRIANGLE_STRIP, 0, 4); }

// A shape's quad: its box, grown to hold its anti-aliased edge, an outside stroke, or a blur.
void drawShape(const double box[4], const double radii[4], Rgba color, int mode, double strokeWidth = 0, int align = 1, double sigma = 0, double dx = 0, double dy = 0) {
	if (color.a <= 0) return;
	const double level = painter.m.scale();
	const double grow = 2 / std::max(level, 1e-6) + (mode == 1 || mode == 3 ? strokeWidth : 0) + sigma * 3;
	const double shape[4] = {box[0] + dx, box[1] + dy, box[2], box[3]};
	const double quad[4] = {shape[0] - grow, shape[1] - grow, shape[2] + grow * 2, shape[3] + grow * 2};
	setUniforms(painter.m, quad, shape, radii, color, mode, strokeWidth, align, sigma);
	drawQuad();
}

// --- items -------------------------------------------------------------------------------------------

void paintChildren(int handle);

// The app's two-layer shadow for the scheme, as `paintCardPaper` and the note card draw it.
void appShadows(const double box[4], const double radii[4]) {
	struct Layer { double y, blur, alpha; };
	static const Layer light[2] = {{1, 2, 0.06}, {4, 12, 0.05}};
	static const Layer darkLayers[2] = {{1, 2, 0.4}, {6, 18, 0.3}};
	for (const Layer& layer : dark ? darkLayers : light) drawShape(box, radii, Rgba{0, 0, 0, float(layer.alpha)}, 4, 0, 1, layer.blur / 2, 0, layer.y);
}
// The hairline edge outside the box, as a CSS outline is.
void hairline(const double box[4], double radius) {
	const double outer[4] = {box[0] - 0.5, box[1] - 0.5, box[2] + 1, box[3] + 1};
	const double radii[4] = {radius + 0.5, radius + 0.5, radius + 0.5, radius + 0.5};
	drawShape(outer, radii, dark ? Rgba{1, 1, 1, 0.12f} : Rgba{0, 0, 0, 0.1f}, 1, 1, 1);
}

void paintStroke(const Record& r, const double box[4], const double radii[4], bool ellipse) {
	const Stroke& s = r.stroke;
	if (!s.on) return;
	const bool uniform = s.widths[0] == s.widths[1] && s.widths[1] == s.widths[2] && s.widths[2] == s.widths[3];
	if (uniform && ellipse) {
		drawShape(box, radii, s.color, 3, s.widths[0], s.align);
		return;
	}
	if (uniform) {
		/*
		 * Between two rounded rectangles, as Skia strokes one with mitred joins: the outer edge grown by
		 * what lies outside, its corners square where the shape's are and rounder where they are round;
		 * the inner edge shrunk by what lies inside, its corners tighter, square once they run out.
		 */
		const double w = s.widths[0];
		const double out = s.align == 0 ? 0 : s.align == 1 ? w / 2 : w;
		const double in = w - out;
		const double outer[4] = {box[0] - out, box[1] - out, box[2] + out * 2, box[3] + out * 2};
		double outerRadii[4], innerRadii[4];
		for (int i = 0; i < 4; i++) {
			outerRadii[i] = radii[i] > 0 ? radii[i] + out : 0;
			innerRadii[i] = std::max(0.0, radii[i] - in);
		}
		const double inner[4] = {box[0] + in, box[1] + in, box[2] - in * 2, box[3] - in * 2};
		const double level = painter.m.scale();
		const double grow = 2 / std::max(level, 1e-6);
		const double quad[4] = {outer[0] - grow, outer[1] - grow, outer[2] + grow * 2, outer[3] + grow * 2};
		setUniforms(painter.m, quad, outer, outerRadii, s.color, 5, 0, 1, 0);
		glUniform4f(glGetUniformLocation(program, "uInnerRect"), float(inner[0]), float(inner[1]), float(std::max(0.0, inner[2])), float(std::max(0.0, inner[3])));
		glUniform4f(glGetUniformLocation(program, "uInnerRadii"), float(innerRadii[0]), float(innerRadii[1]), float(innerRadii[2]), float(innerRadii[3]));
		if (s.color.a > 0) drawQuad();
		return;
	}
	// Per side: bars along the edges, inside the box, clipped to its shape.
	Clip clip{painter.m.inverse(), {box[0], box[1], box[2], box[3]}, {radii[0], radii[1], radii[2], radii[3]}, painter.m.scale(), ellipse ? 1 : 0};
	painter.clips.push_back(clip);
	const double zero[4] = {0, 0, 0, 0};
	const double x = box[0], y = box[1], w = box[2], h = box[3];
	if (s.widths[0] > 0) { const double b[4] = {x, y, w, s.widths[0]}; drawShape(b, zero, s.color, 0); }
	if (s.widths[2] > 0) { const double b[4] = {x, y + h - s.widths[2], w, s.widths[2]}; drawShape(b, zero, s.color, 0); }
	if (s.widths[3] > 0) { const double b[4] = {x, y, s.widths[3], h}; drawShape(b, zero, s.color, 0); }
	if (s.widths[1] > 0) { const double b[4] = {x + w - s.widths[1], y, s.widths[1], h}; drawShape(b, zero, s.color, 0); }
	painter.clips.pop_back();
}

void beginLayer() {
	GLuint fb = 0, tex = 0;
	glGenTextures(1, &tex);
	glBindTexture(GL_TEXTURE_2D, tex);
	glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, tileW, tileH, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glGenFramebuffers(1, &fb);
	glBindFramebuffer(GL_FRAMEBUFFER, fb);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
	glClearColor(0, 0, 0, 0);
	glClear(GL_COLOR_BUFFER_BIT);
	painter.layers.push_back(fb);
	painter.layerTextures.push_back(tex);
}
void endLayer(double alpha) {
	const GLuint fb = painter.layers.back(), tex = painter.layerTextures.back();
	painter.layers.pop_back();
	painter.layerTextures.pop_back();
	glBindFramebuffer(GL_FRAMEBUFFER, painter.layers.empty() ? 0 : painter.layers.back());
	glUseProgram(layerProgram);
	glActiveTexture(GL_TEXTURE0);
	glBindTexture(GL_TEXTURE_2D, tex);
	glUniform1i(lTex, 0);
	glUniform1f(lAlpha, float(alpha));
	drawQuad();
	glUseProgram(program);
	glDeleteFramebuffers(1, &fb);
	glDeleteTextures(1, &tex);
}

void paintNode(int handle) {
	if (handle < 0 || size_t(handle) >= records.size()) return;
	if (skipped[size_t(handle)]) return;
	const PaintBox placed = sceneBox(handle);
	if (!placed.placed) return;
	const Record& r = records[size_t(handle)];
	if (r.kind == K_UNSUPPORTED || holes[size_t(handle)]) {
		painter.supported = false;
		return;
	}
	if (r.kind == K_NONE) return;
	const double opacity = std::clamp(r.opacity, 0.0, 1.0);
	if (opacity <= 0) return;
	const double box[4] = {placed.x, placed.y, placed.w, placed.h};
	const Affine saved = painter.m;
	// The item's turn about its top-left corner, counter-clockwise, then its mirror in its box.
	Affine local;
	if (r.rotation != 0) {
		const double t = -r.rotation * M_PI / 180, cs = std::cos(t), sn = std::sin(t);
		local = Affine{cs, sn, -sn, cs, placed.x - cs * placed.x + sn * placed.y, placed.y - sn * placed.x - cs * placed.y};
	}
	if (r.flipX || r.flipY) {
		const double cx = placed.x + placed.w / 2, cy = placed.y + placed.h / 2, sx = r.flipX ? -1 : 1, sy = r.flipY ? -1 : 1;
		local = Affine{sx, 0, 0, sy, cx - sx * cx, cy - sy * cy}.then(local);
	}
	painter.m = local.then(painter.m);
	if (opacity < 1) beginLayer();
	double radii[4];
	for (int i = 0; i < 4; i++) radii[i] = std::max(0.0, std::min({r.radii[i], placed.w / 2, placed.h / 2}));
	switch (r.kind) {
		case K_RECT: {
			if (r.paper) {
				appShadows(box, radii);
				drawShape(box, radii, r.paperColor, 0);
			}
			for (const Shadow& s : r.shadows) drawShape(box, radii, s.color, 4, 0, 1, s.blur / 2, s.dx, s.dy);
			if (!r.sound)
				for (const Rgba& fill : r.fills) drawShape(box, radii, fill, 0);
			if (r.clip) {
				painter.clips.push_back(Clip{painter.m.inverse(), {box[0], box[1], box[2], box[3]}, {radii[0], radii[1], radii[2], radii[3]}, painter.m.scale()});
				paintChildren(handle);
				painter.clips.pop_back();
			} else paintChildren(handle);
			paintStroke(r, box, radii, false);
			if (r.paper) hairline(box, r.radii[0]);
			break;
		}
		case K_ELLIPSE: {
			const double none[4] = {0, 0, 0, 0};
			for (const Shadow& s : r.shadows) drawShape(box, none, s.color, 6, 0, 1, s.blur / 2, s.dx, s.dy);
			for (const Rgba& fill : r.fills) drawShape(box, none, fill, 2);
			paintStroke(r, box, none, true);
			break;
		}
		case K_NOTE: {
			const double round[4] = {12, 12, 12, 12};
			appShadows(box, round);
			if (r.fills.empty()) drawShape(box, round, r.paperColor, 0);
			for (const Rgba& fill : r.fills) drawShape(box, round, fill, 0);
			hairline(box, 12);
			break;
		}
		case K_GROUP:
			paintChildren(handle);
			break;
		default:
			break;
	}
	if (opacity < 1) endLayer(opacity);
	painter.m = saved;
}

void paintChildren(int handle) {
	const int* kids = nullptr;
	const int count = sceneChildren(handle, &kids);
	std::vector<int> list(kids, kids + count);
	for (int child : list) paintNode(child);
}

}  // namespace

extern "C" {

// The GL context the worker made current (`GL.makeContextCurrent`): the painter's programs, once.
EMSCRIPTEN_KEEPALIVE void paint_init() {
	program = link(VS, FS);
	layerProgram = link(LAYER_VS, LAYER_FS);
	uView = glGetUniformLocation(program, "uView");
	uMatrix = glGetUniformLocation(program, "uMatrix");
	uRect = glGetUniformLocation(program, "uRect");
	uRadii = glGetUniformLocation(program, "uRadii");
	uColor = glGetUniformLocation(program, "uColor");
	uMode = glGetUniformLocation(program, "uMode");
	uStroke = glGetUniformLocation(program, "uStroke");
	uSigma = glGetUniformLocation(program, "uSigma");
	uLevel = glGetUniformLocation(program, "uLevel");
	uClipCount = glGetUniformLocation(program, "uClipCount");
	lTex = glGetUniformLocation(layerProgram, "uTex");
	lAlpha = glGetUniformLocation(layerProgram, "uAlpha");
	glGenVertexArrays(1, &vao);
}

// An item's paint record: `count` numbers at the scene's input (`paint-wire.ts` writes them).
EMSCRIPTEN_KEEPALIVE void paint_record(int handle, const double* f, int count) {
	if (handle < 0) return;
	if (size_t(handle) >= records.size()) {
		records.resize(size_t(handle) + 1);
		skipped.resize(records.size(), 0);
		holes.resize(records.size(), 0);
	}
	Record r;
	int at = 0;
	auto next = [&]() { return at < count ? f[at++] : 0.0; };
	auto rgba = [&]() { Rgba c; c.r = float(next()); c.g = float(next()); c.b = float(next()); c.a = float(next()); return c; };
	r.kind = int(next());
	r.opacity = next();
	r.rotation = next();
	r.flipX = next() != 0;
	r.flipY = next() != 0;
	if (r.kind == K_RECT || r.kind == K_ELLIPSE || r.kind == K_NOTE) {
		r.clip = next() != 0;
		r.paper = next() != 0;
		r.sound = next() != 0;
		r.paperColor = rgba();
		for (double& v : r.radii) v = next();
		const int fills = int(next());
		for (int i = 0; i < fills; i++) r.fills.push_back(rgba());
		r.stroke.on = next() != 0;
		r.stroke.color = rgba();
		for (double& v : r.stroke.widths) v = next();
		r.stroke.align = int(next());
		const int shadows = int(next());
		for (int i = 0; i < shadows; i++) {
			Shadow s;
			s.color = rgba();
			s.blur = next();
			s.dx = next();
			s.dy = next();
			r.shadows.push_back(s);
		}
	}
	records[size_t(handle)] = r;
}

EMSCRIPTEN_KEEPALIVE void paint_flags(int handle, int skip, int hole) {
	if (handle < 0 || size_t(handle) >= records.size()) return;
	skipped[size_t(handle)] = char(skip);
	holes[size_t(handle)] = char(hole);
}
EMSCRIPTEN_KEEPALIVE void paint_scheme(int isDark) { dark = isDark != 0; }

// Paint the square of the drawing at stage (x, y), `size` stage units wide, into a `pixels`-square
// canvas. Returns 1 when everything in it was drawn, 0 when something there is beyond this painter.
EMSCRIPTEN_KEEPALIVE int paint_tile(double x, double y, double size, int pixels) {
	tileW = tileH = pixels;
	glBindFramebuffer(GL_FRAMEBUFFER, 0);
	glViewport(0, 0, pixels, pixels);
	glDisable(GL_DEPTH_TEST);
	glEnable(GL_BLEND);
	glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
	glClearColor(0, 0, 0, 0);
	glClear(GL_COLOR_BUFFER_BIT);
	glUseProgram(program);
	glBindVertexArray(vao);
	glUniform2f(uView, float(pixels), float(pixels));
	const double level = double(pixels) / size;
	painter = Painter{};
	painter.m = Affine{level, 0, 0, level, -x * level, -y * level};
	const int* roots = nullptr;
	const int count = sceneRoots(&roots);
	std::vector<int> list(roots, roots + count);
	for (int root : list) {
		const PaintBox b = sceneBox(root);
		// Far from the tile: nothing of it shows (its shadow reaches a little past its box).
		const bool contained = root < int(records.size()) && records[size_t(root)].rotation == 0 && (records[size_t(root)].clip || sceneChildren(root, nullptr) == 0);
		if (b.placed && contained && (b.x > x + size + 64 || b.y > y + size + 64 || b.x + b.w < x - 64 || b.y + b.h < y - 64)) continue;
		paintNode(root);
	}
	glBindVertexArray(0);
	return painter.supported ? 1 : 0;
}

}  // extern "C"
