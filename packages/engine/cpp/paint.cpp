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

#include "raster.h"

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
enum Kind : int { K_NONE = 0, K_RECT = 1, K_ELLIPSE = 2, K_PATH = 3, K_NOTE = 6, K_GROUP = 7, K_UNSUPPORTED = 99 };
// SVG geometry and the viewBox it is drawn in (x, y, w, h; a zero size is not scaled).
struct Affine_ { double sx, sy, tx, ty; };
struct Geometry {
	double vb[4] = {0, 0, 0, 0};
	std::string d;
	// The viewBox fitted onto the item's box, as `geometryPath` does.
	Affine_ fit(const double box[4]) const {
		const double sx = vb[2] ? box[2] / vb[2] : 1, sy = vb[3] ? box[3] / vb[3] : 1;
		return {sx, sy, box[0] - vb[0] * sx, box[1] - vb[1] * sy};
	}
};
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
	// The stroke's ends and corners, and its dashes in item units (empty for a solid line).
	int cap = 0, join = 0;  // butt, round, square; mitre, round, bevel
	std::vector<double> dash;
	// A path (K_PATH): SVG geometry (0), a regular polygon (1), or an arc or ring of an ellipse (2).
	int sub = 0;
	bool evenOdd = false, arrow = false, arrowDash = false, hasFill = false;
	int sides = 3;
	double polyRadius = 0, inner = 0, start = 0, sweep = 360;
	std::vector<Geometry> geometry;  // the whole path; for a dashed arrow, then its line and its heads
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
uniform sampler2D uMask;       // mode 7: a coverage mask over the shape's box, in tile pixels
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
	else if (uMode == 7) c = texture(uMask, (vLocal - uShapeRect.xy) / uShapeRect.zw).r;
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
bool snapShadow = false;
void drawShape(const double box[4], const double radii[4], Rgba color, int mode, double strokeWidth = 0, int align = 1, double sigma = 0, double dx = 0, double dy = 0) {
	if (color.a <= 0) return;
	const double level = painter.m.scale();
	const double grow = 2 / std::max(level, 1e-6) + (mode == 1 || mode == 3 ? strokeWidth : 0) + sigma * 3;
	double shape[4] = {box[0] + dx, box[1] + dy, box[2], box[3]};
	// A blurred rounded rectangle Skia draws as a stretched nine-part mask starts on whole pixels: its
	// box, in the tile, rounded out to them first (`shadowRRect` decides when that holds).
	if (mode == 4 && sigma > 0 && snapShadow && painter.m.b == 0 && painter.m.c == 0) {
		// In the tile a mirror swaps the ends, so round the lower one down and the higher one up.
		const Affine& m = painter.m;
		const double x0 = m.a * shape[0] + m.e, x1 = m.a * (shape[0] + shape[2]) + m.e;
		const double y0 = m.d * shape[1] + m.f, y1 = m.d * (shape[1] + shape[3]) + m.f;
		const double l = std::floor(std::min(x0, x1) + 1e-6), r = std::ceil(std::max(x0, x1) - 1e-6);
		const double t = std::floor(std::min(y0, y1) + 1e-6), b = std::ceil(std::max(y0, y1) - 1e-6);
		const double ix0 = ((m.a > 0 ? l : r) - m.e) / m.a, ix1 = ((m.a > 0 ? r : l) - m.e) / m.a;
		const double iy0 = ((m.d > 0 ? t : b) - m.f) / m.d, iy1 = ((m.d > 0 ? b : t) - m.f) / m.d;
		shape[0] = ix0, shape[1] = iy0, shape[2] = ix1 - ix0, shape[3] = iy1 - iy0;
	}
	const double quad[4] = {shape[0] - grow, shape[1] - grow, shape[2] + grow * 2, shape[3] + grow * 2};
	setUniforms(painter.m, quad, shape, radii, color, mode, strokeWidth, align, sigma);
	drawQuad();
}

// --- paths: outlines made coverage masks on the CPU (`raster.cpp`), coloured here ---------------------

