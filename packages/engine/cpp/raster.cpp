// Paths for the painter (`paint.cpp`), built as Skia builds them so they land on the same pixels: SVG
// geometry read as `MakeFromSVGString` reads it, arcs, ovals and rounded corners as Skia's conics (a curve
// with a weight, which draws a circle exactly), and the shapes `paint.ts` builds (a polygon with rounded
// corners, an arc or a ring of an ellipse). A fill is cut into straight pieces by Skia's edge builder's
// rules: each curve split where it turns up or down, and into as many pieces as Skia would. A dash pattern
// is laid along the curves by Skia's own measure of their length, which is coarse on a tight corner, so the
// dashes fall where Skia's do. Strokes are outlines with Skia's caps, joins and mitre limit, and a
// coverage rasteriser turns outlines into an alpha mask: sixteen rows of samples a pixel, each with its
// exact horizontal share, for the non-zero and the even-odd rule. A mask can be blurred, cut by another,
// and is coloured on the GPU like any other draw.
#include "raster.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>

namespace raster {

namespace {
Vec lerp(Vec a, Vec b, double t) { return {a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t}; }
double dist(Vec a, Vec b) { return std::hypot(b.x - a.x, b.y - a.y); }
const double ROOT2_OVER_2 = 0.707106781;
}  // namespace

// --- building paths ---------------------------------------------------------------------------------

void Path::moveTo(Vec p) { subs.push_back(Sub{p, {}, false}); }
void Path::ensureStarted() {
	// Skia's `injectMoveToIfNeeded`: after a close, or with nothing yet, draw on from where the last began.
	if (subs.empty()) moveTo({0, 0});
	else if (subs.back().closed) moveTo(subs.back().start);
}
void Path::lineTo(Vec p) {
	ensureStarted();
	subs.back().segs.push_back(Seg{Seg::LINE, {}, {}, p, 1});
}
void Path::quadTo(Vec c, Vec p) {
	ensureStarted();
	subs.back().segs.push_back(Seg{Seg::QUAD, c, {}, p, 1});
}
void Path::conicTo(Vec c, Vec p, double w) {
	ensureStarted();
	subs.back().segs.push_back(Seg{Seg::CONIC, c, {}, p, w});
}
void Path::cubicTo(Vec c1, Vec c2, Vec p) {
	ensureStarted();
	subs.back().segs.push_back(Seg{Seg::CUBIC, c1, c2, p, 1});
}
void Path::close() {
	if (!subs.empty()) subs.back().closed = true;
}
Vec Path::last() const {
	if (subs.empty()) return {0, 0};
	const Sub& s = subs.back();
	if (s.closed) return s.start;
	return s.segs.empty() ? s.start : s.segs.back().p;
}
Path Path::transformed(const Affine& m) const {
	Path out = *this;
	for (Sub& s : out.subs) {
		s.start = m.apply(s.start);
		for (Seg& g : s.segs) g.c1 = m.apply(g.c1), g.c2 = m.apply(g.c2), g.p = m.apply(g.p);
	}
	return out;
}

// Skia's `addOval`: a move to the point at `start` (0 top, 1 right, 2 bottom, 3 left), four quarter conics.
void Path::addOval(double l, double t, double r, double b, bool ccw, int start) {
	const double cx = (l + r) / 2, cy = (t + b) / 2;
	const Vec oval[4] = {{cx, t}, {r, cy}, {cx, b}, {l, cy}};
	const Vec rect[4] = {{l, t}, {r, t}, {r, b}, {l, b}};
	const int step = ccw ? 3 : 1;
	int o = start % 4, k = (start + (ccw ? 1 : 0)) % 4;
	moveTo(oval[o]);
	for (int i = 0; i < 4; i++) {
		k = (k + step) % 4;
		o = (o + step) % 4;
		conicTo(rect[k], oval[o], ROOT2_OVER_2);
	}
	close();
}

// Skia's `arcTo(oval, startAngle, sweepAngle, forceMoveTo)`: degrees, clockwise on screen. The arc is one
// conic per quarter and one for what is left (`SkConic::BuildUnitArc`).
void Path::arcToOval(double l, double t, double r, double b, double startDeg, double sweepDeg, bool forceMoveTo) {
	if (r < l || b < t) return;
	if (subs.empty()) forceMoveTo = true;
	startDeg = std::fmod(startDeg, 360.0);
	const double cx = (l + r) / 2, cy = (t + b) / 2, rx = (r - l) / 2, ry = (b - t) / 2;
	auto onOval = [&](Vec u) { return Vec{cx + u.x * rx, cy + u.y * ry}; };
	auto snap = [](double v) { return std::fabs(v) <= 1.0 / 4096 ? 0.0 : v; };
	const double startRad = startDeg * M_PI / 180;
	double stopRad = (startDeg + sweepDeg) * M_PI / 180;
	Vec startV{snap(std::cos(startRad)), snap(std::sin(startRad))};
	Vec stopV{snap(std::cos(stopRad)), snap(std::sin(stopRad))};
	// A sweep so close to a whole turn that both ends are one point: nudge the end back until they part.
	if (startV.x == stopV.x && startV.y == stopV.y) {
		const double sw = std::fabs(sweepDeg);
		if (sw < 360 && sw > 359) {
			const double delta = std::copysign(1.0 / 512, sweepDeg);
			do {
				stopRad -= delta;
				stopV = {snap(std::cos(stopRad)), snap(std::sin(stopRad))};
			} while (startV.x == stopV.x && startV.y == stopV.y);
		}
	}
	const bool cw = sweepDeg > 0;
	const Vec first = onOval(startV);
	if (forceMoveTo) moveTo(first);
	else {
		const Vec at = last();
		if (std::fabs(at.x - first.x) > 1.0 / 4096 || std::fabs(at.y - first.y) > 1.0 / 4096) lineTo(first);
	}
	if (startV.x == stopV.x && startV.y == stopV.y) {
		lineTo(onOval(stopV));
		return;
	}
	// The arc from (1, 0) to (x, y) in quadrants, then turned to start at startV (and mirrored for ccw).
	double x = startV.x * stopV.x + startV.y * stopV.y;
	double y = startV.x * stopV.y - startV.y * stopV.x;
	if (std::fabs(y) <= 1.0 / 4096 && x > 0 && ((y >= 0 && cw) || (y <= 0 && !cw))) return;
	if (!cw) y = -y;
	int quadrant = 0;
	if (y == 0) quadrant = 2;
	else if (x == 0) quadrant = y > 0 ? 1 : 3;
	else {
		if (y < 0) quadrant += 2;
		if ((x < 0) != (y < 0)) quadrant += 1;
	}
	static const Vec Q[] = {{1, 0}, {1, 1}, {0, 1}, {-1, 1}, {-1, 0}, {-1, -1}, {0, -1}, {1, -1}};
	struct Unit { Vec c, p; double w; };
	std::vector<Unit> conics;
	for (int i = 0; i < quadrant; i++) conics.push_back({Q[i * 2 + 1], Q[(i * 2 + 2) % 8], ROOT2_OVER_2});
	const Vec lastQ = Q[(quadrant * 2) % 8];
	const double dot = lastQ.x * x + lastQ.y * y;
	if (dot < 1) {
		Vec off{lastQ.x + x, lastQ.y + y};
		const double cosHalf = std::sqrt((1 + dot) / 2);
		const double len = std::hypot(off.x, off.y);
		off = {off.x / len / cosHalf, off.y / len / cosHalf};
		if (std::fabs(lastQ.x - off.x) > 1.0 / 4096 || std::fabs(lastQ.y - off.y) > 1.0 / 4096) conics.push_back({off, {x, y}, cosHalf});
	}
	auto place = [&](Vec u) {
		if (!cw) u.y = -u.y;
		const Vec turned{u.x * startV.x - u.y * startV.y, u.x * startV.y + u.y * startV.x};
		return onOval(turned);
	};
	for (const Unit& c : conics) conicTo(place(c.c), place(c.p), c.w);
}

// Skia's SVG arc (`arcTo(rx, ry, angle, large, sweep, x, y)`): conics of up to a third of a turn each.
void Path::svgArc(double rx, double ry, double angle, bool large, bool sweep, Vec p1) {
	ensureStarted();
	const Vec p0 = last();
	if (rx == 0 || ry == 0 || (p0.x == p1.x && p0.y == p1.y)) {
		lineTo(p1);
		return;
	}
	rx = std::fabs(rx);
	ry = std::fabs(ry);
	const double phi = angle * M_PI / 180, cs = std::cos(phi), sn = std::sin(phi);
	const double mx = (p0.x - p1.x) / 2, my = (p0.y - p1.y) / 2;
	const double tx = cs * mx + sn * my, ty = -sn * mx + cs * my;
	double radiiScale = tx * tx / (rx * rx) + ty * ty / (ry * ry);
	if (radiiScale > 1) {
		radiiScale = std::sqrt(radiiScale);
		rx *= radiiScale;
		ry *= radiiScale;
	}
	// Into the unit circle: unrotate, then scale by 1/r.
	auto toUnit = [&](Vec p) { return Vec{(cs * p.x + sn * p.y) / rx, (-sn * p.x + cs * p.y) / ry}; };
	Vec u0 = toUnit(p0), u1 = toUnit(p1);
	Vec delta{u1.x - u0.x, u1.y - u0.y};
	const double d = delta.x * delta.x + delta.y * delta.y;
	double factor = std::sqrt(std::max(1 / d - 0.25, 0.0));
	// Skia's direction: sweep 1 is clockwise (kCW), and it flips the factor when ccw differs from large.
	const bool ccw = !sweep;
	if (ccw != large) factor = -factor;
	delta = {delta.x * factor, delta.y * factor};
	Vec centre{(u0.x + u1.x) / 2 - delta.y, (u0.y + u1.y) / 2 + delta.x};
	u0 = {u0.x - centre.x, u0.y - centre.y};
	u1 = {u1.x - centre.x, u1.y - centre.y};
	const double theta1 = std::atan2(u0.y, u0.x), theta2 = std::atan2(u1.y, u1.x);
	double thetaArc = theta2 - theta1;
	if (thetaArc < 0 && !ccw) thetaArc += 2 * M_PI;
	else if (thetaArc > 0 && ccw) thetaArc -= 2 * M_PI;
	if (std::fabs(thetaArc) < M_PI / 1e6) {
		lineTo(p1);
		return;
	}
	auto fromUnit = [&](Vec u) { const double x = u.x * rx, y = u.y * ry; return Vec{cs * x - sn * y, sn * x + cs * y}; };
	const int segments = int(std::ceil(std::fabs(thetaArc / (2 * M_PI / 3))));
	const double width = thetaArc / segments;
	const double t = std::tan(0.5 * width);
	const double w = std::sqrt(0.5 + std::cos(width) * 0.5);
	double start = theta1;
	auto snap = [](double v) { return std::fabs(v) <= 1.0 / 4096 ? 0.0 : v; };
	auto integer = [](double v) { return v == std::floor(v); };
	// Quarter turns between whole numbers land on whole numbers, as Skia rounds them.
	const bool whole = std::fabs(M_PI / 2 - std::fabs(width)) <= 1.0 / 4096 && integer(rx) && integer(ry) && integer(p1.x) && integer(p1.y);
	auto offset = [&](Vec u) {
		Vec v = fromUnit(u);
		return whole ? Vec{std::round(v.x), std::round(v.y)} : v;
	};
	for (int i = 0; i < segments; i++) {
		const double end = start + width, s = snap(std::sin(end)), c = snap(std::cos(end));
		const Vec on{c + centre.x, s + centre.y};
		const Vec off{on.x + t * s, on.y - t * c};
		conicTo(offset(off), offset(on), w);
		start = end;
	}
	subs.back().segs.back().p = p1;
}

// Skia's `arcTo(x1, y1, x2, y2, radius)`: a line to where a circle of radius r touches the corner's two
// edges, and one conic round the corner.
void Path::arcToTangent(Vec corner, Vec next, double r) {
	ensureStarted();
	const Vec start = last();
	Vec before{corner.x - start.x, corner.y - start.y}, after{next.x - corner.x, next.y - corner.y};
	const double lb = std::hypot(before.x, before.y), la = std::hypot(after.x, after.y);
	if (r == 0 || lb == 0 || la == 0) {
		lineTo(corner);
		return;
	}
	before = {before.x / lb, before.y / lb};
	after = {after.x / la, after.y / la};
	const double cosh = before.x * after.x + before.y * after.y;
	const double sinh = before.x * after.y - before.y * after.x;
	if (std::fabs(sinh) <= 1.0 / 4096) {
		lineTo(corner);
		return;
	}
	const double d = std::fabs(r * (1 - cosh) / sinh);
	lineTo({corner.x - d * before.x, corner.y - d * before.y});
	conicTo(corner, {corner.x + d * after.x, corner.y + d * after.y}, std::sqrt(0.5 + cosh * 0.5));
}

namespace {
struct Reader {
	const char* s;
	size_t i, n;
	void space() { while (i < n && (s[i] == ' ' || s[i] == ',' || s[i] == '\n' || s[i] == '\t' || s[i] == '\r')) i++; }
	bool number(double& out) {
		space();
		const char* start = s + i;
		char* end = nullptr;
		out = std::strtod(start, &end);
		if (end == start) return false;
		i += size_t(end - start);
		return true;
	}
	bool flag(double& out) {
		space();
		if (i < n && (s[i] == '0' || s[i] == '1')) {
			out = s[i++] - '0';
			return true;
		}
		return false;
	}
};
}  // namespace

// SVG path data, read as Skia's `MakeFromSVGString` reads it: anything it cannot read and the whole is refused.
bool parseSvg(const std::string& d, Path& out) {
	Reader r{d.c_str(), 0, d.size()};
	Vec at{0, 0}, ctrl{0, 0};
	char command = 0, last = 0;
	bool any = false;
	while (true) {
		r.space();
		if (r.i >= r.n) break;
		const char c = r.s[r.i];
		if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
			command = c;
			r.i++;
		} else if (!command) return false;
		const bool rel = command >= 'a';
		const char up = char(rel ? command - 32 : command);
		const Vec o = rel ? at : Vec{0, 0};
		double v[7];
		auto nums = [&](int k) {
			for (int j = 0; j < k; j++)
				if (!r.number(v[j])) return false;
			return true;
		};
		switch (up) {
			case 'Z':
				out.close();
				at = out.last();
				last = 'Z';
				command = 0;
				continue;
			case 'M':
				if (!nums(2)) return false;
				at = {o.x + v[0], o.y + v[1]};
				out.moveTo(at);
				command = rel ? 'l' : 'L';
				last = 'M';
				any = true;
				continue;
			case 'L':
				if (!nums(2)) return false;
				at = {o.x + v[0], o.y + v[1]};
				out.lineTo(at);
				break;
			case 'H':
				if (!nums(1)) return false;
				at = {o.x + v[0], at.y};
				out.lineTo(at);
				break;
			case 'V':
				if (!nums(1)) return false;
				at = {at.x, (rel ? at.y : 0) + v[0]};
				out.lineTo(at);
				break;
			case 'C': {
				if (!nums(6)) return false;
				const Vec b{o.x + v[0], o.y + v[1]}, c2{o.x + v[2], o.y + v[3]}, e{o.x + v[4], o.y + v[5]};
				out.cubicTo(b, c2, e);
				ctrl = c2;
				at = e;
				break;
			}
			case 'S': {
				if (!nums(4)) return false;
				const Vec b = (last == 'C' || last == 'S') ? Vec{2 * at.x - ctrl.x, 2 * at.y - ctrl.y} : at;
				const Vec c2{o.x + v[0], o.y + v[1]}, e{o.x + v[2], o.y + v[3]};
				out.cubicTo(b, c2, e);
				ctrl = c2;
				at = e;
				break;
			}
			case 'Q': {
				if (!nums(4)) return false;
				const Vec b{o.x + v[0], o.y + v[1]}, e{o.x + v[2], o.y + v[3]};
				out.quadTo(b, e);
				ctrl = b;
				at = e;
				break;
			}
			case 'T': {
				if (!nums(2)) return false;
				const Vec b = (last == 'Q' || last == 'T') ? Vec{2 * at.x - ctrl.x, 2 * at.y - ctrl.y} : at;
				const Vec e{o.x + v[0], o.y + v[1]};
				out.quadTo(b, e);
				ctrl = b;
				at = e;
				break;
			}
			case 'A': {
				if (!(r.number(v[0]) && r.number(v[1]) && r.number(v[2]) && r.flag(v[3]) && r.flag(v[4]) && r.number(v[5]) && r.number(v[6]))) return false;
				const Vec e{o.x + v[5], o.y + v[6]};
				out.svgArc(v[0], v[1], v[2], v[3] != 0, v[4] != 0, e);
				at = e;
				break;
			}
			default:
				return false;
		}
		last = up;
		any = true;
	}
	return any;
}

