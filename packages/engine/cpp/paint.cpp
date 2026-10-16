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

#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_OUTLINE_H
#include FT_BITMAP_H
#include FT_TRUETYPE_TABLES_H
#include <hb.h>

#include <unordered_map>

#include "card.h"
#include "raster.h"
#include "text.h"

// The scene's items and their boxes (`scene.cpp`).
struct PaintBox { double x, y, w, h; bool placed; };
int sceneRoots(const int** out);
int sceneChildren(int handle, const int** out);
PaintBox sceneBox(int handle);
bool sceneCard(int handle, const double** nums, size_t* count, const char** pool);

namespace {

// --- what the page sends for an item ---------------------------------------------------------------

struct Rgba { float r, g, b, a; };
// A gradient fill, as `gradientShader` places it in an item's box: linear (0), radial (1) or sweep (2),
// its centre and size as fractions of the box, its turn in degrees, and its stops. kind -1 is none.
struct Grad {
	int kind = -1;  // 3: a picture
	int image = -1, mode = 0;  // a picture's texture (`paint_image`), and how it fills the box: cover, fit, stretch
	bool nearest = false;      // sampled at the nearest pixel, as CanvasKit's `drawImageRect` samples a card's picture
	double cx = 0.5, cy = 0.5, sw = 1, sh = 1, rotation = 0;
	std::vector<Rgba> colors;
	std::vector<float> at;
};
struct Shadow { Rgba color; double blur, dx, dy; };
struct Stroke {
	bool on = false;
	Rgba color{0, 0, 0, 0};
	Grad grad;
	double widths[4] = {0, 0, 0, 0};  // top, right, bottom, left
	int align = 1;                    // 0 inside, 1 centred, 2 outside
};
enum Kind : int { K_NONE = 0, K_RECT = 1, K_ELLIPSE = 2, K_PATH = 3, K_NOTE = 6, K_GROUP = 7, K_TEXT = 8, K_OPS = 9, K_UNSUPPORTED = 99 };
// Words to set in an item (a text, or a note's): `paint.ts`'s `paintText`.
struct Words {
	bool on = false, markdown = false;  // markdown: drawn from the item's card (`card.cpp`)
	std::string text, chain;  // UTF-8, and the family chain one name a line
	double pad = 0, size = 14, letterSpacing = 0, lineHeight = NAN;
	int weight = 400, align = 0, vertical = 0;  // align: left, right, centre; vertical: top, middle, bottom
	bool italic = false, underline = false, strike = false, grow = false;  // grow: a text that sizes to its words
	Rgba color{0, 0, 0, 1};
};
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
	std::vector<Grad> fillGrads;  // beside each fill: its gradient, or none
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
	Words words;
	// What the page reduced the rest of the item to (`paint-wire.ts`, `ops`): drawn after it, in its place.
	std::vector<double> ops;
};
// The page's drawing ops for the stroke still under the pen, in stage pixels, over everything (`paint_overlay`).
std::vector<double> overlay;
std::vector<Record> records;
std::vector<char> skipped, holes, muted;
// How far each card's wide tables are scrolled sideways, by item and table (`paint_scroll`).
std::unordered_map<int, std::vector<double>> scrolls;
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
uniform int uPaintKind;        // 0 the colour; 1 linear, 2 radial, 3 sweep gradient; 4 a picture
uniform sampler2D uImage;      // kind 4: the picture, premultiplied
uniform mat3 uImageMatrix;     // kind 4: the item's space to the picture's (0 to 1 across it)
uniform int uImageDecal;       // kind 4: transparent outside the picture, rather than its edge repeated
uniform mat3 uPaintMatrix;     // tile pixels to the item's space
uniform vec4 uGrad;            // linear: its two ends; radial: centre, radius, height over width; sweep: centre
uniform vec4 uStopColor[16];
uniform float uStopAt[16];
uniform int uStopCount;
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

