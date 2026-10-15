// Paths, strokes and coverage masks for the painter (`raster.cpp`).
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace raster {

struct Vec { double x, y; };

struct Affine {
	double a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;
	Vec apply(Vec p) const;
};

struct Seg {
	enum Kind { LINE, QUAD, CONIC, CUBIC } kind;
	Vec c1, c2, p;
	double w;  // a conic's weight
};
struct Sub {
	Vec start;
	std::vector<Seg> segs;
	bool closed;
};
struct Path {
	std::vector<Sub> subs;
	bool evenOdd = false;
	void moveTo(Vec p);
	void lineTo(Vec p);
	void quadTo(Vec c, Vec p);
	void conicTo(Vec c, Vec p, double w);
	void cubicTo(Vec c1, Vec c2, Vec p);
	void close();
	Vec last() const;
	Path transformed(const Affine& m) const;
	// Skia's own shapes and arcs, as conics.
	void addOval(double l, double t, double r, double b, bool ccw = false, int start = 1);
	void arcToOval(double l, double t, double r, double b, double startDeg, double sweepDeg, bool forceMoveTo);
	void svgArc(double rx, double ry, double angle, bool large, bool sweep, Vec p1);
	void arcToTangent(Vec corner, Vec next, double r);

private:
	void ensureStarted();
};

// A flattened subpath: its points, which of them are real corners (not cut out of a curve), closed or not.
struct Polyline {
	std::vector<Vec> points;
	std::vector<char> corner;
	bool closed = false;
};

enum class Cap { BUTT, ROUND, SQUARE };
enum class Join { MITER, ROUND, BEVEL };

// An alpha mask over the pixels [x, x + w) × [y, y + h).
struct Mask {
	int x = 0, y = 0, w = 0, h = 0;
	std::vector<uint8_t> a;
};

bool parseSvg(const std::string& d, Path& out);
// How curves are cut into lines: as Skia's edge builder cuts a fill, finely for a line to be stroked, or as
// Skia cuts a hairline.
enum class Cut { FILL, FINE, HAIR };
std::vector<Polyline> flatten(const Path& path, const Affine& m, Cut cut);
// Dashes laid as Skia lays them, in the path's own units; `resScale` is how many pixels a unit is.
Path dash(const Path& path, const std::vector<double>& pattern, double resScale);
bool pointAlong(const Path& path, double fraction, double resScale, Vec& out);
std::vector<Polyline> stroke(const std::vector<Polyline>& lines, double width, Cap cap, Join join, double miterLimit);
// Only the pixels in [left, right) × [top, bottom) are covered.
// What a stroke one device pixel wide or less is drawn as: the lines with their caps (`hairline`), then
// Skia's anti-aliased hairline coverage (`hairMask`).
std::vector<Polyline> hairline(const std::vector<Polyline>& lines, Cap cap);
Mask hairMask(const std::vector<Polyline>& lines, int left, int top, int right, int bottom);
// `snap` puts each edge's ends on quarter pixels, as Skia's fill does; a hairline is drawn without.
Mask rasterize(const std::vector<Polyline>& rings, bool evenOdd, int left, int top, int right, int bottom, bool snap = true);
Mask blur(const Mask& in, double sigma);
Mask combine(const Mask& a, const Mask& b, bool keepInside);

}  // namespace raster