// --- curves -----------------------------------------------------------------------------------------------

Vec Affine::apply(Vec p) const { return {a * p.x + c * p.y + e, b * p.x + d * p.y + f}; }

namespace {

Vec quadAt(Vec p0, Vec c, Vec p, double t) {
	const double u = 1 - t;
	return {u * u * p0.x + 2 * u * t * c.x + t * t * p.x, u * u * p0.y + 2 * u * t * c.y + t * t * p.y};
}
Vec cubicAt(Vec p0, Vec c1, Vec c2, Vec p, double t) {
	const double u = 1 - t;
	return {u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p.x, u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p.y};
}
// A conic in homogeneous form: numerator and denominator at t.
void conicHomo(Vec p0, Vec c, Vec p, double w, double t, double& x, double& y, double& z) {
	const double u = 1 - t, a = u * u, b = 2 * w * u * t, d = t * t;
	x = a * p0.x + b * c.x + d * p.x;
	y = a * p0.y + b * c.y + d * p.y;
	z = a + b + d;
}
Vec conicAt(Vec p0, Vec c, Vec p, double w, double t) {
	double x, y, z;
	conicHomo(p0, c, p, w, t, x, y, z);
	return {x / z, y / z};
}
// The piece of a conic between t1 and t2, itself a conic (`SkConic::chopAt`).
void conicPiece(Vec p0, Vec c, Vec p, double w, double t1, double t2, Vec out[3], double& ow) {
	double ax, ay, az, dx, dy, dz, cx, cy, cz;
	conicHomo(p0, c, p, w, t1, ax, ay, az);
	conicHomo(p0, c, p, w, (t1 + t2) / 2, dx, dy, dz);
	conicHomo(p0, c, p, w, t2, cx, cy, cz);
	const double bx = 2 * dx - (ax + cx) / 2, by = 2 * dy - (ay + cy) / 2, bz = 2 * dz - (az + cz) / 2;
	out[0] = {ax / az, ay / az};
	out[1] = {bx / bz, by / bz};
	out[2] = {cx / cz, cy / cz};
	ow = bz / std::sqrt(az * cz);
}
void quadPiece(Vec p0, Vec c, Vec p, double t1, double t2, Vec out[3]) {
	const Vec a = quadAt(p0, c, p, t1), b = quadAt(p0, c, p, t2);
	// The control point: where the tangents at the two ends meet, from the derivative at t1.
	const double h = t2 - t1;
	const Vec d1{2 * ((1 - t1) * (c.x - p0.x) + t1 * (p.x - c.x)), 2 * ((1 - t1) * (c.y - p0.y) + t1 * (p.y - c.y))};
	out[0] = a;
	out[1] = {a.x + d1.x * h / 2, a.y + d1.y * h / 2};
	out[2] = b;
}
void cubicPiece(Vec p0, Vec c1, Vec c2, Vec p, double t1, double t2, Vec out[4]) {
	auto deriv = [&](double t) {
		const double u = 1 - t;
		return Vec{3 * (u * u * (c1.x - p0.x) + 2 * u * t * (c2.x - c1.x) + t * t * (p.x - c2.x)), 3 * (u * u * (c1.y - p0.y) + 2 * u * t * (c2.y - c1.y) + t * t * (p.y - c2.y))};
	};
	const double h = (t2 - t1) / 3;
	const Vec a = cubicAt(p0, c1, c2, p, t1), b = cubicAt(p0, c1, c2, p, t2), da = deriv(t1), db = deriv(t2);
	out[0] = a;
	out[1] = {a.x + da.x * h, a.y + da.y * h};
	out[2] = {b.x - db.x * h, b.y - db.y * h};
	out[3] = b;
}

// Skia's fixed point: a pixel is 64 units, and its anti-aliasing works four times finer (`kDefaultAccuracy`).
int fdot(double v) { return int(std::lround(v * 256)); }
int cheapDistance(int dx, int dy) {
	dx = std::abs(dx), dy = std::abs(dy);
	return dx > dy ? dx + (dy >> 1) : dy + (dx >> 1);
}
int diffToShift(int dx, int dy) {
	int d = cheapDistance(dx, dy);
	d = (d + (1 << 4)) >> 5;
	return d == 0 ? 0 : (32 - __builtin_clz(unsigned(d))) >> 1;
}
int cubicDelta(int a, int b, int c, int d) {
	const int oneThird = ((a * 8 - b * 15 + 6 * c + d) * 19) >> 9;
	const int twoThird = ((a + 6 * b - c * 15 + d * 8) * 19) >> 9;
	return std::max(std::abs(oneThird), std::abs(twoThird));
}
int quadSteps(Vec p0, Vec c, Vec p) {
	const int shift = diffToShift(((fdot(c.x) << 1) - fdot(p0.x) - fdot(p.x)) >> 2, ((fdot(c.y) << 1) - fdot(p0.y) - fdot(p.y)) >> 2);
	return 1 << (shift == 0 ? 1 : std::min(shift, 6));
}
int cubicSteps(Vec p0, Vec c1, Vec c2, Vec p) {
	const int shift = diffToShift(cubicDelta(fdot(p0.x), fdot(c1.x), fdot(c2.x), fdot(p.x)), cubicDelta(fdot(p0.y), fdot(c1.y), fdot(c2.y), fdot(p.y))) + 1;
	return 1 << std::min(shift, 6);
}
// Fine steps, for a line to be stroked: each piece strays from the curve by less than a tenth of a pixel.
int fineSteps(double deviation) { return std::clamp(int(std::ceil(std::sqrt(deviation / 0.1))), 1, 512); }

// Where a quadratic's y turns, if it does inside (0, 1) (`SkChopQuadAtYExtrema`).
bool quadYTurn(double a, double b, double c, double& t) {
	const double numer = a - b, denom = a - b - b + c;
	if ((a - b) * (b - c) >= 0 || denom == 0) return false;
	t = numer / denom;
	return t > 0 && t < 1;
}
// Where a cubic's y turns inside (0, 1), in order (`SkFindCubicExtrema`).
int cubicYTurns(double a, double b, double c, double d, double t[2]) {
	const double A = d - a + 3 * (b - c), B = 2 * (a - b - b + c), C = b - a;
	int n = 0;
	auto add = [&](double r) {
		if (r > 0 && r < 1) t[n++] = r;
	};
	if (A == 0) {
		if (B != 0) add(-C / B);
	} else {
		double disc = B * B - 4 * A * C;
		if (disc >= 0) {
			disc = std::sqrt(disc);
			const double q = B < 0 ? -(B - disc) / 2 : -(B + disc) / 2;
			add(q / A);
			if (q != 0) add(C / q);
			if (n == 2) {
				if (t[0] > t[1]) std::swap(t[0], t[1]);
				else if (t[0] == t[1]) n = 1;
			}
		}
	}
	return n;
}

// Skia's hairline subdivision (`SkScan_Hairline`): a quadratic in 2^n lines until its chord is within
// about a pixel, a cubic until its control points are within an eighth of one, more for each step.
int hairQuadLines(Vec p0, Vec c, Vec p) {
	const double dx = std::fabs((p0.x + p.x) / 2 - c.x), dy = std::fabs((p0.y + p.y) / 2 - c.y);
	const unsigned ix = unsigned(std::ceil(dx)), iy = unsigned(std::ceil(dy));
	const unsigned d = ix > iy ? ix + (iy >> 1) : iy + (ix >> 1);
	int level = (33 - (d ? __builtin_clz(d) : 32)) >> 1;
	return 1 << std::min(level, 5);
}
int hairCubicLines(Vec p0, Vec c1, Vec c2, Vec p) {
	const Vec p13{p.x / 3 + p0.x * 2 / 3, p.y / 3 + p0.y * 2 / 3}, p23{p0.x / 3 + p.x * 2 / 3, p0.y / 3 + p.y * 2 / 3};
	const double diff = std::max({std::fabs(c1.x - p13.x), std::fabs(c1.y - p13.y), std::fabs(c2.x - p23.x), std::fabs(c2.y - p23.y)});
	double tol = 1.0 / 8;
	for (int i = 0; i < 9; i++) {
		if (diff < tol) return 1 << i;
		tol *= 4;
	}
	return 1 << 9;
}

struct Flattener {
	Polyline& line;
	Cut cut;
	bool skia;
	void point(Vec p, bool corner) {
		line.points.push_back(p);
		line.corner.push_back(corner ? 1 : 0);
	}
	void quad(Vec p0, Vec c, Vec p, bool endCorner) {
		const int steps = cut == Cut::HAIR ? hairQuadLines(p0, c, p) : skia ? quadSteps(p0, c, p) : fineSteps(0.5 * std::hypot(p0.x - 2 * c.x + p.x, p0.y - 2 * c.y + p.y));
		for (int k = 1; k <= steps; k++) point(k == steps ? p : quadAt(p0, c, p, double(k) / steps), k == steps && endCorner);
	}
	void quadMono(Vec p0, Vec c, Vec p, bool endCorner) {
		double t;
		if (cut == Cut::FILL && quadYTurn(p0.y, c.y, p.y, t)) {
			Vec a[3], b[3];
			quadPiece(p0, c, p, 0, t, a);
			quadPiece(p0, c, p, t, 1, b);
			// Skia flattens the turn so both halves meet level.
			a[1].y = b[1].y = a[2].y;
			b[0] = a[2];
			quad(a[0], a[1], a[2], false);
			quad(b[0], b[1], p, endCorner);
		} else quad(p0, c, p, endCorner);
	}
	void cubic(Vec p0, Vec c1, Vec c2, Vec p, bool endCorner) {
		int steps;
		if (cut == Cut::HAIR) steps = hairCubicLines(p0, c1, c2, p);
		else if (skia) steps = cubicSteps(p0, c1, c2, p);
		else {
			const double ax = p0.x - 2 * c1.x + c2.x, ay = p0.y - 2 * c1.y + c2.y, bx = c1.x - 2 * c2.x + p.x, by = c1.y - 2 * c2.y + p.y;
			steps = fineSteps(0.75 * std::sqrt(std::max(ax * ax + ay * ay, bx * bx + by * by)));
		}
		for (int k = 1; k <= steps; k++) point(k == steps ? p : cubicAt(p0, c1, c2, p, double(k) / steps), k == steps && endCorner);
	}
	void cubicMono(Vec p0, Vec c1, Vec c2, Vec p, bool endCorner) {
		double t[2];
		const int n = cut == Cut::FILL ? cubicYTurns(p0.y, c1.y, c2.y, p.y, t) : 0;
		if (!n) return cubic(p0, c1, c2, p, endCorner);
		double from = 0;
		for (int i = 0; i <= n; i++) {
			const double to = i < n ? t[i] : 1;
			Vec q[4];
			cubicPiece(p0, c1, c2, p, from, to, q);
			// Level at each turn, as Skia flattens them.
			if (i > 0) q[1].y = q[0].y;
			if (i < n) q[2].y = q[3].y;
			cubic(q[0], q[1], q[2], i == n ? p : q[3], i == n && endCorner);
			from = to;
		}
	}
	void conic(Vec p0, Vec c, Vec p, double w, bool endCorner) {
		if (cut == Cut::FINE) {
			// Fine: as many pieces as the curve's bend needs.
			const int steps = fineSteps(0.5 * std::hypot(p0.x - 2 * c.x + p.x, p0.y - 2 * c.y + p.y) * std::max(1.0, w));
			for (int k = 1; k <= steps; k++) point(k == steps ? p : conicAt(p0, c, p, w, double(k) / steps), k == steps && endCorner);
			return;
		}
		// Skia's edge builder makes a conic into 2^n quadratics, n from how far it strays (`computeQuadPOW2`).
		const double a = w - 1, k = a / (4 * (2 + a));
		const double ex = k * (p0.x - 2 * c.x + p.x), ey = k * (p0.y - 2 * c.y + p.y);
		double error = std::sqrt(ex * ex + ey * ey);
		int pow2 = 0;
		for (; pow2 < 5; pow2++) {
			if (error <= 0.25) break;
			error *= 0.25;
		}
		std::vector<Vec> pts{p0};
		subdivide(p0, c, p, w, pow2, pts);
		const size_t quads = (pts.size() - 1) / 2;
		for (size_t i = 0; i < quads; i++) quadMono(pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], i + 1 == quads && endCorner);
	}
	static void subdivide(Vec p0, Vec c, Vec p, double w, int level, std::vector<Vec>& out) {
		if (level == 0) {
			out.push_back(c);
			out.push_back(p);
			return;
		}
		// `SkConic::chop` at the middle.
		const double scale = 1 / (1 + w), newW = std::sqrt(0.5 + w * 0.5);
		const Vec wc{c.x * w, c.y * w};
		const Vec m{(p0.x + 2 * wc.x + p.x) * scale * 0.5, (p0.y + 2 * wc.y + p.y) * scale * 0.5};
		subdivide(p0, {(p0.x + wc.x) * scale, (p0.y + wc.y) * scale}, m, newW, level - 1, out);
		subdivide(m, {(wc.x + p.x) * scale, (wc.y + p.y) * scale}, p, newW, level - 1, out);
	}
};

}  // namespace