raster::Affine toRaster(const Affine& a) { return raster::Affine{a.a, a.b, a.c, a.d, a.e, a.f}; }
using Lines = std::vector<raster::Polyline>;

// A path in item space, in tile pixels: cut as Skia's edge builder cuts a fill, or finely for a line.
Lines flat(const raster::Path& path, raster::Cut cut = raster::Cut::FILL) { return raster::flatten(path, toRaster(painter.m), cut); }

// The mask of these outlines over the tile, grown by `pad` pixels for a blur to draw from.
// A hairline (`snap` false) is its pieces laid one over another, as Skia blends them.
raster::Mask coverage(const Lines& lines, bool evenOdd, int pad = 0, bool snap = true) {
	if (!snap) return raster::hairMask(lines, -pad, -pad, tileW + pad, tileH + pad);
	return raster::rasterize(lines, evenOdd, -pad, -pad, tileW + pad, tileH + pad, snap);
}

void drawMask(const raster::Mask& mask, Rgba color) {
	if (mask.w <= 0 || mask.h <= 0 || color.a <= 0) return;
	GLuint tex = 0;
	glGenTextures(1, &tex);
	glActiveTexture(GL_TEXTURE0);
	glBindTexture(GL_TEXTURE_2D, tex);
	glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
	glTexImage2D(GL_TEXTURE_2D, 0, GL_R8, mask.w, mask.h, 0, GL_RED, GL_UNSIGNED_BYTE, mask.a.data());
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	glUniform1i(glGetUniformLocation(program, "uMask"), 0);
	const double rect[4] = {double(mask.x), double(mask.y), double(mask.w), double(mask.h)};
	const double none[4] = {0, 0, 0, 0};
	setUniforms(Affine{}, rect, rect, none, color, 7, 0, 1, 0);
	drawQuad();
	glBindTexture(GL_TEXTURE_2D, 0);
	glDeleteTextures(1, &tex);
}

// A path's stroke as an outline in tile pixels: dashed in item units first, as Skia dashes before the
// view's scale, then the line cut finely and given its width, caps and joins.
//
// A stroke at most a device pixel wide is drawn as Skia draws it (`SkDrawTreatAsHairline`): a hairline,
// fainter by how wide the stroke is, which `alpha` is multiplied by.
Lines outline(const raster::Path& path, double width, int cap, int join, const std::vector<double>& dash, double* alpha = nullptr, bool* hair = nullptr) {
	const double level = painter.m.scale();
	const raster::Path line = dash.empty() ? path : raster::dash(path, dash, level);
	const raster::Cap c = cap == 1 ? raster::Cap::ROUND : cap == 2 ? raster::Cap::SQUARE : raster::Cap::BUTT;
	const raster::Join j = join == 1 ? raster::Join::ROUND : join == 2 ? raster::Join::BEVEL : raster::Join::MITER;
	// Skia's rough length of the width along each axis after the view (`fast_len`).
	auto fastLen = [](double x, double y) {
		x = std::fabs(x), y = std::fabs(y);
		if (x < y) std::swap(x, y);
		return x + y / 2;
	};
	const double len0 = fastLen(painter.m.a * width, painter.m.b * width), len1 = fastLen(painter.m.c * width, painter.m.d * width);
	if (len0 <= 1 && len1 <= 1) {
		if (alpha) *alpha = (len0 + len1) / 2 >= 1 ? 1 : double(int((len0 + len1) / 2 * 256)) / 256;
		if (hair) *hair = true;
		return raster::hairline(flat(line, raster::Cut::HAIR), c);
	}
	if (alpha) *alpha = 1;
	if (hair) *hair = false;
	return raster::stroke(flat(line, raster::Cut::FINE), width * level, c, j, 4);
}

