// Picking: what is under the pointer, and what a marquee holds. The page's copy of the scene, fed
// with the boxes the worker laid out (the page has no fonts to lay words out itself), so a press is
// answered on the page at once. Ported from `apps/web/src/canvas/pen/layer.ts` (`hitTest`,
// `within`, `onPath`) and `spatial.ts`; `test/pick-diff.mjs` holds it to them.
//
// A path is hit on its line, not in its box: its geometry is read here once per change, flattened
// into straight pieces, and a point is on it when it lies within half the line's width of a piece,
// or inside it (non-zero winding) when it is filled, as a canvas's `isPointInStroke` and
// `isPointInPath` answer.
#include <emscripten/emscripten.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <numeric>
#include <string>
#include <vector>

namespace {

enum Flag : int {
	SKIP_PRESS = 1,    // never the answer to a press: a group, a board, the inside of an instance
	SKIP_MARQUEE = 2,  // never selected by a marquee: a board, the inside of an instance
	IN_SHAPE = 4,      // a shape's outline or words, never picked apart from it by a marquee
	FILLED = 8,        // a path with a fill, hit inside as well as on its line
};

// A point of a flattened path; `corner` is false for one cut out of a curve, where the line bends smoothly.
struct Pt { double x, y; bool corner = true; };
// A path flattened: its subpaths, each a run of points in the path's own units.
// `starts` and `ends`: the true direction of each run where it begins and ends, which its flat caps
// face; the first and last pieces cut from a curve point a little elsewhere.
struct Flat { std::vector<std::vector<Pt>> runs; std::vector<char> closed; std::vector<Pt> starts, ends; bool ok = false; };

struct Item {
	bool live = false;
	double bx, by, bw, bh;  // what it covers (`bounds.ts`), what the index and the box test use
	double px, py, pw, ph;  // its laid-out box, which a path's viewBox is mapped onto
	double order;
	int parent = -1;
	int flags = 0;
	double vb[4] = {0, 0, 0, 0};  // a path's viewBox; zero size when it has no geometry
	double strokeWidth = 0;
	bool hasGeometry = false;  // a path with geometry text, even text that reads as nothing
	Flat flat;
};

std::vector<Item> items;
std::vector<int> freeItems;
std::vector<double> io(64);
std::vector<int> found;

// --- an SVG path, read the way a browser reads one -------------------------------------------------

struct Reader {
	const char* s;
	size_t i = 0, n;
	void space() { while (i < n && (std::isspace((unsigned char)s[i]) || s[i] == ',')) i++; }
	bool number(double& out) {
		space();
		const char* start = s + i;
		char* end = nullptr;
		out = std::strtod(start, &end);
		if (end == start) return false;
		i += size_t(end - start);
		return true;
	}
	// An arc's flag is one character, so "a 5 5 0 01 10 10" reads as flags 0 and 1.
	bool flag(double& out) {
		space();
		if (i < n && (s[i] == '0' || s[i] == '1')) {
			out = s[i++] - '0';
			return true;
		}
		return false;
	}
};

void addCubic(std::vector<Pt>& run, Pt a, Pt b, Pt c, Pt d) {
	const int steps = 64;
	for (int k = 1; k <= steps; k++) {
		double t = double(k) / steps, u = 1 - t;
		run.push_back({u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x, u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y, k == steps});
	}
}
void addQuad(std::vector<Pt>& run, Pt a, Pt b, Pt c) {
	const int steps = 48;
	for (int k = 1; k <= steps; k++) {
		double t = double(k) / steps, u = 1 - t;
		run.push_back({u * u * a.x + 2 * u * t * b.x + t * t * c.x, u * u * a.y + 2 * u * t * b.y + t * t * c.y, k == steps});
	}
}
// An elliptical arc from its end points (SVG's notation) to points along it.
void addArc(std::vector<Pt>& run, Pt p0, double rx, double ry, double angle, bool large, bool sweep, Pt p1) {
	if (p0.x == p1.x && p0.y == p1.y) return;
	rx = std::fabs(rx);
	ry = std::fabs(ry);
	if (rx == 0 || ry == 0) {
		run.push_back(p1);
		return;
	}
	const double phi = angle * M_PI / 180, cs = std::cos(phi), sn = std::sin(phi);
	const double dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
	const double x1 = cs * dx + sn * dy, y1 = -sn * dx + cs * dy;
	double lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
	if (lambda > 1) {
		rx *= std::sqrt(lambda);
		ry *= std::sqrt(lambda);
	}
	double num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
	double den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
	double co = den == 0 ? 0 : std::sqrt(std::max(0.0, num / den));
	if (large == sweep) co = -co;
	const double cx1 = co * rx * y1 / ry, cy1 = -co * ry * x1 / rx;
	const double cx = cs * cx1 - sn * cy1 + (p0.x + p1.x) / 2, cy = sn * cx1 + cs * cy1 + (p0.y + p1.y) / 2;
	auto ang = [](double ux, double uy, double vx, double vy) {
		double a = std::atan2(ux * vy - uy * vx, ux * vx + uy * vy);
		return a;
	};
	double t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
	double dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
	if (!sweep && dt > 0) dt -= 2 * M_PI;
	if (sweep && dt < 0) dt += 2 * M_PI;
	const int steps = std::max(8, int(std::ceil(std::fabs(dt) / (M_PI / 96))));
	for (int k = 1; k <= steps; k++) {
		double t = t1 + dt * k / steps;
		double ex = rx * std::cos(t), ey = ry * std::sin(t);
		run.push_back({cs * ex - sn * ey + cx, sn * ex + cs * ey + cy, k == steps});
	}
	run.back() = Pt{p1.x, p1.y, true};
}

Flat flatten(const std::string& d) {
	Flat out;
	Reader r{d.c_str(), 0, d.size()};
	Pt at{0, 0}, start{0, 0}, ctrl{0, 0};
	char last = 0, command = 0;
	std::vector<Pt>* run = nullptr;
	auto begin = [&](Pt p) {
		out.runs.push_back({p});
		out.closed.push_back(0);
		out.starts.push_back({0, 0});
		out.ends.push_back({0, 0});
		run = &out.runs.back();
		start = p;
	};
	auto ensure = [&]() {
		if (!run) begin(at);
	};
	// A segment's direction where it leaves `from` and where it arrives: kept for the run's first and last.
	auto directions = [&](Pt leave, Pt arrive) {
		if (run->size() == 1 && (leave.x != 0 || leave.y != 0)) out.starts.back() = leave;
		if (arrive.x != 0 || arrive.y != 0) out.ends.back() = arrive;
	};
	auto towards = [](Pt a, Pt b, Pt c, Pt d) {
		// The first of b, c, d that is not where a is.
		for (Pt q : {b, c, d})
			if (q.x != a.x || q.y != a.y) return Pt{q.x - a.x, q.y - a.y};
		return Pt{0, 0};
	};
	while (true) {
		r.space();
		if (r.i >= r.n) break;
		char c = r.s[r.i];
		if (std::isalpha((unsigned char)c)) {
			command = c;
			r.i++;
		} else if (!command) break;
		const bool rel = std::islower((unsigned char)command);
		const char up = char(std::toupper((unsigned char)command));
		const Pt o = rel ? at : Pt{0, 0};
		double v[7];
		bool good = true;
		auto nums = [&](int k) {
			for (int j = 0; j < k; j++)
				if (!r.number(v[j])) return false;
			return true;
		};
		switch (up) {
			case 'Z':
				if (run) {
					run->push_back(start);
					out.closed.back() = 1;
					at = start;
					run = nullptr;
				}
				last = 'Z';
				// A Z takes no numbers: the next letter must come.
				command = 0;
				continue;
			case 'M':
				if (!(good = nums(2))) break;
				at = {o.x + v[0], o.y + v[1]};
				begin(at);
				// Further pairs after a move are lines.
				command = rel ? 'l' : 'L';
				last = 'M';
				continue;
			case 'L':
				if (!(good = nums(2))) break;
				ensure();
				directions({o.x + v[0] - at.x, o.y + v[1] - at.y}, {o.x + v[0] - at.x, o.y + v[1] - at.y});
				at = {o.x + v[0], o.y + v[1]};
				run->push_back(at);
				break;
			case 'H':
				if (!(good = nums(1))) break;
				ensure();
				directions({o.x + v[0] - at.x, 0}, {o.x + v[0] - at.x, 0});
				at = {o.x + v[0], at.y};
				run->push_back(at);
				break;
			case 'V':
				if (!(good = nums(1))) break;
				ensure();
				directions({0, (rel ? at.y : 0) + v[0] - at.y}, {0, (rel ? at.y : 0) + v[0] - at.y});
				at = {at.x, (rel ? at.y : 0) + v[0]};
				run->push_back(at);
				break;
			case 'C': {
				if (!(good = nums(6))) break;
				ensure();
				Pt b{o.x + v[0], o.y + v[1]}, c2{o.x + v[2], o.y + v[3]}, e{o.x + v[4], o.y + v[5]};
				{
					Pt back = towards(e, c2, b, at);
					directions(towards(at, b, c2, e), {-back.x, -back.y});
				}
				addCubic(*run, at, b, c2, e);
				ctrl = c2;
				at = e;
				break;
			}
			case 'S': {
				if (!(good = nums(4))) break;
				ensure();
				Pt b = (last == 'C' || last == 'S') ? Pt{2 * at.x - ctrl.x, 2 * at.y - ctrl.y} : at;
				Pt c2{o.x + v[0], o.y + v[1]}, e{o.x + v[2], o.y + v[3]};
				{
					Pt back = towards(e, c2, b, at);
					directions(towards(at, b, c2, e), {-back.x, -back.y});
				}
				addCubic(*run, at, b, c2, e);
				ctrl = c2;
				at = e;
				break;
			}
			case 'Q': {
				if (!(good = nums(4))) break;
				ensure();
				Pt b{o.x + v[0], o.y + v[1]}, e{o.x + v[2], o.y + v[3]};
				{
					Pt back = towards(e, b, at, at);
					directions(towards(at, b, e, e), {-back.x, -back.y});
				}
				addQuad(*run, at, b, e);
				ctrl = b;
				at = e;
				break;
			}
			case 'T': {
				if (!(good = nums(2))) break;
				ensure();
				Pt b = (last == 'Q' || last == 'T') ? Pt{2 * at.x - ctrl.x, 2 * at.y - ctrl.y} : at;
				Pt e{o.x + v[0], o.y + v[1]};
				{
					Pt back = towards(e, b, at, at);
					directions(towards(at, b, e, e), {-back.x, -back.y});
				}
				addQuad(*run, at, b, e);
				ctrl = b;
				at = e;
				break;
			}
			case 'A': {
				if (!(good = r.number(v[0]) && r.number(v[1]) && r.number(v[2]) && r.flag(v[3]) && r.flag(v[4]) && r.number(v[5]) && r.number(v[6]))) break;
				ensure();
				Pt e{o.x + v[5], o.y + v[6]};
				{
					const size_t before = run->size();
					addArc(*run, at, v[0], v[1], v[2], v[3] != 0, v[4] != 0, e);
					// An arc's ends face along its first and last pieces, which are short enough to be its tangent.
					if (run->size() > before) {
						Pt first = (*run)[before], last = run->back(), prev = run->size() - before >= 2 ? (*run)[run->size() - 2] : at;
						directions({first.x - at.x, first.y - at.y}, {last.x - prev.x, last.y - prev.y});
					}
				}
				at = e;
				break;
			}
			default:
				good = false;
		}
		// A browser draws the path up to the first error and ignores the rest.
		if (!good) break;
		last = up;
	}
	out.ok = !out.runs.empty();
	return out;
}

// --- is a point on what a path draws -----------------------------------------------------------

// Whether a point is in a line's stroke as a canvas draws it by default: each piece a rectangle with
// flat ends (butt caps), and each corner filled out to a mitre, or cut flat past a mitre limit of 10.
bool onPiece(Pt p, Pt a, Pt b, double half) {
	const double dx = b.x - a.x, dy = b.y - a.y;
	const double len = std::hypot(dx, dy);
	if (len == 0) return false;
	const double along = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len;
	const double across = ((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
	return along >= 0 && along <= len && std::fabs(across) <= half;
}
bool inConvex(Pt p, const Pt* poly, int n) {
	int sign = 0;
	for (int k = 0; k < n; k++) {
		const Pt a = poly[k], b = poly[(k + 1) % n];
		const double c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
		if (c == 0) continue;
		const int sc = c > 0 ? 1 : -1;
		if (sign == 0) sign = sc;
		else if (sc != sign) return false;
	}
	return true;
}
// The wedge a join adds outside the two pieces meeting at `v`, coming in along `a`→`v`, out to `b`.
bool onJoin(Pt p, Pt a, Pt v, Pt b, double half, bool mitre) {
	double ux = v.x - a.x, uy = v.y - a.y, wx = b.x - v.x, wy = b.y - v.y;
	const double lu = std::hypot(ux, uy), lw = std::hypot(wx, wy);
	if (lu == 0 || lw == 0) return false;
	ux /= lu, uy /= lu, wx /= lw, wy /= lw;
	const double turn = ux * wy - uy * wx;
	if (std::fabs(turn) < 1e-12) return false;
	// The outer side is the one the line turns away from.
	const double side = turn > 0 ? -1 : 1;
	const Pt n1{v.x - uy * side * half, v.y + ux * side * half};
	const Pt n2{v.x - wy * side * half, v.y + wx * side * half};
	const double cosTheta = std::clamp(-(ux * wx + uy * wy), -1.0, 1.0);
	const double sinHalf = std::sqrt(std::max(0.0, (1 - cosTheta) / 2));
	if (mitre && sinHalf > 0 && 1 / sinHalf <= 10) {
		// The mitre's tip: where the two outer edges meet.
		const double t = ((n2.x - n1.x) * wy - (n2.y - n1.y) * wx) / (ux * wy - uy * wx);
		const Pt tip{n1.x + ux * t, n1.y + uy * t};
		const Pt quad[4] = {v, n1, tip, n2};
		return inConvex(p, quad, 4);
	}
	const Pt tri[3] = {v, n1, n2};
	return inConvex(p, tri, 3);
}

// -1: no geometry to ask about (the box answers); 0: not on it; 1: on it.
int onPath(const Item& item, double x, double y, double band) {
	if (!item.hasGeometry || item.vb[2] <= 0 || item.vb[3] <= 0) return -1;
	const double sx = item.pw / item.vb[2], sy = item.ph / item.vb[3];
	if (!(sx > 0) || !(sy > 0)) return -1;
	// Geometry that reads as nothing draws nothing, and nothing is on it.
	if (!item.flat.ok) return 0;
	// The point goes into the path's own units, and the line's width with it.
	const Pt p{(x - item.px) / sx + item.vb[0], (y - item.py) / sy + item.vb[1]};
	const double half = std::max(item.strokeWidth, band) / std::max(sx, sy) / 2;
	const double reach2 = half * half;
	int winding = 0;
	(void)reach2;
	for (size_t r = 0; r < item.flat.runs.size(); r++) {
		const auto& run = item.flat.runs[r];
		const bool closed = item.flat.closed[r];
		// An open run's flat caps face along its true direction at each end: the first and last
		// pieces, cut from a curve, point a little elsewhere, and are trimmed to the cap's line.
		const Pt s0 = run.front(), d0 = item.flat.starts[r], e0 = run.back(), d1 = item.flat.ends[r];
		const bool behindStart = !closed && (p.x - s0.x) * d0.x + (p.y - s0.y) * d0.y < 0;
		const bool pastEnd = !closed && (p.x - e0.x) * d1.x + (p.y - e0.y) * d1.y > 0;
		for (size_t k = 1; k < run.size(); k++) {
			if (k == 1 && behindStart) continue;
			if (k == run.size() - 1 && pastEnd) continue;
			if (onPiece(p, run[k - 1], run[k], half)) return 1;
		}
		// Corners, skipping pieces of no length; a closed run also has one where it began.
		std::vector<Pt> pts;
		for (const Pt& q : run) {
			if (pts.empty() || q.x != pts.back().x || q.y != pts.back().y) pts.push_back(q);
			else pts.back().corner = pts.back().corner || q.corner;
		}
		if (closed && pts.size() > 1 && pts.front().x == pts.back().x && pts.front().y == pts.back().y) pts.pop_back();
		const size_t m = pts.size();
		for (size_t k = 0; m >= 3 && k < m; k++) {
			if (!closed && (k == 0 || k == m - 1)) continue;
			// Inside a curve the stroke bends smoothly: the cut between two pieces is filled with a bevel,
			// which never reaches past the line as a round one did near its ends. Only a real corner is mitred.
			if (onJoin(p, pts[(k + m - 1) % m], pts[k], pts[(k + 1) % m], half, pts[k].corner)) return 1;
		}
		if (!(item.flags & FILLED) || run.size() < 3) continue;
		// Each subpath is closed for filling, as a canvas closes it.
		for (size_t k = 0; k < run.size(); k++) {
			const Pt a = run[k], b = run[(k + 1) % run.size()];
			if (a.y <= p.y) {
				if (b.y > p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0) winding++;
			} else if (b.y <= p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0) winding--;
		}
	}
	return winding != 0 ? 1 : 0;
}

// --- the index: a packed R-tree, as `spatial.ts` builds one -------------------------------------

constexpr int NODE = 16;
struct Tree {
	std::vector<int> ids;        // items, in leaf order
	std::vector<double> boxes;   // per node: minX minY maxX maxY
	std::vector<int> first, count;
	std::vector<char> leaf;
	int root = -1;
	bool stale = true;
} tree;

void build() {
	tree = Tree{};
	tree.stale = false;
	std::vector<int> order;
	for (int i = 0; i < int(items.size()); i++)
		if (items[i].live) order.push_back(i);
	const size_t n = order.size();
	if (n == 0) return;
	auto midX = [](int i) { return items[i].bx + items[i].bw / 2; };
	auto midY = [](int i) { return items[i].by + items[i].bh / 2; };
	std::sort(order.begin(), order.end(), [&](int a, int b) { return midX(a) < midX(b); });
	const size_t leaves = std::max<size_t>(1, (n + NODE - 1) / NODE);
	const size_t perSlice = size_t(std::ceil(std::sqrt(double(leaves)))) * NODE;
	for (size_t at = 0; at < n; at += perSlice)
		std::sort(order.begin() + at, order.begin() + std::min(n, at + perSlice), [&](int a, int b) { return midY(a) < midY(b); });
	tree.ids = order;
	std::vector<int> level;
	auto addNode = [&](double x1, double y1, double x2, double y2, int first, int count, bool isLeaf) {
		tree.boxes.insert(tree.boxes.end(), {x1, y1, x2, y2});
		tree.first.push_back(first);
		tree.count.push_back(count);
		tree.leaf.push_back(isLeaf);
		return int(tree.first.size() - 1);
	};
	for (size_t at = 0; at < n; at += NODE) {
		double x1 = INFINITY, y1 = INFINITY, x2 = -INFINITY, y2 = -INFINITY;
		const size_t end = std::min(n, at + NODE);
		for (size_t k = at; k < end; k++) {
			const Item& it = items[order[k]];
			x1 = std::min(x1, it.bx);
			y1 = std::min(y1, it.by);
			x2 = std::max(x2, it.bx + it.bw);
			y2 = std::max(y2, it.by + it.bh);
		}
		level.push_back(addNode(x1, y1, x2, y2, int(at), int(end - at), true));
	}
	while (level.size() > 1) {
		std::vector<int> up;
		for (size_t at = 0; at < level.size(); at += NODE) {
			double x1 = INFINITY, y1 = INFINITY, x2 = -INFINITY, y2 = -INFINITY;
			const size_t end = std::min(level.size(), at + NODE);
			for (size_t k = at; k < end; k++) {
				const double* b = &tree.boxes[size_t(level[k]) * 4];
				x1 = std::min(x1, b[0]);
				y1 = std::min(y1, b[1]);
				x2 = std::max(x2, b[2]);
				y2 = std::max(y2, b[3]);
			}
			// The children of an upper node are consecutive nodes: `first` is the first of them.
			up.push_back(addNode(x1, y1, x2, y2, level[at], int(end - at), false));
		}
		level = up;
	}
	tree.root = level[0];
}

template <typename Visit>
void search(double x1, double y1, double x2, double y2, Visit visit) {
	if (tree.stale) build();
	if (tree.root < 0) return;
	std::vector<int> stack{tree.root};
	while (!stack.empty()) {
		int node = stack.back();
		stack.pop_back();
		const double* b = &tree.boxes[size_t(node) * 4];
		if (b[0] > x2 || b[2] < x1 || b[1] > y2 || b[3] < y1) continue;
		if (tree.leaf[node]) {
			for (int k = 0; k < tree.count[node]; k++) {
				int id = tree.ids[size_t(tree.first[node] + k)];
				const Item& it = items[id];
				if (it.bx > x2 || it.bx + it.bw < x1 || it.by > y2 || it.by + it.bh < y1) continue;
				visit(id);
			}
		} else
			for (int k = 0; k < tree.count[node]; k++) stack.push_back(tree.first[node] + k);
	}
}

}  // namespace

extern "C" {

// Where the page writes an item's numbers or a path's text, and reads answers.
EMSCRIPTEN_KEEPALIVE double* pick_io(int count) {
	if (int(io.size()) < count) io.resize(count);
	return io.data();
}

EMSCRIPTEN_KEEPALIVE int pick_add() {
	tree.stale = true;
	if (!freeItems.empty()) {
		int h = freeItems.back();
		freeItems.pop_back();
		items[h] = Item{};
		items[h].live = true;
		return h;
	}
	items.push_back(Item{});
	items.back().live = true;
	return int(items.size() - 1);
}

EMSCRIPTEN_KEEPALIVE void pick_remove(int h) {
	items[h] = Item{};
	freeItems.push_back(h);
	tree.stale = true;
}

// An item's numbers from `pick_io`: bounds (4), box (4), order, parent, flags, viewBox (4), stroke width.
EMSCRIPTEN_KEEPALIVE void pick_set(int h) {
	const double* f = io.data();
	Item& it = items[h];
	it.bx = f[0], it.by = f[1], it.bw = f[2], it.bh = f[3];
	it.px = f[4], it.py = f[5], it.pw = f[6], it.ph = f[7];
	it.order = f[8];
	it.parent = int(f[9]);
	it.flags = int(f[10]);
	for (int k = 0; k < 4; k++) it.vb[k] = f[11 + k];
	it.strokeWidth = f[15];
	tree.stale = true;
}

// A path's geometry, `length` bytes of text at `pick_io`, read once until it changes.
EMSCRIPTEN_KEEPALIVE void pick_geometry(int h, int length) {
	items[h].hasGeometry = length > 0;
	items[h].flat = length > 0 ? flatten(std::string(reinterpret_cast<const char*>(io.data()), size_t(length))) : Flat{};
}

// Every item a press at a stage point reaches, topmost first, `band` the full width a line can be
// pressed across, in stage units. Answers in `pick_found`.
EMSCRIPTEN_KEEPALIVE int pick_point(double x, double y, double band) {
	found.clear();
	search(x, y, x, y, [&](int id) {
		const Item& it = items[id];
		if (it.flags & SKIP_PRESS) return;
		if (x < it.bx || x > it.bx + it.bw || y < it.by || y > it.by + it.bh) return;
		if (onPath(it, x, y, band) == 0) return;
		found.push_back(id);
	});
	std::sort(found.begin(), found.end(), [](int a, int b) { return items[a].order > items[b].order; });
	return int(found.size());
}

// Every item wholly inside a stage rectangle, leaving out any whose parent is in it too: a marquee.
EMSCRIPTEN_KEEPALIVE int pick_within(double x, double y, double w, double h) {
	std::vector<int> inside;
	std::vector<char> in(items.size(), 0);
	search(x, y, x + w, y + h, [&](int id) {
		const Item& it = items[id];
		if (it.flags & (SKIP_MARQUEE | IN_SHAPE)) return;
		if (it.bx >= x && it.by >= y && it.bx + it.bw <= x + w && it.by + it.bh <= y + h) {
			inside.push_back(id);
			in[size_t(id)] = 1;
		}
	});
	found.clear();
	for (int id : inside) {
		bool parentIn = false;
		for (int p = items[id].parent; p >= 0; p = items[p].parent)
			if (in[size_t(p)]) {
				parentIn = true;
				break;
			}
		if (!parentIn) found.push_back(id);
	}
	std::sort(found.begin(), found.end(), [](int a, int b) { return items[a].order < items[b].order; });
	return int(found.size());
}

EMSCRIPTEN_KEEPALIVE int* pick_found() { return found.data(); }

}  // extern "C"