std::vector<Polyline> flatten(const Path& path, const Affine& m, Cut cut) {
	std::vector<Polyline> out;
	for (const Sub& sub : path.subs) {
		Polyline line;
		line.closed = sub.closed;
		// A contour that is only a move draws nothing, not even a cap.
		if (sub.segs.empty()) continue;
		Flattener f{line, cut, cut != Cut::FINE};
		f.point(m.apply(sub.start), true);
		Vec prev = sub.start;
		for (const Seg& seg : sub.segs) {
			const Vec p0 = m.apply(prev), c1 = m.apply(seg.c1), c2 = m.apply(seg.c2), p = m.apply(seg.p);
			switch (seg.kind) {
				case Seg::LINE: f.point(p, true); break;
				case Seg::QUAD: f.quadMono(p0, c1, p, true); break;
				case Seg::CONIC: f.conic(p0, c1, p, seg.w, true); break;
				case Seg::CUBIC: f.cubicMono(p0, c1, c2, p, true); break;
			}
			prev = seg.p;
		}
		out.push_back(std::move(line));
	}
	return out;
}

// --- dashes ---------------------------------------------------------------------------------------------
//
// Skia's `SkContourMeasure`: each curve is measured as chords, cut in half while it bends more than
// half a device pixel from its chord, and a distance along it is turned into a curve parameter by
// interpolating between the chords' ends. On a tight corner the chords are few, so a dash there lands a
// little away from the true arc length: copied, so the dashes fall where Skia's do.