// The paint at this pixel: the colour, or a gradient's, interpolated between its stops unpremultiplied
// and clamped at its ends, as Skia's gradients are.
vec4 paintAt() {
	if (uPaintKind == 0) return uColor;
	vec2 q = (uPaintMatrix * vec3(gl_FragCoord.x, gl_FragCoord.y, 1.0)).xy;
	if (uPaintKind == 4) {
		vec2 uv = (uImageMatrix * vec3(q, 1.0)).xy;
		vec4 p = texture(uImage, uv);
		vec4 straight = p.a > 0.0 ? vec4(p.rgb / p.a, p.a) : vec4(0.0);
		if (uImageDecal == 1) {
			// Transparent past the edge, with the edge filtered against it as Skia's decal mode filters it:
			// half a texel either side of the edge fades to nothing. Skia fades an opaque picture's colour
			// as well as its alpha there, so its edge darkens as it fades; so does this.
			vec2 size = vec2(textureSize(uImage, 0));
			vec2 inside = clamp(uv * size + 0.5, 0.0, 1.0) * clamp((1.0 - uv) * size + 0.5, 0.0, 1.0);
			float f = inside.x * inside.y;
			straight = vec4(straight.rgb * f, straight.a * f);
		}
		return vec4(straight.rgb, straight.a * uColor.a);
	}
	float t;
	if (uPaintKind == 1) {
		vec2 d = uGrad.zw - uGrad.xy;
		t = dot(q - uGrad.xy, d) / dot(d, d);
	} else if (uPaintKind == 2) {
		vec2 v = vec2(q.x - uGrad.x, (q.y - uGrad.y) / uGrad.w);
		t = length(v) / uGrad.z;
	} else {
		vec2 v = q - uGrad.xy;
		t = atan(v.y, v.x) / 6.28318530718;
		if (t < 0.0) t += 1.0;
	}
	t = clamp(t, 0.0, 1.0);
	vec4 c = uStopColor[0];
	if (t > uStopAt[0]) {
		for (int i = 1; i < 16; i++) {
			if (i >= uStopCount) break;
			if (t <= uStopAt[i]) {
				float span = uStopAt[i] - uStopAt[i - 1];
				c = mix(uStopColor[i - 1], uStopColor[i], span > 0.0 ? (t - uStopAt[i - 1]) / span : 1.0);
				break;
			}
			c = uStopColor[i];
		}
	}
	return vec4(c.rgb, c.a * uColor.a);
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
	vec4 col = paintAt();
	float a = col.a * c;
	outColor = vec4(col.rgb * a, a);
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
// Pictures handed over by the page (`paint_image`): a texture the page made in this context, and its size.
struct Picture { GLuint texture; int w, h; };
std::unordered_map<int, Picture> pictures;
// The gradient the next draws are filled with, and the box it is placed in (`Using`).
const Grad* activeGrad = nullptr;
double activeBox[4] = {0, 0, 0, 0};
struct Using {
	Using(const Grad& g, const double box[4]) {
		if (g.kind < 0) return;
		activeGrad = &g;
		for (int i = 0; i < 4; i++) activeBox[i] = box[i];
	}
	~Using() { activeGrad = nullptr; }
};
// Why the last tile was refused, for tallying what the painter still lacks (`paint_why`).
const char* whyNot = "";
void refuse(const char* why) {
	painter.supported = false;
	whyNot = why;
}

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
	if (painter.clips.size() > 4) refuse("more than four clips");
	// The paint: the colour, or the gradient placed in its box as `gradientShader` places it.
	if (!activeGrad) glUniform1i(glGetUniformLocation(program, "uPaintKind"), 0);
	else {
		const Grad& g = *activeGrad;
		const double bx = activeBox[0], by = activeBox[1], bw = activeBox[2], bh = activeBox[3];
		const double cx = bx + bw * g.cx, cy = by + bh * g.cy, sw = bw * g.sw, sh = bh * g.sh;
		glUniform1i(glGetUniformLocation(program, "uPaintKind"), g.kind + 1);
		if (g.kind == 3) {
			// A picture placed as `fillPaint` places one: covering the box, fitted inside it, or stretched to it,
			// centred. Card pictures are drawn into a box of their own size (`mode` stretch, sampled nearest).
			const auto found = pictures.find(g.image);
			const Picture pic = found != pictures.end() ? found->second : Picture{0, 1, 1};
			const double sx0 = bw / pic.w, sy0 = bh / pic.h;
			const double cover = std::max(sx0, sy0), contain = std::min(sx0, sy0);
			const double sx = g.mode == 2 ? sx0 : g.mode == 1 ? contain : cover, sy = g.mode == 2 ? sy0 : g.mode == 1 ? contain : cover;
			const double tx = bx + (bw - pic.w * sx) / 2, ty = by + (bh - pic.h * sy) / 2;
			// Item to picture: (x - tx) / sx pixels, over its width.
			const float im[9] = {float(1 / (sx * pic.w)), 0, 0, 0, float(1 / (sy * pic.h)), 0, float(-tx / (sx * pic.w)), float(-ty / (sy * pic.h)), 1};
			glUniformMatrix3fv(glGetUniformLocation(program, "uImageMatrix"), 1, GL_FALSE, im);
			glUniform1i(glGetUniformLocation(program, "uImageDecal"), g.mode == 1 ? 1 : 0);
			glActiveTexture(GL_TEXTURE1);
			glBindTexture(GL_TEXTURE_2D, pic.texture);
			glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, g.nearest ? GL_NEAREST : GL_LINEAR_MIPMAP_LINEAR);
			glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, g.nearest ? GL_NEAREST : GL_LINEAR);
			glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
			glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
			glUniform1i(glGetUniformLocation(program, "uImage"), 1);
			glActiveTexture(GL_TEXTURE0);
		} else if (g.kind == 0) {
			// 0 degrees points up, angles run counter-clockwise; the length is the size's height.
			const double rad = g.rotation * M_PI / 180, dx = -std::sin(rad), dy = -std::cos(rad), half = sh / 2;
			glUniform4f(glGetUniformLocation(program, "uGrad"), float(cx - dx * half), float(cy - dy * half), float(cx + dx * half), float(cy + dy * half));
		} else if (g.kind == 1) {
			glUniform4f(glGetUniformLocation(program, "uGrad"), float(cx), float(cy), float(std::max(1.0, sw / 2)), float(sh / std::max(1.0, sw)));
		} else glUniform4f(glGetUniformLocation(program, "uGrad"), float(cx), float(cy), 0, 0);
		Affine flip{1, 0, 0, -1, 0, double(tileH)};
		const Affine toItem = flip.then(painter.m.inverse());
		const float pm[9] = {float(toItem.a), float(toItem.b), 0, float(toItem.c), float(toItem.d), 0, float(toItem.e), float(toItem.f), 1};
		glUniformMatrix3fv(glGetUniformLocation(program, "uPaintMatrix"), 1, GL_FALSE, pm);
		const int n = std::min<int>(16, int(g.colors.size()));
		std::vector<float> cols, ats;
		for (int i = 0; i < n; i++) cols.insert(cols.end(), {g.colors[size_t(i)].r, g.colors[size_t(i)].g, g.colors[size_t(i)].b, g.colors[size_t(i)].a}), ats.push_back(g.at[size_t(i)]);
		glUniform4fv(glGetUniformLocation(program, "uStopColor"), n, cols.data());
		glUniform1fv(glGetUniformLocation(program, "uStopAt"), n, ats.data());
		glUniform1i(glGetUniformLocation(program, "uStopCount"), n);
	}
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
	if (mode == 4 && sigma > 0 && snapShadow) {
		// The box's corners in the tile, rounded out to whole pixels, and back: with a view that keeps
		// rectangles upright (a mirror or a right-angle turn included) that is still a box.
		const Affine& m = painter.m;
		double xs[4], ys[4];
		const double cx[4] = {shape[0], shape[0] + shape[2], shape[0], shape[0] + shape[2]}, cy[4] = {shape[1], shape[1], shape[1] + shape[3], shape[1] + shape[3]};
		for (int k = 0; k < 4; k++) xs[k] = m.a * cx[k] + m.c * cy[k] + m.e, ys[k] = m.b * cx[k] + m.d * cy[k] + m.f;
		const double l = std::floor(*std::min_element(xs, xs + 4) + 1e-6), r = std::ceil(*std::max_element(xs, xs + 4) - 1e-6);
		const double t = std::floor(*std::min_element(ys, ys + 4) + 1e-6), b = std::ceil(*std::max_element(ys, ys + 4) - 1e-6);
		const Affine inv = m.inverse();
		const double p0x = inv.a * l + inv.c * t + inv.e, p0y = inv.b * l + inv.d * t + inv.f;
		const double p1x = inv.a * r + inv.c * b + inv.e, p1y = inv.b * r + inv.d * b + inv.f;
		shape[0] = std::min(p0x, p1x), shape[1] = std::min(p0y, p1y), shape[2] = std::fabs(p1x - p0x), shape[3] = std::fabs(p1y - p0y);
	}
	const double quad[4] = {shape[0] - grow, shape[1] - grow, shape[2] + grow * 2, shape[3] + grow * 2};
	setUniforms(painter.m, quad, shape, radii, color, mode, strokeWidth, align, sigma);
	drawQuad();
}

// A radius too big for its box, made smaller as Skia's `setRectXY` does: by the one factor that fits it.
double fitted(double radius, double w, double h) {
	if (radius <= 0) return 0;
	return radius * std::min({1.0, w / (radius * 2), h / (radius * 2)});
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
		// Its size in the tile: a right-angle turn swaps width and height.
		const bool turned = painter.m.a == 0 && painter.m.d == 0;
		const double w = (turned ? box[3] : box[2]) * level, h = (turned ? box[2] : box[3]) * level;
		const double across = (std::max(radii[0], radii[3]) + std::max(radii[1], radii[2])) * level + 4 * margin;
		const double down = (std::max(radii[0], radii[1]) + std::max(radii[3], radii[2])) * level + 4 * margin;
		const bool mixed = !(radii[0] == radii[1] && radii[1] == radii[2] && radii[2] == radii[3]);
		const bool upright = (painter.m.b == 0 && painter.m.c == 0) || turned;
		if (mixed || across >= w || down >= h || !upright) {
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
		for (size_t i = 0; i < r.fills.size(); i++) {
			Using u(r.fillGrads[i], box);
			drawMask(mask, r.fills[i]);
		}
	}
	if (!r.stroke.on) return;
	Using strokePaint(r.stroke.grad, box);
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
	const bool uniform = s.widths[0] == s.widths[1] && s.widths[1] == s.widths[2] && s.widths[2] == s.widths[3];
	if (!uniform && r.sub != 0) {
		// Per side, as `paintStroke` draws it: a bar along each edge of the box, inside it, each cut by the shape.
		const raster::Mask inside = coverage(flat(path), evenOdd);
		const double x = box[0], y = box[1], w = box[2], h = box[3];
		const double bars[4][4] = {{x, y, w, s.widths[0]}, {x, y + h - s.widths[2], w, s.widths[2]}, {x, y, s.widths[3], h}, {x + w - s.widths[1], y, s.widths[1], h}};
		for (const auto& b : bars) {
			if (b[2] <= 0 || b[3] <= 0) continue;
			raster::Path bar;
			bar.moveTo({b[0], b[1]});
			bar.lineTo({b[0] + b[2], b[1]});
			bar.lineTo({b[0] + b[2], b[1] + b[3]});
			bar.lineTo({b[0], b[1] + b[3]});
			bar.close();
			drawMask(raster::combine(coverage(flat(bar), false), inside, true), s.color);
		}
		return;
	}
	strokePath(path, evenOdd, s.widths[0], s.align, r.cap, r.join, r.dash, s.color);
}

// --- words -------------------------------------------------------------------------------------------
//
// Each glyph is drawn as Skia draws text with CanvasKit's FreeType: its outline at the size it is drawn
// in the tile, scaled as FreeType scales (to 64ths of a pixel), unhinted, at a quarter-pixel step across
// and a whole pixel down, and filled with exact coverage. Masks are kept by face, glyph, size and step,
// and a text's glyphs are laid over one another into one mask for its colour.