// A stroke along a path, centred or, as `paintAligned` does, twice as wide and cut by the path's inside.
void strokePath(const raster::Path& path, bool evenOdd, double width, int align, int cap, int join, const std::vector<double>& dash, Rgba color) {
	double alpha = 1;
	bool hair = false;
	if (align == 1) {
		const Lines lines = outline(path, width, cap, join, dash, &alpha, &hair);
		drawMask(coverage(lines, false, 0, !hair), Rgba{color.r, color.g, color.b, float(color.a * alpha)});
		return;
	}
	const Lines lines = outline(path, width * 2, cap, join, dash, &alpha, &hair);
	const raster::Mask band = coverage(lines, false, 0, !hair);
	drawMask(raster::combine(band, coverage(flat(path), evenOdd), align == 0), Rgba{color.r, color.g, color.b, float(color.a * alpha)});
}

raster::Path ovalPath(const double box[4]);
// A rounded rectangle as Skia's `drawRRect` strokes one: a square-cornered one as `drawRect` does, from
// the top-left corner; a circle as `drawOval` does; any other as `addRRect` lays it out, from the left
// edge's lower end. All clockwise, which is where a dash pattern starts.
raster::Path rrectPath(const double box[4], const double radii[4]) {
	raster::Path p;
	const double l = box[0], t = box[1], r = box[0] + box[2], b = box[1] + box[3];
	const double tl = radii[0], tr = radii[1], br = radii[2], bl = radii[3];
	if (tl <= 0 && tr <= 0 && br <= 0 && bl <= 0) {
		p.moveTo({l, t});
		p.lineTo({r, t});
		p.lineTo({r, b});
		p.lineTo({l, b});
		p.close();
		return p;
	}
	const double half = box[2] / 2;
	if (box[2] == box[3] && tl == half && tr == half && br == half && bl == half) return ovalPath(box);
	// The eight points where corners meet edges, from the left edge's lower end; a corner is a conic
	// through its box corner, even one of no radius.
	const double w = 0.707106781;
	p.moveTo({l, b - bl});
	p.lineTo({l, t + tl});
	p.conicTo({l, t}, {l + tl, t}, w);
	p.lineTo({r - tr, t});
	p.conicTo({r, t}, {r, t + tr}, w);
	p.lineTo({r, b - br});
	p.conicTo({r, b}, {r - br, b}, w);
	p.lineTo({l + bl, b});
	p.conicTo({l, b}, {l, b - bl}, w);
	p.close();
	return p;
}
// An oval as Skia's `addOval` lays it out: from the right, clockwise.
raster::Path ovalPath(const double box[4]) {
	raster::Path p;
	p.addOval(box[0], box[1], box[0] + box[2], box[1] + box[3]);
	return p;
}
// A regular polygon in its box, the first corner at the top, its corners rounded (`polygonPath`).
raster::Path polygonPath(const double box[4], int sides, double radius) {
	raster::Path p;
	std::vector<raster::Vec> pts;
	for (int i = 0; i < sides; i++) {
		const double angle = -M_PI / 2 + i * 2 * M_PI / sides;
		pts.push_back({box[0] + box[2] / 2 + box[2] / 2 * std::cos(angle), box[1] + box[3] / 2 + box[3] / 2 * std::sin(angle)});
	}
	if (radius <= 0) {
		p.moveTo(pts[0]);
		for (int i = 1; i < sides; i++) p.lineTo(pts[size_t(i)]);
		p.close();
		return p;
	}
	double edge = 1e300;
	for (int i = 0; i < sides; i++) {
		const raster::Vec a = pts[size_t(i)], b = pts[size_t((i + 1) % sides)];
		edge = std::min(edge, std::hypot(b.x - a.x, b.y - a.y));
	}
	const double r = std::min(radius, edge / 2);
	const raster::Vec last = pts[size_t(sides - 1)], first = pts[0];
	p.moveTo({(last.x + first.x) / 2, (last.y + first.y) / 2});
	for (int i = 0; i < sides; i++) p.arcToTangent(pts[size_t(i)], pts[size_t((i + 1) % sides)], r);
	p.close();
	return p;
}
// An arc or a ring of an ellipse (`ellipsePath`): pen's angles turn counter-clockwise, Skia's clockwise.
raster::Path arcPath(const double box[4], double inner, double start, double sweep) {
	raster::Path p;
	const double l = box[0], t = box[1], r = box[0] + box[2], b = box[1] + box[3];
	const double cx = (l + r) / 2, cy = (t + b) / 2, hw = box[2] / 2 * inner, hh = box[3] / 2 * inner;
	if (std::fabs(sweep) >= 360) {
		p.addOval(l, t, r, b);
		if (inner > 0) p.addOval(cx - hw, cy - hh, cx + hw, cy + hh, true);
	} else if (inner > 0) {
		p.arcToOval(l, t, r, b, -start, -sweep, true);
		p.arcToOval(cx - hw, cy - hh, cx + hw, cy + hh, -start - sweep, sweep, false);
		p.close();
	} else {
		p.moveTo({cx, cy});
		p.arcToOval(l, t, r, b, -start, -sweep, false);
		p.close();
	}
	return p;
}