namespace {

const int MAX_T = (1 << 30) - 1;
double tOf(int t) { return double(t) / MAX_T; }
bool bigEnough(int span) { return (span >> 10) != 0; }
bool exceeds(Vec p, double x, double y, double tolerance) { return std::max(std::fabs(x - p.x), std::fabs(y - p.y)) > tolerance; }

struct Measure {
	struct Piece { double distance; size_t seg; double t; };
	// The contour as segments, each with where it starts (a closing line is its own segment).
	struct Segment { Seg::Kind kind; Vec p0, c1, c2, p; double w; };
	std::vector<Segment> segs;
	std::vector<Piece> pieces;
	double length = 0, tolerance;
	bool closed;

	Measure(const Sub& sub, double resScale) : tolerance(0.5 / resScale), closed(sub.closed) {
		Vec prev = sub.start;
		for (const Seg& s : sub.segs) {
			segs.push_back({s.kind, prev, s.c1, s.c2, s.p, s.w});
			prev = s.p;
		}
		if (sub.closed && (prev.x != sub.start.x || prev.y != sub.start.y)) segs.push_back({Seg::LINE, prev, {}, {}, sub.start, 1});
		double d = 0;
		for (size_t i = 0; i < segs.size(); i++) {
			const Segment& s = segs[i];
			switch (s.kind) {
				case Seg::LINE: {
					const double next = d + dist(s.p0, s.p);
					if (next > d) pieces.push_back({next, i, 1}), d = next;
					break;
				}
				case Seg::QUAD: d = quad(s.p0, s.c1, s.p, d, 0, MAX_T, i); break;
				case Seg::CONIC: d = conic(s, d, 0, s.p0, MAX_T, s.p, i); break;
				case Seg::CUBIC: d = cubic(s.p0, s.c1, s.c2, s.p, d, 0, MAX_T, i); break;
			}
		}
		length = d;
	}
	void push(double& d, double add, size_t i, int t) {
		const double next = d + add;
		if (next > d) pieces.push_back({next, i, tOf(t)}), d = next;
	}
	double quad(Vec a, Vec b, Vec c, double d, int mint, int maxt, size_t i) {
		const double dx = b.x / 2 - (a.x + c.x) / 4, dy = b.y / 2 - (a.y + c.y) / 4;
		if (bigEnough(maxt - mint) && std::max(std::fabs(dx), std::fabs(dy)) > tolerance) {
			const int half = (mint + maxt) >> 1;
			const Vec ab = lerp(a, b, 0.5), bc = lerp(b, c, 0.5), m = lerp(ab, bc, 0.5);
			d = quad(a, ab, m, d, mint, half, i);
			return quad(m, bc, c, d, half, maxt, i);
		}
		push(d, dist(a, c), i, maxt);
		return d;
	}
	double conic(const Segment& s, double d, int mint, Vec minPt, int maxt, Vec maxPt, size_t i) {
		const int half = (mint + maxt) >> 1;
		const Vec halfPt = conicAt(s.p0, s.c1, s.p, s.w, tOf(half));
		if (bigEnough(maxt - mint) && exceeds(halfPt, (minPt.x + maxPt.x) / 2, (minPt.y + maxPt.y) / 2, tolerance)) {
			d = conic(s, d, mint, minPt, half, halfPt, i);
			return conic(s, d, half, halfPt, maxt, maxPt, i);
		}
		push(d, dist(minPt, maxPt), i, maxt);
		return d;
	}
	double cubic(Vec a, Vec b, Vec c, Vec e, double d, int mint, int maxt, size_t i) {
		const bool curvy = exceeds(b, a.x + (e.x - a.x) / 3, a.y + (e.y - a.y) / 3, tolerance) || exceeds(c, a.x + (e.x - a.x) * 2 / 3, a.y + (e.y - a.y) * 2 / 3, tolerance);
		if (bigEnough(maxt - mint) && curvy) {
			const int half = (mint + maxt) >> 1;
			const Vec ab = lerp(a, b, 0.5), bc = lerp(b, c, 0.5), ce = lerp(c, e, 0.5), abc = lerp(ab, bc, 0.5), bce = lerp(bc, ce, 0.5), m = lerp(abc, bce, 0.5);
			d = cubic(a, ab, abc, m, d, mint, half, i);
			return cubic(m, bce, ce, e, d, half, maxt, i);
		}
		push(d, dist(a, e), i, maxt);
		return d;
	}
	// The piece a distance falls in, and its curve parameter there.
	size_t find(double distance, double& t) const {
		size_t lo = 0, hi = pieces.size() - 1;
		while (lo < hi) {
			const size_t mid = (lo + hi) / 2;
			if (pieces[mid].distance < distance) lo = mid + 1;
			else hi = mid;
		}
		const Piece& p = pieces[lo];
		double startT = 0, startD = 0;
		if (lo > 0) {
			startD = pieces[lo - 1].distance;
			if (pieces[lo - 1].seg == p.seg) startT = pieces[lo - 1].t;
		}
		t = startT + (p.t - startT) * (distance - startD) / (p.distance - startD);
		return lo;
	}
	Vec at(size_t seg, double t) const {
		const Segment& s = segs[seg];
		switch (s.kind) {
			case Seg::LINE: return lerp(s.p0, s.p, t);
			case Seg::QUAD: return quadAt(s.p0, s.c1, s.p, t);
			case Seg::CONIC: return conicAt(s.p0, s.c1, s.p, s.w, t);
			case Seg::CUBIC: return cubicAt(s.p0, s.c1, s.c2, s.p, t);
		}
		return s.p;
	}
	// Part of one segment, from t1 to t2, onto the path (`SkContourMeasure_segTo`).
	void segTo(size_t seg, double t1, double t2, Path& out) const {
		const Segment& s = segs[seg];
		if (t1 == t2) {
			// A dash of no length is a line of no length, which a round or square cap still shows.
			out.lineTo(out.last());
			return;
		}
		switch (s.kind) {
			case Seg::LINE: out.lineTo(t2 == 1 ? s.p : lerp(s.p0, s.p, t2)); break;
			case Seg::QUAD: {
				Vec q[3];
				quadPiece(s.p0, s.c1, s.p, t1, t2, q);
				out.quadTo(q[1], t2 == 1 ? s.p : q[2]);
				break;
			}
			case Seg::CONIC: {
				Vec q[3];
				double w;
				conicPiece(s.p0, s.c1, s.p, s.w, t1, t2, q, w);
				out.conicTo(q[1], t2 == 1 ? s.p : q[2], w);
				break;
			}
			case Seg::CUBIC: {
				Vec q[4];
				cubicPiece(s.p0, s.c1, s.c2, s.p, t1, t2, q);
				out.cubicTo(q[1], q[2], t2 == 1 ? s.p : q[3]);
				break;
			}
		}
	}
	void segment(double startD, double stopD, Path& out, bool moveFirst) const {
		startD = std::max(0.0, startD);
		stopD = std::min(length, stopD);
		if (!(startD <= stopD) || pieces.empty()) return;
		double startT, stopT;
		size_t a = find(startD, startT);
		const size_t b = find(stopD, stopT);
		if (moveFirst) out.moveTo(at(pieces[a].seg, startT));
		if (pieces[a].seg == pieces[b].seg) {
			segTo(pieces[a].seg, startT, stopT, out);
			return;
		}
		size_t seg = pieces[a].seg;
		segTo(seg, startT, 1, out);
		for (seg++; seg < pieces[b].seg; seg++) segTo(seg, 0, 1, out);
		segTo(pieces[b].seg, 0, stopT, out);
	}
};

}  // namespace