// A glyph as drawn: its face and number, the matrix it is drawn through (its size, any turn, mirror or
// slant, each to a 1/4096), its quarter-pixel steps across and down, and whether it is hinted or thickened.
struct GlyphKey {
	int face;
	uint32_t id;
	int m[4];
	int stepX, stepY;
	bool hinted, bold;
	bool operator==(const GlyphKey& o) const { return face == o.face && id == o.id && m[0] == o.m[0] && m[1] == o.m[1] && m[2] == o.m[2] && m[3] == o.m[3] && stepX == o.stepX && stepY == o.stepY && hinted == o.hinted && bold == o.bold; }
};
struct GlyphKeyHash {
	size_t operator()(const GlyphKey& k) const {
		size_t h = size_t(k.face) * 1000003u ^ size_t(k.id) * 9176u;
		for (int v : k.m) h = h * 31u ^ size_t(v);
		return h ^ size_t(k.stepX) << 20 ^ size_t(k.stepY) << 22 ^ (k.hinted ? 1u << 24 : 0) ^ (k.bold ? 1u << 25 : 0);
	}
};
std::unordered_map<GlyphKey, raster::Mask, GlyphKeyHash> glyphMasks;

// FreeType, as CanvasKit's text draws with it: each face opened once from the bytes the text code holds.
FT_Library ftLibrary = nullptr;
std::vector<FT_Face> ftFaces;
FT_Face ftFace(int face) {
	if (!ftLibrary && FT_Init_FreeType(&ftLibrary)) return nullptr;
	if (size_t(face) >= ftFaces.size()) ftFaces.resize(size_t(face) + 1, nullptr);
	if (!ftFaces[size_t(face)]) {
		size_t length = 0;
		const char* bytes = faceBytes(face, &length);
		if (!bytes || FT_New_Memory_Face(ftLibrary, reinterpret_cast<const FT_Byte*>(bytes), FT_Long(length), 0, &ftFaces[size_t(face)])) return nullptr;
	}
	return ftFaces[size_t(face)];
}

/*
 * A glyph's coverage as Skia's FreeType scaler makes it (`SkScalerContext_FreeType::generateImage`):
 * the size to FreeType in 64ths cut down, loaded with light hinting (the auto-hinter, heights only),
 * moved right by its quarter-pixel step, and filled by FreeType's smooth rasteriser. The mask's corner
 * is where its first pixel sits from the glyph's origin, y down.
 */
// A style the face lacks is faked as Skia's paragraph fakes it: italic slanted by a quarter
// (`setSkewX(-1/4)`), bold thickened by FreeType's emboldening at a 24th of the em.
/*
 * A glyph's coverage as Skia's FreeType scaler makes it (`SkScalerContext_FreeType::generateImage`).
 * `A` is the whole matrix it is drawn through, y down (x' = A0 x + A2 y, y' = A1 x + A3 y), its size
 * included: split as Skia splits it (`computeMatrices`, full pre-scale) into a size for FreeType, in
 * 64ths cut down, and what is left (a turn, a mirror, a slant) for FreeType's transform. Hinted lightly
 * (the auto-hinter, heights only) when the matrix keeps rectangles upright; moved by its quarter-pixel
 * steps; filled by FreeType's smooth rasteriser. The mask's corner is where its first pixel sits from
 * the glyph's origin.
 */
const raster::Mask& glyphMask(int face, uint32_t id, const double A[4], int stepX, int stepY, bool hinted, bool bold, bool* drawable) {
	const GlyphKey key{face, id, {int(std::lround(A[0] * 4096)), int(std::lround(A[1] * 4096)), int(std::lround(A[2] * 4096)), int(std::lround(A[3] * 4096))}, stepX, stepY, hinted, bold};
	auto found = glyphMasks.find(key);
	if (found != glyphMasks.end()) return found->second;
	raster::Mask& mask = glyphMasks[key];
	FT_Face f = ftFace(face);
	if (!f) return mask;
	// The scale: where the baseline goes, its length, and the height left once it is turned level (a Givens rotation).
	double sx, sy, r[4];
	const bool skewedOrFlipped = A[1] != 0 || A[2] != 0 || A[0] < 0 || A[3] < 0;
	if (skewedOrFlipped) {
		const double hx = A[0], hy = A[1], len = std::hypot(hx, hy);
		const double cs = len > 0 ? hx / len : 1, sn = len > 0 ? hy / len : 0;
		// G A, with G turning the baseline level: its first column is (len, 0).
		const double ga0 = cs * A[0] + sn * A[1], ga3 = -sn * A[2] + cs * A[3];
		sx = std::fabs(ga0), sy = std::fabs(ga3);
	} else sx = std::fabs(A[0]), sy = std::fabs(A[3]);
	if (sx <= 0 || sy <= 0) return mask;
	r[0] = A[0] / sx, r[1] = A[1] / sx, r[2] = A[2] / sy, r[3] = A[3] / sy;
	if (FT_Set_Char_Size(f, FT_F26Dot6(sx * 64), FT_F26Dot6(sy * 64), 72, 72)) return mask;
	// FreeType's y goes up: the matrix's off-diagonal entries change sign.
	FT_Matrix rest{FT_Fixed(std::lround(r[0] * 65536)), FT_Fixed(std::lround(-r[2] * 65536)), FT_Fixed(std::lround(-r[1] * 65536)), FT_Fixed(std::lround(r[3] * 65536))};
	const bool identity = !skewedOrFlipped;
	FT_Set_Transform(f, identity ? nullptr : &rest, nullptr);
	const FT_Error failed = FT_Load_Glyph(f, id, (hinted ? FT_LOAD_TARGET_LIGHT : FT_LOAD_NO_HINTING) | FT_LOAD_NO_BITMAP | FT_LOAD_IGNORE_GLOBAL_ADVANCE_WIDTH);
	FT_Set_Transform(f, nullptr, nullptr);
	if (failed || f->glyph->format != FT_GLYPH_FORMAT_OUTLINE) {
		*drawable = false;
		glyphMasks.erase(key);
		static const raster::Mask none;
		return none;
	}
	FT_Outline* outline = &f->glyph->outline;
	if (bold) {
		// Thickened by a 24th of the em, then moved back by half of it, so it grows about its middle.
		const FT_Pos strength = FT_MulFix(f->units_per_EM, f->size->metrics.y_scale) / 24;
		FT_Outline_Embolden(outline, strength);
		FT_Outline_Translate(outline, -strength / 2, -strength / 2);
	}
	FT_Outline_Translate(outline, stepX * 16, -stepY * 16);
	FT_BBox box;
	FT_Outline_Get_CBox(outline, &box);
	const long left = box.xMin >> 6, right = (box.xMax + 63) >> 6, bottom = box.yMin >> 6, top = (box.yMax + 63) >> 6;
	if (right <= left || top <= bottom) return mask;
	mask.x = int(left);
	mask.y = int(-top);
	mask.w = int(right - left);
	mask.h = int(top - bottom);
	mask.a.assign(size_t(mask.w) * size_t(mask.h), 0);
	FT_Bitmap target;
	FT_Bitmap_Init(&target);
	target.width = unsigned(mask.w);
	target.rows = unsigned(mask.h);
	target.pitch = mask.w;
	target.buffer = mask.a.data();
	target.pixel_mode = FT_PIXEL_MODE_GRAY;
	target.num_grays = 256;
	FT_Outline_Translate(outline, -left * 64, -bottom * 64);
	FT_Outline_Get_Bitmap(ftLibrary, outline, &target);
	return mask;
}

/*
 * A colour glyph, an emoji's picture: the font's own bitmap at its largest size, as a texture with
 * smaller copies, since it is drawn at a fraction of that size. Its box is in ems from the pen's spot
 * on the baseline (y down), so a glyph at any size is that box times the size. Kept by face and glyph.
 */
struct ColourGlyph { int picture; double left, top, w, h; };
std::unordered_map<uint64_t, ColourGlyph> colourGlyphs;
int nextColourPicture = -1;  // below zero: the page's own pictures count up from zero

