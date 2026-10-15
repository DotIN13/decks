// Snapping, as a design tool does it: a box being moved lines its edges and middle up with what is
// around it, and settles into the gaps its neighbours keep. A port of
// `apps/web/src/canvas/pen/snap.ts`, kept to the same order of looking, so ties go the same way;
// `test/snap-diff.mjs` holds it to it.
#include <emscripten/emscripten.h>

#include <algorithm>
#include <cmath>
#include <optional>
#include <vector>

namespace {

struct Box { double x, y, w, h; };
struct Guide { int kind; double x1, y1, x2, y2; };  // kind 0 a line, 1 a gap
enum Axis { X = 0, Y = 1 };
constexpr double EPS = 0.5;

std::vector<double> in(64), out(64);

double start(const Box& b, Axis a) { return a == X ? b.x : b.y; }
double end(const Box& b, Axis a) { return a == X ? b.x + b.w : b.y + b.h; }
double size(const Box& b, Axis a) { return a == X ? b.w : b.h; }
Axis cross(Axis a) { return a == X ? Y : X; }
void lines(const Box& b, Axis a, double out3[3]) {
	if (a == X) out3[0] = b.x, out3[1] = b.x + b.w / 2, out3[2] = b.x + b.w;
	else out3[0] = b.y, out3[1] = b.y + b.h / 2, out3[2] = b.y + b.h;
}
bool overlaps(const Box& a, const Box& b, Axis axis) {
	Axis c = cross(axis);
	return start(a, c) < end(b, c) && start(b, c) < end(a, c);
}

std::optional<double> bestShift(const Box& moving, const std::vector<Box>& targets, Axis axis, double threshold) {
	std::optional<double> best;
	auto offer = [&](double shift) {
		if (std::fabs(shift) <= threshold && (!best || std::fabs(shift) < std::fabs(*best))) best = shift;
	};
	double mine[3], theirs[3];
	lines(moving, axis, mine);
	for (const Box& t : targets) {
		lines(t, axis, theirs);
		for (double v : theirs)
			for (double m : mine) offer(v - m);
	}
	std::vector<const Box*> row;
	for (const Box& t : targets)
		if (overlaps(t, moving, axis)) row.push_back(&t);
	for (const Box* a : row)
		for (const Box* b : row) {
			if (a == b || end(*a, axis) > start(*b, axis)) continue;
			const double gap = start(*b, axis) - end(*a, axis);
			offer(end(*b, axis) + gap - start(moving, axis));
			offer(start(*a, axis) - gap - end(moving, axis));
			const double room = start(*b, axis) - end(*a, axis) - size(moving, axis);
			if (room >= 0) offer(end(*a, axis) + room / 2 - start(moving, axis));
		}
	return best;
}

void guidesFor(const Box& moving, const std::vector<Box>& targets, Axis axis, std::vector<Guide>& outGuides) {
	const Axis other = cross(axis);
	double mine[3], theirs[3];
	lines(moving, axis, mine);
	for (double m : mine) {
		double lo = start(moving, other), hi = end(moving, other);
		bool any = false;
		for (const Box& t : targets) {
			lines(t, axis, theirs);
			bool hit = false;
			for (double v : theirs)
				if (std::fabs(v - m) < EPS) hit = true;
			if (!hit) continue;
			any = true;
			lo = std::min(lo, start(t, other));
			hi = std::max(hi, end(t, other));
		}
		if (!any) continue;
		outGuides.push_back(axis == X ? Guide{0, m, lo, m, hi} : Guide{0, lo, m, hi, m});
	}
	std::vector<const Box*> row;
	for (const Box& t : targets)
		if (overlaps(t, moving, axis)) row.push_back(&t);
	auto gapLine = [&](double from, double to, const Box& a, const Box& b) {
		const double mid = (std::max(start(a, other), start(b, other)) + std::min(end(a, other), end(b, other))) / 2;
		return axis == X ? Guide{1, from, mid, to, mid} : Guide{1, mid, from, mid, to};
	};
	// The nearest neighbour on each side, the first of equals as a stable sort would leave it.
	const Box* before = nullptr;
	const Box* after = nullptr;
	for (const Box* t : row)
		if (end(*t, axis) <= start(moving, axis) + EPS && (!before || end(*t, axis) > end(*before, axis))) before = t;
	for (const Box* t : row)
		if (start(*t, axis) >= end(moving, axis) - EPS && (!after || start(*t, axis) < start(*after, axis))) after = t;
	std::optional<double> gapBefore, gapAfter;
	if (before) gapBefore = start(moving, axis) - end(*before, axis);
	if (after) gapAfter = start(*after, axis) - end(moving, axis);
	if (before && after && *gapBefore > EPS && std::fabs(*gapBefore - *gapAfter) < EPS) {
		outGuides.push_back(gapLine(end(*before, axis), start(moving, axis), *before, moving));
		outGuides.push_back(gapLine(end(moving, axis), start(*after, axis), moving, *after));
		return;
	}
	for (int side : {-1, 1}) {
		const Box* nearBox = side < 0 ? before : after;
		std::optional<double> gap = side < 0 ? gapBefore : gapAfter;
		if (!nearBox || !gap || *gap <= EPS) continue;
		const Box* far = nullptr;
		for (const Box* t : row) {
			if (t == nearBox) continue;
			if (side < 0 ? std::fabs(start(*nearBox, axis) - end(*t, axis) - *gap) < EPS : std::fabs(start(*t, axis) - end(*nearBox, axis) - *gap) < EPS) {
				far = t;
				break;
			}
		}
		if (!far) continue;
		if (side < 0) {
			outGuides.push_back(gapLine(end(*far, axis), start(*nearBox, axis), *far, *nearBox));
			outGuides.push_back(gapLine(end(*nearBox, axis), start(moving, axis), *nearBox, moving));
		} else {
			outGuides.push_back(gapLine(end(moving, axis), start(*nearBox, axis), moving, *nearBox));
			outGuides.push_back(gapLine(end(*nearBox, axis), start(*far, axis), *nearBox, *far));
		}
	}
}

std::vector<Box> readTargets(int count) {
	std::vector<Box> targets(count);
	for (int i = 0; i < count; i++) targets[i] = Box{in[i * 4], in[i * 4 + 1], in[i * 4 + 2], in[i * 4 + 3]};
	return targets;
}

int writeGuides(const std::vector<Guide>& guides, size_t at) {
	if (out.size() < at + guides.size() * 5) out.resize(at + guides.size() * 5);
	for (size_t i = 0; i < guides.size(); i++) {
		const Guide& g = guides[i];
		double* o = &out[at + i * 5];
		o[0] = g.kind, o[1] = g.x1, o[2] = g.y1, o[3] = g.x2, o[4] = g.y2;
	}
	return int(guides.size());
}

}  // namespace