// Where `fraction` of a path's first contour's length falls, measured as Skia's contour measure measures
// it (`getPosTan`); false for a path of no length.
bool pointAlong(const Path& path, double fraction, double resScale, Vec& out) {
	for (const Sub& sub : path.subs) {
		const Measure m(sub, resScale);
		if (m.length <= 0) continue;
		double t;
		const size_t piece = m.find(m.length * fraction, t);
		out = m.at(m.pieces[piece].seg, t);
		return true;
	}
	return false;
}

// A path cut into dashes, `SkDashPath` laying `pattern` (on, off, …) along each contour from its start.
Path dash(const Path& path, const std::vector<double>& pattern, double resScale) {
	double total = 0;
	for (double v : pattern) total += v;
	if (pattern.size() < 2 || pattern.size() % 2 || total <= 0) return path;
	Path out;
	for (const Sub& sub : path.subs) {
		const Measure m(sub, resScale);
		if (m.length <= 0) continue;
		// A closed contour skips its first dash, and draws it at the end, joined to the last if that was on.
		bool skipFirst = m.closed, added = false;
		size_t index = 0;
		double distance = 0, len = pattern[0];
		while (distance < m.length) {
			added = false;
			if (index % 2 == 0 && !skipFirst) {
				added = true;
				m.segment(distance, distance + len, out, true);
			}
			distance += len;
			skipFirst = false;
			index = (index + 1) % pattern.size();
			len = pattern[index];
		}
		if (m.closed) m.segment(0, pattern[0], out, !added);
	}
	return out;
}