bool colourGlyph(int face, uint32_t id, ColourGlyph* out) {
	const uint64_t key = (uint64_t(uint32_t(face)) << 32) | id;
	if (auto hit = colourGlyphs.find(key); hit != colourGlyphs.end()) {
		*out = hit->second;
		return hit->second.picture != 0;
	}
	ColourGlyph none{0, 0, 0, 0, 0};
	colourGlyphs[key] = none;
	FT_Face f = ftFace(face);
	if (!f || !FT_HAS_COLOR(f) || f->num_fixed_sizes <= 0) return false;
	int best = 0;
	for (int i = 1; i < f->num_fixed_sizes; i++)
		if (f->available_sizes[i].height > f->available_sizes[best].height) best = i;
	if (FT_Select_Size(f, best) || FT_Load_Glyph(f, id, FT_LOAD_COLOR)) return false;
	const FT_GlyphSlot slot = f->glyph;
	const FT_Bitmap& b = slot->bitmap;
	if (slot->format != FT_GLYPH_FORMAT_BITMAP || b.pixel_mode != FT_PIXEL_MODE_BGRA || b.width == 0 || b.rows == 0) return false;
	const double ppem = f->size->metrics.y_ppem > 0 ? double(f->size->metrics.y_ppem) : double(f->available_sizes[best].height);
	// FreeType's BGRA, premultiplied, to the RGBA a texture takes.
	std::vector<uint8_t> rgba(size_t(b.width) * b.rows * 4);
	for (unsigned y = 0; y < b.rows; y++)
		for (unsigned x = 0; x < b.width; x++) {
			const uint8_t* p = b.buffer + long(y) * b.pitch + x * 4;
			uint8_t* q = &rgba[(size_t(y) * b.width + x) * 4];
			q[0] = p[2], q[1] = p[1], q[2] = p[0], q[3] = p[3];
		}
	GLuint tex = 0;
	glGenTextures(1, &tex);
	glActiveTexture(GL_TEXTURE1);
	glBindTexture(GL_TEXTURE_2D, tex);
	glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
	glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, int(b.width), int(b.rows), 0, GL_RGBA, GL_UNSIGNED_BYTE, rgba.data());
	glGenerateMipmap(GL_TEXTURE_2D);
	glBindTexture(GL_TEXTURE_2D, 0);
	glActiveTexture(GL_TEXTURE0);
	const int picture = nextColourPicture--;
	pictures[picture] = Picture{tex, int(b.width), int(b.rows)};
	const ColourGlyph made{picture, slot->bitmap_left / ppem, -slot->bitmap_top / ppem, b.width / ppem, b.rows / ppem};
	colourGlyphs[key] = made;
	*out = made;
	return true;
}

/*
 * Skia's text gamma (`SkTMaskGamma`, as CanvasKit is built: contrast 0.5, the paint's and the device's
 * gamma both sRGB's curve): eight tables, one for each eighth of the text colour's luminance, that make
 * a glyph's edge coverage darker for light text and lighter for dark, so it reads as the same weight.
 */
const uint8_t* gammaTable(Rgba color) {
	static uint8_t tables[8][256];
	static bool built = false;
	if (!built) {
		auto toLuma = [](float x) { return x <= 0.04045f ? x / 12.92f : std::pow((x + 0.055f) / 1.055f, 2.4f); };
		auto fromLuma = [](float x) { return x <= 0.0031308f ? x * 12.92f : 1.055f * std::pow(x, 1.0f / 2.4f) - 0.055f; };
		for (int i = 0; i < 8; i++) {
			const int lum = (i << 5) | (i << 2) | (i >> 1);
			const float src = float(lum) / 255.0f, dst = 1.0f - src;
			const float linSrc = toLuma(src), linDst = toLuma(dst);
			const float contrast = 0.5f * linDst;
			for (int k = 0; k < 256; k++) {
				const float raw = float(k) / 255.0f;
				const float a = raw + ((1.0f - raw) * contrast * raw);
				if (std::fabs(src - dst) < 1.0f / 256.0f) tables[i][k] = uint8_t(std::floor(255.0f * a + 0.5f));
				else {
					const float out = fromLuma(linSrc * a + (1.0f - a) * linDst);
					tables[i][k] = uint8_t(std::clamp(int(std::floor(255.0f * (out - dst) / (src - dst) + 0.5f)), 0, 255));
				}
			}
		}
		built = true;
	}
	// The colour's luminance as Skia takes it (`SkComputeLuminance`), on 8-bit channels.
	auto byte = [](float v) { return int(std::lround(std::clamp(v, 0.f, 1.f) * 255)); };
	const int lum = (byte(color.r) * 54 + byte(color.g) * 183 + byte(color.b) * 19) >> 8;
	return tables[lum >> 5];
}

// A face's lines as Skia's FreeType reads them (`getFontMetrics`), per unit of size: underline
// position (down from the baseline, to its middle) and thickness, strikeout position and thickness.
void lineMetrics(int face, double out[4]) {
	FT_Face f = ftFace(face);
	if (!f || !f->units_per_EM) {
		out[0] = 0.1, out[1] = 1.0 / 14, out[2] = -0.25, out[3] = 1.0 / 14;
		return;
	}
	const double upem = f->units_per_EM;
	out[0] = -double(f->underline_position + f->underline_thickness / 2) / upem;
	out[1] = double(f->underline_thickness) / upem;
	const TT_OS2* os2 = static_cast<const TT_OS2*>(FT_Get_Sfnt_Table(f, FT_SFNT_OS2));
	out[2] = os2 ? -double(os2->yStrikeoutPosition) / upem : NAN;
	out[3] = os2 ? double(os2->yStrikeoutSize) / upem : NAN;
}

int spanWeight(const std::vector<Span>& spans, int span) { return span >= 0 && size_t(span) < spans.size() ? spans[size_t(span)].weight : 400; }
bool spanItalic(const std::vector<Span>& spans, int span) { return span >= 0 && size_t(span) < spans.size() && spans[size_t(span)].italic; }

// A paint's colour where an alpha below zero means the block's own.
Rgba resolved(const CardColour& c, Rgba own) { return c.a < 0 ? own : Rgba{c.r, c.g, c.b, c.a}; }

/*
 * A paragraph of styled runs drawn as Skia's paragraph draws it, line by line: each run's background
 * (a rectangle as tall as the line, without anti-aliasing), its glyphs in its colour, then its lines
 * under or through it at the font's own position and thickness.
 */