extern "C" {

// Where the page writes the targets (four numbers each), followed by a resize's edges.
EMSCRIPTEN_KEEPALIVE double* snap_in(int count) {
	if (int(in.size()) < count) in.resize(count);
	return in.data();
}
// Where the answer is: a move's dx, dy or a resize's box, then five numbers per guide.
EMSCRIPTEN_KEEPALIVE double* snap_out() { return out.data(); }

// Snap a moved box against `count` targets. Answers dx and dy in `snap_out`, then the guides; returns how many guides.
EMSCRIPTEN_KEEPALIVE int snap_move(double x, double y, double w, double h, int count, double threshold) {
	const std::vector<Box> targets = readTargets(count);
	const Box moving{x, y, w, h};
	const double dx = bestShift(moving, targets, X, threshold).value_or(0);
	const double dy = bestShift(moving, targets, Y, threshold).value_or(0);
	const Box placed{x + dx, y + dy, w, h};
	std::vector<Guide> guides;
	guidesFor(placed, targets, X, guides);
	guidesFor(placed, targets, Y, guides);
	if (out.size() < 2) out.resize(2);
	out[0] = dx;
	out[1] = dy;
	return writeGuides(guides, 2);
}

// Snap the edges a resize moves: `edges` codes after the targets in `snap_in`, 0 left, 1 right, 2 top,
// 3 bottom, each pulled to the nearest line on its own. Answers the box (x1 y1 x2 y2), then the guides.
EMSCRIPTEN_KEEPALIVE int snap_edges(double x1, double y1, double x2, double y2, int count, int edges, double threshold) {
	const std::vector<Box> targets = readTargets(count);
	double box[4] = {x1, x2, y1, y2};  // by edge code
	std::vector<Guide> guides;
	for (int e = 0; e < edges; e++) {
		const int edge = int(in[size_t(count) * 4 + e]);
		const Axis axis = edge < 2 ? X : Y;
		const Box* bestTarget = nullptr;
		double bestValue = 0;
		double theirs[3];
		for (const Box& t : targets) {
			lines(t, axis, theirs);
			for (double v : theirs) {
				const double d = std::fabs(v - box[edge]);
				if (d <= threshold && (!bestTarget || d < std::fabs(bestValue - box[edge]))) {
					bestTarget = &t;
					bestValue = v;
				}
			}
		}
		if (!bestTarget) continue;
		box[edge] = bestValue;
		const Axis other = cross(axis);
		const double lo = std::min(other == X ? std::min(box[0], box[1]) : std::min(box[2], box[3]), start(*bestTarget, other));
		const double hi = std::max(other == X ? std::max(box[0], box[1]) : std::max(box[2], box[3]), end(*bestTarget, other));
		guides.push_back(axis == X ? Guide{0, bestValue, lo, bestValue, hi} : Guide{0, lo, bestValue, hi, bestValue});
	}
	if (out.size() < 4) out.resize(4);
	out[0] = box[0], out[1] = box[2], out[2] = box[1], out[3] = box[3];
	return writeGuides(guides, 4);
}

}  // extern "C"