// --- strokes ------------------------------------------------------------------------------------------

namespace {
void addRing(std::vector<Polyline>& out, std::vector<Vec> pts) {
	if (pts.size() < 3) return;
	double area = 0;
	for (size_t i = 0; i < pts.size(); i++) {
		const Vec& a = pts[i];
		const Vec& b = pts[(i + 1) % pts.size()];
		area += a.x * b.y - b.x * a.y;
	}
	// All one way round, so the non-zero rule makes them one shape.
	if (area < 0) std::reverse(pts.begin(), pts.end());
	Polyline ring;
	ring.closed = true;
	ring.points = std::move(pts);
	out.push_back(std::move(ring));
}
// The pie slice of a circle round `c` from `a` to `b` (both on it), the short way, or the half facing
// `toward` when they are opposite.
void addWedge(std::vector<Polyline>& out, Vec c, Vec a, Vec b, double r, Vec toward = {0, 0}) {
	double a1 = std::atan2(a.y - c.y, a.x - c.x), a2 = std::atan2(b.y - c.y, b.x - c.x);
	double sweep = a2 - a1;
	while (sweep > M_PI) sweep -= 2 * M_PI;
	while (sweep < -M_PI) sweep += 2 * M_PI;
	if (std::fabs(std::fabs(sweep) - M_PI) < 1e-9 && (toward.x != 0 || toward.y != 0)) {
		// Through the side `toward` points to.
		const double mid = a1 + M_PI / 2;
		sweep = (std::cos(mid) * toward.x + std::sin(mid) * toward.y) >= 0 ? M_PI : -M_PI;
	}
	const int n = std::clamp(int(std::ceil(r * std::fabs(sweep))), 2, 128);
	std::vector<Vec> pts{c};
	for (int i = 0; i <= n; i++) {
		const double t = a1 + sweep * i / n;
		pts.push_back({c.x + r * std::cos(t), c.y + r * std::sin(t)});
	}
	addRing(out, std::move(pts));
}
void addCircle(std::vector<Polyline>& out, Vec c, double r) {
	const int n = std::clamp(int(std::ceil(r * 2)), 8, 128);
	std::vector<Vec> pts;
	for (int i = 0; i < n; i++) pts.push_back({c.x + r * std::cos(2 * M_PI * i / n), c.y + r * std::sin(2 * M_PI * i / n)});
	addRing(out, std::move(pts));
}
}  // namespace

// Lines cut into dashes: on for `pattern[0]`, off for `pattern[1]`, and so on, from the start of each.