// SVG geometry fitted into the box, or nothing when Skia would refuse it.
bool geometryPath(const Geometry& g, const double box[4], raster::Path& out) {
	raster::Path parsed;
	if (g.d.empty() || !raster::parseSvg(g.d, parsed)) return false;
	const Affine_ f = g.fit(box);
	out = parsed.transformed(raster::Affine{f.sx, 0, 0, f.sy, f.tx, f.ty});
	return true;
}

// A shape's shadow as a blurred mask: its area moved by the offset, blurred by half the blur asked for.
void blurredShape(const raster::Path& path, const Shadow& s, bool evenOdd = false) {
	Lines shape = flat(path);
	const double dx = painter.m.a * s.dx + painter.m.c * s.dy, dy = painter.m.b * s.dx + painter.m.d * s.dy;
	for (raster::Polyline& p : shape)
		for (raster::Vec& v : p.points) v.x += dx, v.y += dy;
	const double sigma = s.blur / 2 * painter.m.scale();
	const int pad = sigma > 0 ? int(std::ceil(sigma * 3)) + 1 : 0;
	raster::Mask mask = coverage(shape, evenOdd, pad);
	if (sigma > 0) mask = raster::blur(mask, sigma);
	drawMask(mask, s.color);
}

// A rounded rectangle's blurred shadow, as Skia draws one. When the view only scales and the shape is
// big enough to stretch (`filterRRectToNine`: both corners of a side plus four blur margins
// fit inside it), a nine-part mask on whole pixels; otherwise the shape's own mask, blurred.
void shadowRRect(const double box[4], const double radii[4], const Shadow& s) {
	const double level = painter.m.scale(), sigma = s.blur / 2;
	if (s.blur > 0) {
		// How far Skia's blur reaches past the shape: a small Gaussian's own radius, or three boxes' together.
		const double deviceSigma = sigma * level;
		double margin;
		if (deviceSigma < 2) margin = std::ceil(3 * deviceSigma) - 1;
		else {
			const int window = int(std::floor(deviceSigma * 3 * std::sqrt(2 * M_PI) / 4 + 0.5));
			margin = window % 2 ? 3 * (window / 2) : 3 * (window / 2) - 1;
		}
		const double w = box[2] * level, h = box[3] * level;
		const double across = (std::max(radii[0], radii[3]) + std::max(radii[1], radii[2])) * level + 4 * margin;
		const double down = (std::max(radii[0], radii[1]) + std::max(radii[3], radii[2])) * level + 4 * margin;
		const bool mixed = !(radii[0] == radii[1] && radii[1] == radii[2] && radii[2] == radii[3]);
		if (mixed || across >= w || down >= h || painter.m.b != 0 || painter.m.c != 0) {
			blurredShape(rrectPath(box, radii), s);
			return;
		}
	}
	snapShadow = true;
	drawShape(box, radii, s.color, 4, 0, 1, sigma, s.dx, s.dy);
	snapShadow = false;
}