void paintParagraph(const std::string& text, const std::vector<Span>& spans, const Span& base, double lineHeight, double width, int align, const std::vector<CardRunPaint>& paints, Rgba own, double ox, double oy, double* heightOut = nullptr) {
	const Affine& m = painter.m;
	// Positions step by quarter pixels along the axes the baseline keeps to (`SkComputeAxisAlignmentForHText`):
	// across for level words, down for words turned a right angle, both for any other turn.
	const bool level = m.b == 0, upright = m.a == 0 && !level;
	for (const Span& sp : spans)
		if (sp.chain.empty()) {
			refuse("words with no font");
			return;
		}
	std::vector<PlacedGlyph> glyphs;
	std::vector<PlacedLine> lines;
	std::vector<PlacedPiece> pieces;
	double out[4];
	placeGlyphs(text.data(), int(text.size()), spans, base, lineHeight, width, align, glyphs, lines, out, &pieces);
	if (heightOut) *heightOut = out[2];
	auto paintOf = [&](int span) -> const CardRunPaint& {
		static CardRunPaint none;
		return span >= 0 && size_t(span) < paints.size() ? paints[size_t(span)] : none;
	};
	// Backgrounds: rectangles rounded to whole pixels, as a paint without anti-aliasing fills one.
	for (const PlacedPiece& p : pieces) {
		const CardRunPaint& pp = paintOf(p.span);
		if (pp.back.a <= 0) continue;
		if (m.b != 0 || m.c != 0 || m.a < 0 || m.d < 0) {
			// Turned or mirrored: the rectangle through the view, filled (Skia fills it without anti-aliasing).
			raster::Path rect;
			rect.moveTo({ox + p.x0, oy + p.top});
			rect.lineTo({ox + p.x1, oy + p.top});
			rect.lineTo({ox + p.x1, oy + p.top + p.height});
			rect.lineTo({ox + p.x0, oy + p.top + p.height});
			rect.close();
			drawMask(coverage(flat(rect), false), Rgba{pp.back.r, pp.back.g, pp.back.b, pp.back.a});
			continue;
		}
		const double l = std::floor(m.a * (ox + p.x0) + m.e + 0.5), r = std::floor(m.a * (ox + p.x1) + m.e + 0.5);
		const double t = std::floor(m.d * (oy + p.top) + m.f + 0.5), b = std::floor(m.d * (oy + p.top + p.height) + m.f + 0.5);
		raster::Mask rect;
		rect.x = int(std::max(l, 0.0)), rect.y = int(std::max(t, 0.0));
		rect.w = int(std::min(r, double(tileW))) - rect.x, rect.h = int(std::min(b, double(tileH))) - rect.y;
		if (rect.w <= 0 || rect.h <= 0) continue;
		rect.a.assign(size_t(rect.w) * size_t(rect.h), 255);
		drawMask(rect, Rgba{pp.back.r, pp.back.g, pp.back.b, pp.back.a});
	}
	// Glyphs, by colour, each colour's laid over one another into one mask, as Skia blends each glyph's own.
	struct Ink { Rgba colour; std::vector<std::pair<const raster::Mask*, std::pair<int, int>>> placed; };
	std::vector<Ink> inks;
	for (const PlacedGlyph& g : glyphs) {
		const Rgba colour = resolved(paintOf(g.span).ink, own);
		const double dx = m.a * (ox + g.x) + m.c * (oy + g.y) + m.e, dy = m.b * (ox + g.x) + m.d * (oy + g.y) + m.f;
		const double qx = upright ? std::floor(dx + 0.5) : std::floor((dx + 0.125) * 4) / 4;
		const double qy = level ? std::floor(dy + 0.5) : std::floor((dy + 0.125) * 4) / 4;
		const int ix = int(std::floor(qx)), iy = int(std::floor(qy));
		const int stepX = int((qx - ix) * 4), stepY = int((qy - iy) * 4);
		int faceWeight;
		bool faceItalic;
		faceStyle(g.face, &faceWeight, &faceItalic);
		const bool fakeBold = spanWeight(spans, g.span) >= 600 && spanWeight(spans, g.span) - faceWeight >= 200, fakeItalic = spanItalic(spans, g.span) && !faceItalic;
		// The glyph's whole matrix: the view's, its size, and the slant a faked italic adds (x - y / 4, y down).
		const double k = fakeItalic ? -0.25 : 0;
		const double A[4] = {m.a * g.size, m.b * g.size, (m.a * k + m.c) * g.size, (m.b * k + m.d) * g.size};
		const bool hinted = (A[1] == 0 && A[2] == 0) || (A[0] == 0 && A[3] == 0);
		bool drawable = true;
		// A face of colour pictures (an emoji font) has no outlines to draw: FreeType loads its glyphs as empty ones.
		FT_Face pictured = ftFace(g.face);
		const bool colourFace = pictured && FT_HAS_COLOR(pictured) && FT_HAS_FIXED_SIZES(pictured) && !FT_IS_SCALABLE(pictured);
		static const raster::Mask nothing;
		const raster::Mask& mask = colourFace ? nothing : glyphMask(g.face, g.id, A, stepX, stepY, hinted, fakeBold, &drawable);
		if (colourFace || !drawable) {
			// A glyph with no outline: a colour emoji's picture, drawn as a picture at the glyph's place.
			ColourGlyph picture;
			if (!colourGlyph(g.face, g.id, &picture)) {
				refuse("a glyph with no outline and no picture");
				return;
			}
			const double box[4] = {ox + g.x + picture.left * g.size, oy + g.y + picture.top * g.size, picture.w * g.size, picture.h * g.size};
			const double none[4] = {0, 0, 0, 0};
			Grad fill;
			fill.kind = 3;
			fill.image = picture.picture;
			fill.mode = 2;
			Using u(fill, box);
			drawShape(box, none, Rgba{1, 1, 1, colour.a}, 0);
			continue;
		}
		if (mask.w <= 0 || mask.h <= 0) continue;
		const int mx = ix + mask.x, my = iy + mask.y;
		if (mx >= tileW || my >= tileH || mx + mask.w <= 0 || my + mask.h <= 0) continue;
		Ink* ink = nullptr;
		for (Ink& k : inks)
			if (k.colour.r == colour.r && k.colour.g == colour.g && k.colour.b == colour.b && k.colour.a == colour.a) ink = &k;
		if (!ink) {
			inks.push_back({colour, {}});
			ink = &inks.back();
		}
		ink->placed.push_back({&mask, {mx, my}});
	}
	for (const Ink& ink : inks) {
		int x0 = INT32_MAX, y0 = INT32_MAX, x1 = INT32_MIN, y1 = INT32_MIN;
		for (const auto& [mask, at] : ink.placed) x0 = std::min(x0, at.first), y0 = std::min(y0, at.second), x1 = std::max(x1, at.first + mask->w), y1 = std::max(y1, at.second + mask->h);
		x0 = std::max(x0, 0), y0 = std::max(y0, 0), x1 = std::min(x1, tileW), y1 = std::min(y1, tileH);
		if (x1 <= x0 || y1 <= y0) continue;
		std::vector<float> uncovered(size_t(x1 - x0) * size_t(y1 - y0), 1.f);
		const uint8_t* gamma = gammaTable(ink.colour);
		for (const auto& [mask, at] : ink.placed)
			for (int y = 0; y < mask->h; y++) {
				const int ty = at.second + y;
				if (ty < y0 || ty >= y1) continue;
				for (int x = 0; x < mask->w; x++) {
					const int tx = at.first + x;
					if (tx < x0 || tx >= x1) continue;
					const uint8_t a = gamma[mask->a[size_t(y) * size_t(mask->w) + size_t(x)]];
					if (a) uncovered[size_t(ty - y0) * size_t(x1 - x0) + size_t(tx - x0)] *= 1 - a / 255.f;
				}
			}
		raster::Mask all;
		all.x = x0, all.y = y0, all.w = x1 - x0, all.h = y1 - y0;
		all.a.resize(uncovered.size());
		for (size_t i = 0; i < uncovered.size(); i++) all.a[i] = uint8_t(std::lround((1 - uncovered[i]) * 255));
		drawMask(all, ink.colour);
	}
	// Lines under and through, each a stroke along the run's piece (`Decorations::paint`).
	for (const PlacedPiece& p : pieces) {
		const CardRunPaint& pp = paintOf(p.span);
		if (!pp.lines) continue;
		const Rgba colour = resolved(pp.lineInk, own);
		double metric[4];
		lineMetrics(p.face, metric);
		const double size = spans[size_t(std::clamp(p.span, 0, int(spans.size()) - 1))].size;
		for (int which = 1; which <= 2; which <<= 1) {
			if (!(pp.lines & which)) continue;
			double thickness = size / 14.0;
			double position;
			if (which == 1) {
				if (metric[1] > 0) thickness = metric[1] * size;
				position = metric[0] * size > 0 ? metric[0] * size : thickness;
			} else {
				if (metric[1] > 0) thickness = metric[1] * size;
				if (!std::isnan(metric[3]) && metric[3] > 0) thickness = metric[3] * size;
				position = std::isnan(metric[2]) ? -size * 0.25 : metric[2] * size;
			}
			const double y = oy + p.baseline + position;
			raster::Path line;
			line.moveTo({ox + p.x0, y});
			line.lineTo({ox + p.x1, y});
			strokePath(line, false, thickness, 1, 0, 0, {}, colour);
		}
	}
}