std::vector<Polyline> stroke(const std::vector<Polyline>& lines, double width, Cap cap, Join join, double miterLimit) {
	std::vector<Polyline> out;
	const double h = width / 2;
	if (h <= 0) return out;
	for (const Polyline& line : lines) {
		// Points one apart, so no piece has no length.
		std::vector<Vec> pts;
		std::vector<char> corner;
		for (size_t i = 0; i < line.points.size(); i++) {
			const Vec& p = line.points[i];
			if (!pts.empty() && std::fabs(p.x - pts.back().x) < 1e-9 && std::fabs(p.y - pts.back().y) < 1e-9) {
				if (i < line.corner.size() && line.corner[i]) corner.back() = 1;
				continue;
			}
			pts.push_back(p);
			corner.push_back(i < line.corner.size() ? line.corner[i] : 1);
		}
		bool closed = line.closed;
		if (closed && pts.size() > 1 && std::fabs(pts.front().x - pts.back().x) < 1e-9 && std::fabs(pts.front().y - pts.back().y) < 1e-9) pts.pop_back();
		const size_t n = pts.size();
		if (n == 1) {
			// A dot: a round or a square cap shows it; a flat one does not.
			if (cap == Cap::ROUND) addCircle(out, pts[0], h);
			else if (cap == Cap::SQUARE) addRing(out, {{pts[0].x - h, pts[0].y - h}, {pts[0].x + h, pts[0].y - h}, {pts[0].x + h, pts[0].y + h}, {pts[0].x - h, pts[0].y + h}});
			continue;
		}
		if (n < 2) continue;
		const size_t segs = closed ? n : n - 1;
		for (size_t i = 0; i < segs; i++) {
			const Vec a = pts[i], b = pts[(i + 1) % n];
			const double dx = b.x - a.x, dy = b.y - a.y, len = std::hypot(dx, dy);
			const double ux = dx / len, uy = dy / len, nx = -uy * h, ny = ux * h;
			Vec a0 = a, b0 = b;
			// A square cap reaches half the width past each open end.
			if (!closed && cap == Cap::SQUARE) {
				if (i == 0) a0 = {a.x - ux * h, a.y - uy * h};
				if (i == segs - 1) b0 = {b.x + ux * h, b.y + uy * h};
			}
			addRing(out, {{a0.x + nx, a0.y + ny}, {b0.x + nx, b0.y + ny}, {b0.x - nx, b0.y - ny}, {a0.x - nx, a0.y - ny}});
		}
		// Joins: at each corner the stroke turns, the wedge outside the two pieces.
		const size_t first = closed ? 0 : 1, lastJoin = closed ? n : n - 1;
		for (size_t k = first; k < lastJoin; k++) {
			const Vec p = pts[(k + n - 1) % n], v = pts[k % n], q = pts[(k + 1) % n];
			double ax = v.x - p.x, ay = v.y - p.y, bx = q.x - v.x, by = q.y - v.y;
			const double la = std::hypot(ax, ay), lb = std::hypot(bx, by);
			ax /= la, ay /= la, bx /= lb, by /= lb;
			const double cross = ax * by - ay * bx;
			if (std::fabs(cross) < 1e-12 && ax * bx + ay * by > 0) continue;
			// Inside a curve the line bends smoothly: a round join is the curve's own offset.
			const Join here = corner[k % n] ? join : Join::ROUND;
			const double side = cross > 0 ? -1 : 1;  // the outer side, away from the turn
			const Vec n1{v.x - ay * side * h, v.y + ax * side * h};
			const Vec n2{v.x - by * side * h, v.y + bx * side * h};
			if (here == Join::ROUND) {
				// Only the wedge outside the turn, as Skia's round join: a whole circle would reach back
				// past a dash's flat end on a tight corner.
				addWedge(out, v, n1, n2, h);
				continue;
			}
			const double cosTheta = std::clamp(-(ax * bx + ay * by), -1.0, 1.0);
			const double sinHalf = std::sqrt(std::max(0.0, (1 - cosTheta) / 2));
			if (here == Join::MITER && sinHalf > 0 && 1 / sinHalf <= miterLimit) {
				const double t = ((n2.x - n1.x) * by - (n2.y - n1.y) * bx) / (ax * by - ay * bx);
				addRing(out, {v, n1, {n1.x + ax * t, n1.y + ay * t}, n2});
			} else addRing(out, {v, n1, n2});
		}
		if (!closed && cap == Cap::ROUND) {
			// Half a disc past each end, facing out along the line.
			auto cap = [&](Vec end, Vec from) {
				const double dx = end.x - from.x, dy = end.y - from.y, l = std::hypot(dx, dy);
				const double nx = -dy / l * h, ny = dx / l * h;
				addWedge(out, end, {end.x + nx, end.y + ny}, {end.x - nx, end.y - ny}, h, {dx / l, dy / l});
			};
			cap(pts[0], pts[1]);
			cap(pts[n - 1], pts[n - 2]);
		}
	}
	return out;
}

// A hairline's lines, as Skia draws them: open ends with a round or square cap half a pixel longer.
std::vector<Polyline> hairline(const std::vector<Polyline>& lines, Cap cap) {
	std::vector<Polyline> out;
	for (const Polyline& line : lines) {
		Polyline l;
		l.points = line.points;
		if (line.closed && l.points.size() > 1) l.points.push_back(l.points.front());
		if (l.points.size() < 2) continue;
		if (!line.closed && cap != Cap::BUTT) {
			auto extend = [](Vec& end, Vec from) {
				const double d = dist(from, end);
				if (d > 0) end = {end.x + (end.x - from.x) / d * 0.5, end.y + (end.y - from.y) / d * 0.5};
			};
			extend(l.points.front(), l.points[1]);
			extend(l.points.back(), l.points[l.points.size() - 2]);
		}
		out.push_back(std::move(l));
	}
	return out;
}

// Skia's anti-aliased hairline (`SkScan_Antihair`): along the major axis each pixel is covered by the
// share of it the line spans; across, the line's position at the pixel's centre splits that between the
// two pixels it falls between. Each piece is laid over the others, 1 - (1 - a)(1 - b).
Mask hairMask(const std::vector<Polyline>& lines, int left, int top, int right, int bottom) {
	Mask out;
	double x0 = 1e300, y0 = 1e300, x1 = -1e300, y1 = -1e300;
	for (const Polyline& l : lines)
		for (const Vec& p : l.points) x0 = std::min(x0, p.x), y0 = std::min(y0, p.y), x1 = std::max(x1, p.x), y1 = std::max(y1, p.y);
	if (x0 > x1) return out;
	out.x = std::max(left, int(std::floor(x0)) - 1);
	out.y = std::max(top, int(std::floor(y0)) - 1);
	out.w = std::min(right, int(std::ceil(x1)) + 2) - out.x;
	out.h = std::min(bottom, int(std::ceil(y1)) + 2) - out.y;
	if (out.w <= 0 || out.h <= 0) return Mask{};
	std::vector<float> uncovered(size_t(out.w) * size_t(out.h), 1.f), piece(uncovered.size(), 0.f);
	std::vector<size_t> touched;
	auto add = [&](int px, int py, double c) {
		if (c <= 0 || px < out.x || py < out.y || px >= out.x + out.w || py >= out.y + out.h) return;
		const size_t i = size_t(py - out.y) * size_t(out.w) + size_t(px - out.x);
		if (piece[i] == 0) touched.push_back(i);
		piece[i] = float(std::min(1.0, piece[i] + c));
	};
	for (const Polyline& l : lines)
		for (size_t k = 0; k + 1 < l.points.size(); k++) {
			Vec a = l.points[k], b = l.points[k + 1];
			if (a.x == b.x && a.y == b.y) continue;
			const bool xMajor = std::fabs(b.x - a.x) >= std::fabs(b.y - a.y);
			// Work along the major axis, u, with the minor one, v.
			double ua = xMajor ? a.x : a.y, ub = xMajor ? b.x : b.y, va = xMajor ? a.y : a.x, vb = xMajor ? b.y : b.x;
			if (ua > ub) std::swap(ua, ub), std::swap(va, vb);
			const double slope = (vb - va) / (ub - ua);
			for (int u = int(std::floor(ua)); u < int(std::ceil(ub)); u++) {
				const double span = std::min(ub, u + 1.0) - std::max(ua, double(u));
				if (span <= 0) continue;
				const double v = va + (u + 0.5 - ua) * slope - 0.5;
				const int v0 = int(std::floor(v));
				const double f = v - v0;
				if (xMajor) add(u, v0, span * (1 - f)), add(u, v0 + 1, span * f);
				else add(v0, u, span * (1 - f)), add(v0 + 1, u, span * f);
			}
			for (size_t i : touched) uncovered[i] *= 1 - piece[i], piece[i] = 0;
			touched.clear();
		}
	out.a.resize(uncovered.size());
	for (size_t i = 0; i < uncovered.size(); i++) out.a[i] = uint8_t(std::lround((1 - uncovered[i]) * 255));
	return out;
}

// --- coverage -------------------------------------------------------------------------------------------