void paintPath(const Record& r, const double box[4]) {
	raster::Path path;
	if (r.sub == 0) {
		if (r.geometry.empty() || !geometryPath(r.geometry[0], box, path)) return;
	} else path = r.sub == 1 ? polygonPath(box, r.sides, r.polyRadius) : arcPath(box, r.inner, r.start, r.sweep);
	const bool evenOdd = r.evenOdd;
	const double lineWidth = r.stroke.on ? r.stroke.widths[0] : 0;
	const double level = painter.m.scale();
	Lines area;
	bool hasArea = false;
	auto fillLines = [&]() -> const Lines& {
		if (!hasArea) area = flat(path), hasArea = true;
		return area;
	};
	for (const Shadow& s : r.shadows) {
		// A shadow of what the path draws: its area, or its line when a path has only a stroke.
		const bool line = r.sub == 0 && !r.hasFill && lineWidth > 0;
		double alpha = 1;
		bool hair = false;
		Lines shape = line ? outline(path, lineWidth, 0, 0, {}, &alpha, &hair) : fillLines();
		const double dx = painter.m.a * s.dx + painter.m.c * s.dy, dy = painter.m.b * s.dx + painter.m.d * s.dy;
		for (raster::Polyline& p : shape)
			for (raster::Vec& v : p.points) v.x += dx, v.y += dy;
		const double sigma = s.blur / 2 * level;
		const int pad = sigma > 0 ? int(std::ceil(sigma * 3)) + 1 : 0;
		raster::Mask mask = coverage(shape, line ? false : evenOdd, pad, !hair);
		if (sigma > 0) mask = raster::blur(mask, sigma);
		drawMask(mask, Rgba{s.color.r, s.color.g, s.color.b, float(s.color.a * alpha)});
	}
	if (!r.fills.empty()) {
		const raster::Mask mask = coverage(fillLines(), evenOdd);
		for (const Rgba& fill : r.fills) drawMask(mask, fill);
	}
	if (!r.stroke.on) return;
	const Stroke& s = r.stroke;
	if (r.arrow) {
		// An arrow's line is centred, and when dashed only its first subpath is: the heads stay solid.
		if (r.arrowDash && r.geometry.size() >= 3) {
			const double w = s.widths[0];
			for (size_t i = 1; i < 3; i++) {
				raster::Path part;
				if (!geometryPath(r.geometry[i], box, part)) continue;
				strokePath(part, false, w, 1, r.cap, r.join, i == 1 ? std::vector<double>{w * 3, w * 2.5} : std::vector<double>{}, s.color);
			}
			return;
		}
		strokePath(path, evenOdd, s.widths[0], 1, r.cap, r.join, {}, s.color);
		return;
	}
	strokePath(path, evenOdd, s.widths[0], s.align, r.cap, r.join, r.dash, s.color);
}

// --- items -------------------------------------------------------------------------------------------

void paintChildren(int handle);

// The app's two-layer shadow for the scheme, as `paintCardPaper` and the note card draw it.
void appShadows(const double box[4], const double radii[4]) {
	struct Layer { double y, blur, alpha; };
	static const Layer light[2] = {{1, 2, 0.06}, {4, 12, 0.05}};
	static const Layer darkLayers[2] = {{1, 2, 0.4}, {6, 18, 0.3}};
	for (const Layer& layer : dark ? darkLayers : light) shadowRRect(box, radii, Shadow{Rgba{0, 0, 0, float(layer.alpha)}, layer.blur, 0, layer.y});
}
raster::Path rrectPath(const double box[4], const double radii[4]);
void strokePath(const raster::Path& path, bool evenOdd, double width, int align, int cap, int join, const std::vector<double>& dash, Rgba color);
// A radius too big for its box, made smaller as Skia's `setRectXY` does: by the one factor that fits it.
double fitted(double radius, double w, double h) {
	if (radius <= 0) return 0;
	return radius * std::min({1.0, w / (radius * 2), h / (radius * 2)});
}
// The hairline edge outside the box, as a CSS outline is: one unit wide, so drawn as Skia's hairline
// once a unit is a pixel or less.
void hairline(const double box[4], double radius) {
	const double outer[4] = {box[0] - 0.5, box[1] - 0.5, box[2] + 1, box[3] + 1};
	const double r = fitted(radius + 0.5, outer[2], outer[3]);
	const double radii[4] = {r, r, r, r};
	const Rgba color = dark ? Rgba{1, 1, 1, 0.12f} : Rgba{0, 0, 0, 0.1f};
	if (painter.m.scale() <= 1) strokePath(rrectPath(outer, radii), false, 1, 1, 0, 0, {}, color);
	else drawShape(outer, radii, color, 1, 1, 1);
}