// Drawing ops of a card (`card.cpp`), from (ox, oy): what `layoutMarkdown`'s `drawOps` draws.
void paintCardOps(const std::vector<CardOp>& ops, const CardPalette& C, double ox, double oy, int handle) {
	auto rgba = [](const CardColour& c) { return Rgba{c.r, c.g, c.b, c.a}; };
	for (const CardOp& op : ops) {
		switch (op.kind) {
			case CardOp::TEXT:
				paintParagraph(op.text, op.spans, op.base, op.lineHeight, op.w, op.align, op.paints, rgba(op.colour), ox + op.x, oy + op.y);
				break;
			case CardOp::BOX: {
				const double box[4] = {ox + op.x, oy + op.y, op.w, op.h};
				const double r = op.r > 0 ? fitted(op.r, op.w, op.h) : 0;
				const double radii[4] = {r, r, r, r};
				drawShape(box, radii, rgba(op.colour), 0);
				break;
			}
			case CardOp::CHECK: {
				const double box[4] = {ox + op.x, oy + op.y, op.w, op.h};
				const double r = fitted(op.w * 0.25, op.w, op.h);
				const double radii[4] = {r, r, r, r};
				drawShape(box, radii, rgba(op.checked ? C.accent : C.box), 0);
				if (!op.checked) strokePath(rrectPath(box, radii), false, 1, 1, 0, 0, {}, rgba(C.strong));
				else {
					const double s = op.w;
					raster::Path tick;
					tick.moveTo({box[0] + s * 0.26, box[1] + s * 0.52});
					tick.lineTo({box[0] + s * 0.43, box[1] + s * 0.69});
					tick.lineTo({box[0] + s * 0.75, box[1] + s * 0.33});
					strokePath(tick, false, s * 0.14, 1, 1, 1, {}, Rgba{1, 1, 1, 1});
				}
				break;
			}
			case CardOp::IMAGE: {
				// The picture drawn into its own box, sampled at the nearest pixel (`drawImageRect`'s default).
				const double box[4] = {ox + op.x, oy + op.y, op.w, op.h};
				const double none[4] = {0, 0, 0, 0};
				Grad picture;
				picture.kind = 3;
				picture.image = op.image;
				picture.mode = 2;
				picture.nearest = true;
				Using u(picture, box);
				drawShape(box, none, Rgba{1, 1, 1, 1}, 0);
				break;
			}
			case CardOp::SCROLL: {
				const double max = op.content - op.w;
				const auto found = scrolls.find(handle);
				const double asked = found != scrolls.end() && size_t(op.index) < found->second.size() ? found->second[size_t(op.index)] : 0;
				const double offset = std::max(0.0, std::min(max, asked));
				painter.clips.push_back(Clip{painter.m.inverse(), {ox + op.x, oy + op.y, op.w, op.h}, {0, 0, 0, 0}, painter.m.scale()});
				paintCardOps(op.ops, C, ox - offset, oy, handle);
				painter.clips.pop_back();
				// The bar: how much of the table shows, and where along it the view is.
				const double thumb = std::max(24.0, (op.w / op.content) * op.w);
				const double at = max > 0 ? (offset / max) * (op.w - thumb) : 0;
				const double track[4] = {ox + op.x, oy + op.y + op.h - 3, op.w, 3};
				const double bar[4] = {ox + op.x + at, oy + op.y + op.h - 3, thumb, 3};
				const double round[4] = {1.5, 1.5, 1.5, 1.5};
				drawShape(track, round, rgba(C.line), 0);
				drawShape(bar, round, rgba(C.faint), 0);
				break;
			}
		}
	}
}

// A card's markdown inside its box (`paintMarkdown`): cut at the paper's own corners when padded.
void paintCard(int handle, const double box[4], double pad) {
	const double* nums = nullptr;
	size_t count = 0;
	const char* pool = nullptr;
	if (!sceneCard(handle, &nums, &count, &pool)) {
		refuse("card not in the scene");
		return;
	}
	std::vector<CardOp> ops;
	CardPalette palette;
	bool ok = true;
	cardOps(nums, count, pool, std::max(1.0, box[2] - pad * 2), ops, palette, ok);
	if (!ok) {
		refuse("card with a picture");
		return;
	}
	if (pad > 0) {
		const double r = fitted(12, box[2], box[3]);
		painter.clips.push_back(Clip{painter.m.inverse(), {box[0], box[1], box[2], box[3]}, {r, r, r, r}, painter.m.scale()});
	}
	paintCardOps(ops, palette, box[0] + pad, box[1] + pad, handle);
	if (pad > 0) painter.clips.pop_back();
}

void paintWords(const Words& w, const double box[4]) {
	if (!w.on || w.text.empty()) return;
	const std::vector<int> chain = chainOf(w.chain.data(), int(w.chain.size()), w.weight, w.italic);
	if (chain.empty()) {
		refuse("words with no font");
		return;
	}
	const double width = std::max(1.0, box[2] - w.pad * 2) + (w.grow ? 1 : 0);
	Span one{0, w.text.size(), chain, w.size, w.letterSpacing};
	one.weight = w.weight;
	one.italic = w.italic;
	CardRunPaint paint;
	paint.ink = CardColour{w.color.r, w.color.g, w.color.b, w.color.a};
	paint.lines = (w.underline ? 1 : 0) | (w.strike ? 2 : 0);
	paint.lineInk = paint.ink;
	// Measured first, for where it sits up and down in its box.
	std::vector<PlacedGlyph> glyphs;
	std::vector<PlacedLine> lines;
	double out[4];
	placeGlyphs(w.text.data(), int(w.text.size()), std::vector<Span>{one}, one, w.lineHeight, width, w.align, glyphs, lines, out);
	const double inner = box[3] - w.pad * 2, height = out[2];
	const double offset = w.vertical == 1 ? (inner - height) / 2 : w.vertical == 2 ? inner - height : 0;
	paintParagraph(w.text, std::vector<Span>{one}, one, w.lineHeight, width, w.align, std::vector<CardRunPaint>{paint}, w.color, box[0] + w.pad, box[1] + w.pad + std::max(0.0, offset));
}

// --- drawing ops -----------------------------------------------------------------------------------
//
// What the page reduces an icon, a film's or a sound's badge, a placeholder, an arrow's words, a prompt's
// model name and the ink under the pen to (`paint-wire.ts`, `ops`), in the item's coordinates:
//   1 path   [d, affine 6, fill rgba, even-odd, stroke rgba, width, cap, join, dashes, ...dash]
//   2 rrect  [x, y, w, h, radius, fill rgba, stroke rgba, width, dashes, ...dash]
//   3 words  [x, y, band, width, align, one line, size, weight, italic, colour, text, chain]: with a band,
//            set in the middle of it, at least a pixel down
//   4 pill   [right, bottom, pad x, pad y, radius divisor, back rgba, size, weight, colour, text, chain]
//   5 label  [line d, affine 6, size, weight, colour, patch rgba, text, chain]: at the line's middle
// A string is [length, ...bytes]; a colour is four numbers.

struct OpReader {
	const std::vector<double>& v;
	size_t at = 0;
	double next() { return at < v.size() ? v[at++] : 0; }
	Rgba rgba() {
		Rgba c;
		c.r = float(next()), c.g = float(next()), c.b = float(next()), c.a = float(next());
		return c;
	}
	std::string text() {
		const int n = int(next());
		std::string out;
		for (int k = 0; k < n && at < v.size(); k++) out.push_back(char(int(next())));
		return out;
	}
	std::vector<double> dash() {
		const int n = int(next());
		std::vector<double> out;
		for (int k = 0; k < n; k++) out.push_back(next());
		return out;
	}
};