Mask rasterize(const std::vector<Polyline>& rings, bool evenOdd, int left, int top, int right_, int bottom_, bool snap) {
	Mask mask;
	double x0 = 1e300, y0 = 1e300, x1 = -1e300, y1 = -1e300;
	for (const Polyline& r : rings)
		for (const Vec& p : r.points) {
			x0 = std::min(x0, p.x), y0 = std::min(y0, p.y), x1 = std::max(x1, p.x), y1 = std::max(y1, p.y);
		}
	if (x0 > x1) return mask;
	mask.x = std::max(left, int(std::floor(x0)));
	mask.y = std::max(top, int(std::floor(y0)));
	const int right = std::min(right_, int(std::ceil(x1)));
	const int bottom = std::min(bottom_, int(std::ceil(y1)));
	mask.w = right - mask.x;
	mask.h = bottom - mask.y;
	if (mask.w <= 0 || mask.h <= 0) {
		mask.w = mask.h = 0;
		return mask;
	}
	struct Edge { double x0, y0, x1, y1; int dir; };
	std::vector<Edge> edges;
	for (const Polyline& r : rings) {
		const size_t n = r.points.size();
		if (n < 2) continue;
		for (size_t i = 0; i < n; i++) {
			const Vec a = r.points[i], b = r.points[(i + 1) % n];
			if (a.y == b.y) continue;
			if (snap) {
				// Skia's analytic rasteriser starts and ends each edge on a quarter pixel (`SnapY`), along the
				// same line, and drops one that no longer spans one.
				const double slope = (b.x - a.x) / (b.y - a.y);
				const double ya = std::floor(a.y * 4 + 0.5) / 4, yb = std::floor(b.y * 4 + 0.5) / 4;
				if (ya == yb) continue;
				const Vec sa{a.x + (ya - a.y) * slope, ya}, sb{a.x + (yb - a.y) * slope, yb};
				edges.push_back(sa.y < sb.y ? Edge{sa.x, sa.y, sb.x, sb.y, 1} : Edge{sb.x, sb.y, sa.x, sa.y, -1});
				continue;
			}
			edges.push_back(a.y < b.y ? Edge{a.x, a.y, b.x, b.y, 1} : Edge{b.x, b.y, a.x, a.y, -1});
		}
	}
	constexpr int S = 16;
	std::vector<float> row(size_t(mask.w) + 2);
	std::vector<std::pair<double, int>> hits;
	mask.a.assign(size_t(mask.w) * size_t(mask.h), 0);
	for (int py = 0; py < mask.h; py++) {
		std::fill(row.begin(), row.end(), 0.f);
		for (int s = 0; s < S; s++) {
			const double y = mask.y + py + (s + 0.5) / S;
			hits.clear();
			for (const Edge& e : edges)
				if (y >= e.y0 && y < e.y1) hits.push_back({e.x0 + (y - e.y0) / (e.y1 - e.y0) * (e.x1 - e.x0), e.dir});
			if (hits.size() < 2) continue;
			std::sort(hits.begin(), hits.end());
			int winding = 0;
			for (size_t k = 0; k + 1 < hits.size(); k++) {
				winding += hits[k].second;
				const bool inside = evenOdd ? (winding & 1) : winding != 0;
				if (!inside) continue;
				// The span [xa, xb), its exact share of each pixel it crosses.
				double xa = hits[k].first - mask.x, xb = hits[k + 1].first - mask.x;
				xa = std::max(0.0, xa), xb = std::min(double(mask.w), xb);
				if (xb <= xa) continue;
				const int ia = int(xa), ib = int(xb);
				if (ia == ib) row[size_t(ia)] += float(xb - xa);
				else {
					row[size_t(ia)] += float(ia + 1 - xa);
					for (int x = ia + 1; x < ib; x++) row[size_t(x)] += 1;
					if (ib < mask.w) row[size_t(ib)] += float(xb - ib);
				}
			}
		}
		uint8_t* out = &mask.a[size_t(py) * size_t(mask.w)];
		for (int x = 0; x < mask.w; x++) out[x] = uint8_t(std::lround(std::min(1.f, row[size_t(x)] / S) * 255));
	}
	return mask;
}

// A Gaussian blur of `sigma` pixels, three box blurs wide enough to stand for it; the mask grows to hold it.
Mask blur(const Mask& in, double sigma) {
	if (sigma <= 0 || in.w == 0) return in;
	const int pad = int(std::ceil(sigma * 3)) + 1;
	Mask out;
	out.x = in.x - pad;
	out.y = in.y - pad;
	out.w = in.w + pad * 2;
	out.h = in.h + pad * 2;
	std::vector<float> a(size_t(out.w) * size_t(out.h), 0.f), b(a.size());
	for (int y = 0; y < in.h; y++)
		for (int x = 0; x < in.w; x++) a[size_t(y + pad) * size_t(out.w) + size_t(x + pad)] = in.a[size_t(y) * size_t(in.w) + size_t(x)] / 255.f;
	// One pass along rows or columns with a kernel of weights at offsets lo..lo+n-1.
	auto pass = [&](const std::vector<float>& src, std::vector<float>& dst, const std::vector<double>& kernel, int lo, bool horizontal) {
		const int len = horizontal ? out.w : out.h, lines = horizontal ? out.h : out.w;
		for (int l = 0; l < lines; l++)
			for (int i = 0; i < len; i++) {
				double acc = 0;
				for (size_t k = 0; k < kernel.size(); k++) {
					const int j = i + lo + int(k);
					if (j < 0 || j >= len) continue;
					acc += kernel[k] * (horizontal ? src[size_t(l) * size_t(out.w) + size_t(j)] : src[size_t(j) * size_t(out.w) + size_t(l)]);
				}
				(horizontal ? dst[size_t(l) * size_t(out.w) + size_t(i)] : dst[size_t(i) * size_t(out.w) + size_t(l)]) = float(acc);
			}
	};
	auto both = [&](const std::vector<double>& kernel, int lo) {
		pass(a, b, kernel, lo, true);
		pass(b, a, kernel, lo, false);
	};
	if (sigma < 2) {
		// A small blur is a Gaussian, as Skia's `SkMaskBlurFilter` draws one below sigma 2.
		const int r = int(std::ceil(sigma * 3));
		std::vector<double> kernel;
		double sum = 0;
		for (int i = -r; i <= r; i++) kernel.push_back(std::exp(-double(i * i) / (2 * sigma * sigma))), sum += kernel.back();
		for (double& k : kernel) k /= sum;
		both(kernel, -r);
	} else {
		// A larger one is three box blurs of Skia's window: an odd window three times centred; an even one
		// once to each side and once a pixel wider, centred.
		const int window = int(std::floor(sigma * 3 * std::sqrt(2 * M_PI) / 4 + 0.5));
		auto box = [](int n) { return std::vector<double>(size_t(n), 1.0 / n); };
		if (window % 2) {
			for (int i = 0; i < 3; i++) both(box(window), -(window / 2));
		} else {
			both(box(window), -(window / 2));
			both(box(window), -(window / 2) + 1);
			both(box(window + 1), -(window / 2));
		}
	}
	out.a.resize(a.size());
	for (size_t i = 0; i < a.size(); i++) out.a[i] = uint8_t(std::lround(std::clamp(a[i], 0.f, 1.f) * 255));
	return out;
}

// `a` times `b`, or `a` less `b`, pixel by pixel, over `a`'s area: an inside or an outside stroke.
Mask combine(const Mask& a, const Mask& b, bool keepInside) {
	Mask out = a;
	for (int y = 0; y < a.h; y++)
		for (int x = 0; x < a.w; x++) {
			const int bx = a.x + x - b.x, by = a.y + y - b.y;
			const float cb = (bx >= 0 && by >= 0 && bx < b.w && by < b.h) ? b.a[size_t(by) * size_t(b.w) + size_t(bx)] / 255.f : 0.f;
			const float ca = a.a[size_t(y) * size_t(a.w) + size_t(x)] / 255.f;
			out.a[size_t(y) * size_t(a.w) + size_t(x)] = uint8_t(std::lround((keepInside ? ca * cb : ca * (1 - cb)) * 255));
		}
	return out;
}

}  // namespace raster