void paintStroke(const Record& r, const double box[4], const double radii[4], bool ellipse) {
	const Stroke& s = r.stroke;
	if (!s.on) return;
	const bool uniform = s.widths[0] == s.widths[1] && s.widths[1] == s.widths[2] && s.widths[2] == s.widths[3];
	// An ellipse's stroke goes through the path stroker too: the shader's distance to an ellipse is an
	// estimate, which a thin line shows.
	// So does a stroke thin enough to be a hairline (doubled when it is cut to one side, as `paintAligned` does).
	const double device = s.widths[0] * (s.align == 1 ? 1 : 2) * painter.m.scale();
	// And a square corner with a bevelled or round join, which the shader would leave square.
	const bool squareCorner = !ellipse && r.join != 0 && (radii[0] <= 0 || radii[1] <= 0 || radii[2] <= 0 || radii[3] <= 0);
	if (uniform && (!r.dash.empty() || ellipse || device <= 1 || squareCorner)) {
		strokePath(ellipse ? ovalPath(box) : rrectPath(box, radii), false, s.widths[0], s.align, r.cap, r.join, r.dash, s.color);
		return;
	}
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
	// Not left bound: a draw into the layer whose sampler could read it is refused as a feedback loop.
	glBindTexture(GL_TEXTURE_2D, 0);
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
	glBindTexture(GL_TEXTURE_2D, 0);
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
			for (const Shadow& s : r.shadows) shadowRRect(box, radii, s);
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
			// A blurred ellipse is the blurred mask of the ellipse: the distance to it is no blur of a flat one.
			for (const Shadow& s : r.shadows) {
				if (s.blur > 0) blurredShape(ovalPath(box), s);
				else drawShape(box, none, s.color, 6, 0, 1, 0, s.dx, s.dy);
			}
			for (const Rgba& fill : r.fills) drawShape(box, none, fill, 2);
			paintStroke(r, box, none, true);
			break;
		}
		case K_PATH:
			paintPath(r, box);
			break;
		case K_NOTE: {
			const double r12 = fitted(12, box[2], box[3]);
			const double round[4] = {r12, r12, r12, r12};
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
	if (r.kind == K_RECT || r.kind == K_ELLIPSE || r.kind == K_NOTE || r.kind == K_PATH) {
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
		r.cap = int(next());
		r.join = int(next());
		const int dashes = int(next());
		for (int i = 0; i < dashes; i++) r.dash.push_back(next());
	}
	if (r.kind == K_PATH) {
		r.sub = int(next());
		r.evenOdd = next() != 0;
		r.sides = std::max(3, int(next()));
		r.polyRadius = next();
		r.inner = next();
		r.start = next();
		r.sweep = next();
		r.arrow = next() != 0;
		r.arrowDash = next() != 0;
		r.hasFill = next() != 0;
		const int geometries = int(next());
		for (int i = 0; i < geometries; i++) {
			Geometry g;
			for (double& v : g.vb) v = next();
			const int chars = int(next());
			g.d.reserve(size_t(std::max(0, chars)));
			for (int k = 0; k < chars; k++) g.d.push_back(char(next()));
			r.geometry.push_back(std::move(g));
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