// Words set as `fonts.paragraph` sets them: one style, a width, an alignment; with `oneLine`, cut to the
// first line with an ellipsis when they would wrap. Answers the paragraph's height and longest line.
void opWords(const std::string& text, const std::string& chainNames, double size, int weight, bool italic, double width, int align, bool oneLine, Rgba colour, double x, double y, double* height, double* longest, double* intrinsic, bool draw) {
	const std::vector<int> chain = chainOf(chainNames.data(), int(chainNames.size()), weight, italic);
	if (chain.empty()) {
		refuse("words with no font");
		return;
	}
	Span one{0, text.size(), chain, size, 0, weight, italic};
	std::vector<PlacedGlyph> glyphs;
	std::vector<PlacedLine> lines;
	double out[4];
	std::string words = text;
	placeGlyphs(words.data(), int(words.size()), std::vector<Span>{one}, one, NAN, width, align, glyphs, lines, out);
	if (oneLine && lines.size() > 1) {
		// The first line, letters taken off its end until it and an ellipsis fit (`TextLine::createEllipsis`);
		// when not even the ellipsis fits, nothing is drawn.
		bool fits = false;
		for (size_t cut = words.size(); cut > 0; cut--) {
			if ((words[cut - 1] & 0xC0) == 0x80) continue;
			std::string trial = words.substr(0, cut);
			while (!trial.empty() && trial.back() == ' ') trial.pop_back();
			trial += "\xE2\x80\xA6";
			Span t{0, trial.size(), chain, size, 0, weight, italic};
			double o[4];
			std::vector<PlacedGlyph> g;
			std::vector<PlacedLine> l;
			placeGlyphs(trial.data(), int(trial.size()), std::vector<Span>{t}, t, NAN, NAN, align, g, l, o);
			if (o[1] <= width) {
				words = trial;
				fits = true;
				break;
			}
		}
		if (!fits) {
			if (height) *height = out[2];
			if (longest) *longest = 0;
			if (intrinsic) *intrinsic = out[0];
			return;
		}
		one = Span{0, words.size(), chain, size, 0, weight, italic};
		placeGlyphs(words.data(), int(words.size()), std::vector<Span>{one}, one, NAN, width, align, glyphs, lines, out);
	}
	if (height) *height = out[2];
	if (longest) *longest = out[1];
	if (intrinsic) *intrinsic = out[0];
	if (!draw) return;
	CardRunPaint paint;
	paint.ink = CardColour{colour.r, colour.g, colour.b, colour.a};
	paintParagraph(words, std::vector<Span>{one}, one, NAN, width, align, std::vector<CardRunPaint>{paint}, colour, x, y);
}

void paintOps(const std::vector<double>& ops) {
	OpReader o{ops};
	while (o.at < ops.size()) {
		const int kind = int(o.next());
		switch (kind) {
			case 1: {
				const std::string d = o.text();
				const double a = o.next(), b = o.next(), c = o.next(), dd = o.next(), e = o.next(), f = o.next();
				const Rgba fill = o.rgba();
				const bool evenOdd = o.next() != 0;
				const Rgba stroke = o.rgba();
				const double width = o.next();
				const int cap = int(o.next()), join = int(o.next());
				const std::vector<double> dash = o.dash();
				raster::Path parsed;
				if (!raster::parseSvg(d, parsed)) break;
				// The path's own transform goes into the path, so its stroke is as wide as asked, scaled with it.
				const Affine saved = painter.m;
				painter.m = Affine{a, b, c, dd, e, f}.then(painter.m);
				if (fill.a > 0) drawMask(coverage(flat(parsed), evenOdd), fill);
				if (stroke.a > 0 && width > 0) strokePath(parsed, evenOdd, width, 1, cap, join, dash, stroke);
				painter.m = saved;
				break;
			}
			case 2: {
				const double box[4] = {o.next(), o.next(), o.next(), o.next()};
				const double r = fitted(o.next(), box[2], box[3]);
				const double radii[4] = {r, r, r, r};
				const Rgba fill = o.rgba(), stroke = o.rgba();
				const double width = o.next();
				const std::vector<double> dash = o.dash();
				if (fill.a > 0) drawShape(box, radii, fill, 0);
				if (stroke.a > 0 && width > 0) strokePath(rrectPath(box, radii), false, width, 1, 0, 0, dash, stroke);
				break;
			}
			case 3: {
				const double x = o.next(), y = o.next(), band = o.next(), width = o.next();
				const int align = int(o.next());
				const bool oneLine = o.next() != 0;
				const double size = o.next();
				const int weight = int(o.next());
				const bool italic = o.next() != 0;
				const Rgba colour = o.rgba();
				const std::string text = o.text(), chain = o.text();
				double top = y;
				if (band > 0) {
					double h = 0;
					opWords(text, chain, size, weight, italic, width, align, oneLine, colour, x, y, &h, nullptr, nullptr, false);
					top = y + std::max(1.0, (band - h) / 2);
				}
				opWords(text, chain, size, weight, italic, width, align, oneLine, colour, x, top, nullptr, nullptr, nullptr, true);
				break;
			}
			case 4: {
				const double right = o.next(), bottom = o.next(), padX = o.next(), padY = o.next(), divisor = o.next();
				const Rgba back = o.rgba();
				const double size = o.next();
				const int weight = int(o.next());
				const Rgba colour = o.rgba();
				const std::string text = o.text(), chain = o.text();
				double h = 0, intrinsic = 0;
				opWords(text, chain, size, weight, false, 200, 0, false, colour, 0, 0, &h, nullptr, &intrinsic, false);
				const double tw = std::ceil(intrinsic), pw = tw + padX * 2, ph = h + padY * 2;
				const double box[4] = {right - pw, bottom - ph, pw, ph};
				const double r = fitted(ph / divisor, pw, ph);
				const double radii[4] = {r, r, r, r};
				drawShape(box, radii, back, 0);
				opWords(text, chain, size, weight, false, 200, 0, false, colour, right - pw + padX, bottom - ph + padY, nullptr, nullptr, nullptr, true);
				break;
			}
			case 5: {
				const std::string d = o.text();
				const double a = o.next(), b = o.next(), c = o.next(), dd = o.next(), e = o.next(), f = o.next();
				const double size = o.next();
				const int weight = int(o.next());
				const Rgba colour = o.rgba(), patch = o.rgba();
				const std::string text = o.text(), chain = o.text();
				raster::Path parsed;
				if (!raster::parseSvg(d, parsed)) break;
				raster::Vec at;
				// Where half its length falls, measured as Skia's contour measure measures it at a scale of one.
				if (!raster::pointAlong(parsed.transformed(raster::Affine{a, b, c, dd, e, f}), 0.5, 1, at)) break;
				double h = 0, longest = 0;
				opWords(text, chain, size, weight, false, 400, 2, false, colour, 0, 0, &h, &longest, nullptr, false);
				const double w = std::min(400.0, longest);
				const double box[4] = {at.x - w / 2 - 5, at.y - h / 2 - 2, w + 10, h + 4};
				const double radii[4] = {5, 5, 5, 5};
				drawShape(box, radii, patch, 0);
				opWords(text, chain, size, weight, false, 400, 2, false, colour, at.x - 200, at.y - h / 2, nullptr, nullptr, nullptr, true);
				break;
			}
			default:
				return;
		}
	}
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
	if (holes[size_t(handle)]) {
		// A file shown live by an element under the sheet: its box cleared, so the element shows through.
		const double box[4] = {placed.x, placed.y, placed.w, placed.h};
		double radii[4];
		for (int i = 0; i < 4; i++) radii[i] = std::max(0.0, std::min({records[size_t(handle)].radii[i], placed.w / 2, placed.h / 2}));
		glBlendFunc(GL_ZERO, GL_ONE_MINUS_SRC_ALPHA);
		drawShape(box, radii, Rgba{0, 0, 0, 1}, 0);
		glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
		return;
	}
	if (r.kind == K_UNSUPPORTED) {
		refuse("unsupported item");
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
		// Skia snaps a sine or cosine within 1/4096 of zero to zero (`SkScalarSinSnapToZero`), so a right angle is exact.
		auto snap = [](double v) { return std::fabs(v) <= 1.0 / 4096 ? 0.0 : v; };
		const double t = -r.rotation * M_PI / 180, cs = snap(std::cos(t)), sn = snap(std::sin(t));
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
				for (size_t i = 0; i < r.fills.size(); i++) {
					Using u(r.fillGrads[i], box);
					drawShape(box, radii, r.fills[i], 0);
				}
			if (r.clip) {
				painter.clips.push_back(Clip{painter.m.inverse(), {box[0], box[1], box[2], box[3]}, {radii[0], radii[1], radii[2], radii[3]}, painter.m.scale()});
				paintChildren(handle);
				painter.clips.pop_back();
			} else paintChildren(handle);
			{
				Using u(r.stroke.grad, box);
				paintStroke(r, box, radii, false);
			}
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
			for (size_t i = 0; i < r.fills.size(); i++) {
				Using u(r.fillGrads[i], box);
				drawShape(box, none, r.fills[i], 2);
			}
			{
				Using u(r.stroke.grad, box);
				paintStroke(r, box, none, true);
			}
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
			for (size_t i = 0; i < r.fills.size(); i++) {
				Using u(r.fillGrads[i], box);
				drawShape(box, round, r.fills[i], 0);
			}
			hairline(box, 12);
			if (!muted[size_t(handle)]) {
				if (r.words.markdown) paintCard(handle, box, r.words.pad);
				else paintWords(r.words, box);
			}
			break;
		}
		case K_TEXT:
			if (!muted[size_t(handle)]) {
				if (r.words.markdown) paintCard(handle, box, r.words.pad);
				else paintWords(r.words, box);
			}
			break;
		case K_GROUP:
			paintChildren(handle);
			break;
		case K_OPS:
			break;
		default:
			break;
	}
	if (!r.ops.empty()) paintOps(r.ops);
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
		muted.resize(records.size(), 0);
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
		// A paint: [0, rgba] a colour, or [1, kind, centre x, y, size w, h, turn, opacity, stops, ...] a gradient.
		auto paint = [&](Rgba& colour, Grad& grad) {
			const int kind = int(next());
			if (kind == 0) {
				colour = rgba();
				return;
			}
			if (kind == 2) {
				// [2, picture, mode, opacity]
				grad.kind = 3;
				grad.image = int(next());
				grad.mode = int(next());
				colour = Rgba{1, 1, 1, float(next())};
				return;
			}
			grad.kind = int(next());
			grad.cx = next(), grad.cy = next(), grad.sw = next(), grad.sh = next(), grad.rotation = next();
			colour = Rgba{1, 1, 1, float(next())};
			const int stops = int(next());
			for (int k = 0; k < stops; k++) {
				grad.colors.push_back(rgba());
				grad.at.push_back(float(std::clamp(next(), 0.0, 1.0)));
			}
		};
		const int fills = int(next());
		for (int i = 0; i < fills; i++) {
			r.fills.emplace_back();
			r.fillGrads.emplace_back();
			paint(r.fills.back(), r.fillGrads.back());
		}
		r.stroke.on = next() != 0;
		if (r.stroke.on) paint(r.stroke.color, r.stroke.grad);
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
	if (r.kind == K_NOTE || r.kind == K_TEXT) {
		// [has words, pad, colour, align, vertical, underline, strike, grow, size, weight, italic, spacing,
		//  line height or NaN, bytes, ...UTF-8, chain bytes, ...chain]
		Words& w = r.words;
		const int on = int(next());
		w.on = on != 0;
		// [2, pad]: a card's markdown, which the scene holds.
		if (on == 2) {
			w.markdown = true;
			w.pad = next();
		} else if (w.on) {
			w.pad = next();
			w.color = rgba();
			w.align = int(next());
			w.vertical = int(next());
			w.underline = next() != 0;
			w.strike = next() != 0;
			w.grow = next() != 0;
			w.size = next();
			w.weight = int(next());
			w.italic = next() != 0;
			w.letterSpacing = next();
			w.lineHeight = next();
			const int bytes = int(next());
			for (int k = 0; k < bytes; k++) w.text.push_back(char(int(next())));
			const int chainBytes = int(next());
			for (int k = 0; k < chainBytes; k++) w.chain.push_back(char(int(next())));
		}
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
	r.ops = std::move(records[size_t(handle)].ops);
	records[size_t(handle)] = r;
}

EMSCRIPTEN_KEEPALIVE void paint_flags(int handle, int skip, int hole, int mute) {
	if (handle < 0 || size_t(handle) >= records.size()) return;
	skipped[size_t(handle)] = char(skip);
	holes[size_t(handle)] = char(hole);
	muted[size_t(handle)] = char(mute);
}
EMSCRIPTEN_KEEPALIVE void paint_scheme(int isDark) { dark = isDark != 0; }
EMSCRIPTEN_KEEPALIVE const char* paint_why() { return whyNot; }
// A picture the page uploaded into this context as texture `texture` (an Emscripten GL name), `w` by `h`;
// a texture of 0 forgets it.
EMSCRIPTEN_KEEPALIVE void paint_image(int id, int texture, int w, int h) {
	if (!texture) pictures.erase(id);
	else pictures[id] = Picture{GLuint(texture), std::max(1, w), std::max(1, h)};
}
// An item's drawing ops, made once its box is known (`paint-wire.ts`, `opsOf`): `count` numbers at `f`.
EMSCRIPTEN_KEEPALIVE void paint_ops(int handle, const double* f, int count) {
	if (handle < 0) return;
	if (size_t(handle) >= records.size()) {
		records.resize(size_t(handle) + 1);
		skipped.resize(records.size(), 0);
		holes.resize(records.size(), 0);
		muted.resize(records.size(), 0);
	}
	records[size_t(handle)].ops.assign(f, f + count);
}
// The ink under the pen, as drawing ops in stage pixels at the scene's input (`count` numbers): drawn over everything.
EMSCRIPTEN_KEEPALIVE void paint_overlay(const double* f, int count) { overlay.assign(f, f + count); }
// How far an item's card has its `index`th wide table scrolled; a handle of -1 forgets them all.
EMSCRIPTEN_KEEPALIVE void paint_scroll(int handle, int index, double offset) {
	if (handle < 0) {
		scrolls.clear();
		return;
	}
	auto& list = scrolls[handle];
	if (list.size() <= size_t(index)) list.resize(size_t(index) + 1, 0);
	list[size_t(index)] = offset;
}

// Paint the rectangle of the drawing at stage (x, y), `w` by `h` stage units, into a `pw` by `ph` canvas.
// Returns 1 when everything in it was drawn, 0 when something there is beyond this painter. With
// `paint_only` set, only those items are drawn, each as if it stood alone (a drag's lifted items).
std::vector<int> onlyItems;
EMSCRIPTEN_KEEPALIVE int paint_region(double x, double y, double w, double h, int pw, int ph) {
	tileW = pw;
	tileH = ph;
	glBindFramebuffer(GL_FRAMEBUFFER, 0);
	glViewport(0, 0, pw, ph);
	glDisable(GL_DEPTH_TEST);
	glEnable(GL_BLEND);
	glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
	glClearColor(0, 0, 0, 0);
	glClear(GL_COLOR_BUFFER_BIT);
	glUseProgram(program);
	glBindVertexArray(vao);
	glUniform2f(uView, float(pw), float(ph));
	const double lx = double(pw) / w, ly = double(ph) / h;
	painter = Painter{};
	whyNot = "";
	// Glyph masks are let go between tiles, never inside one: a paragraph holds on to the ones it placed.
	if (glyphMasks.size() > 4096) glyphMasks.clear();
	painter.m = Affine{lx, 0, 0, ly, -x * lx, -y * ly};
	std::vector<int> list;
	if (!onlyItems.empty()) list = onlyItems;
	else {
		const int* roots = nullptr;
		const int count = sceneRoots(&roots);
		list.assign(roots, roots + count);
	}
	for (int root : list) {
		const PaintBox b = sceneBox(root);
		// Far from the tile: nothing of it shows. Its shadows and stroke reach past its box by what they
		// say; a path's own geometry can reach past it anywhere, so a path is never left out.
		if (root < int(records.size())) {
			const Record& r = records[size_t(root)];
			const bool contained = r.rotation == 0 && r.kind != K_PATH && (r.clip || sceneChildren(root, nullptr) == 0);
			double reach = 64 + std::max({r.stroke.widths[0], r.stroke.widths[1], r.stroke.widths[2], r.stroke.widths[3]});
			for (const Shadow& sh : r.shadows) reach = std::max(reach, 64 + sh.blur * 2 + std::max(std::fabs(sh.dx), std::fabs(sh.dy)));
			if (b.placed && contained && (b.x > x + w + reach || b.y > y + h + reach || b.x + b.w < x - reach || b.y + b.h < y - reach)) continue;
		}
		paintNode(root);
	}
	if (!overlay.empty() && onlyItems.empty()) paintOps(overlay);
	glBindVertexArray(0);
	return painter.supported ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE int paint_tile(double x, double y, double size, int pixels) { return paint_region(x, y, size, size, pixels, pixels); }
// Draw only these items in the next paints (`count` handles at `handles`); a count of 0 draws everything again.
EMSCRIPTEN_KEEPALIVE void paint_only(const int* handles, int count) { onlyItems.assign(handles, handles + count); }

}  // extern "C"
