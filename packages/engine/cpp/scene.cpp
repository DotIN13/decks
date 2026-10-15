// The drawing's model and its layout: where every item of a pen.dev document is, as pen.dev lays it
// out. A port of `packages/pen/src/layout.ts`, which stays the reference: `test/layout-diff.mjs`
// runs both on every saved stage and on thousands of made-up documents and wants the same boxes.
//
// The page resolves what a property means (variables, themes, "fit_content(100)") and hands this
// numbers, one record per item; words are measured by whoever calls (`scene_measure`), as in the
// TypeScript. No GPU here: the same module runs in the page, in a worker and on the server.
//
// The model is kept between layouts, as Figma keeps its document: the page sends only the items
// whose record changed (`scene_set`), the children lists that changed (`scene_children`) and the
// items that went (`scene_remove`). An item keeps what its words measured until they change
// (`scene_words`), or until a font arrives (`scene_fonts`), so an unchanged drawing measures nothing.
#include <emscripten/emscripten.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

extern "C" {
// Measure an item's words: one line when `maxWidth` is NaN, wrapped at it otherwise. `withNode` 0 is
// the plain measure, as `layout.ts` asks for a text that grows to fit (no item is passed there).
// Writes the width and height to `out`.
extern void scene_measure(int handle, double maxWidth, int withNode, double* out);
// Words measured in C++ (`text.cpp`), with the fonts it holds.
int measureWords(const char* s, int length, const char* chainNames, int chainLength, double size, int weight, int italic, double letterSpacing, double lineHeight, double maxWidth, double* out);
}
// A markdown card's height (`card.cpp`).
double cardHeight(const double* nums, size_t count, const char* pool, double width);

namespace {

enum Kind : int { GROUP = 0, FRAME = 1, TEXT = 2, NOTE = 3, PATH = 4, OTHER = 5 };
enum SizeKind : int { MISSING = 0, FIXED = 1, HUG = 2, FILL = 3 };
enum Layout : int { NONE = 0, VERTICAL = 1, HORIZONTAL = 2 };
enum Justify : int { J_START = 0, J_CENTER = 1, J_END = 2, J_BETWEEN = 3, J_AROUND = 4 };
enum Align : int { A_START = 0, A_CENTER = 1, A_END = 2 };
enum Growth : int { G_AUTO = 0, G_WIDTH = 1, G_BOTH = 2 };

constexpr double NOTE_PAD = 16;
constexpr double NOTE_WIDTH = 240;

// What the page sends for one item; the field order is `FIELDS` in `src/scene.ts`.
enum Field : int {
	F_PARENT, F_KIND, F_VISIBLE, F_VISIBLE_IN_PARENT, F_X, F_Y,
	F_W_KIND, F_W_VALUE, F_W_FALLBACK, F_H_KIND, F_H_VALUE, F_H_FALLBACK,
	F_LAYOUT, F_PAD_T, F_PAD_R, F_PAD_B, F_PAD_L, F_GAP, F_JUSTIFY, F_ALIGN, F_ABSOLUTE,
	F_GROWTH, F_FALLBACK, F_PATH_W, F_PATH_H,
	F_COUNT
};

struct Box { double x, y, w, h; };
struct Dim { double w, h; };

struct Size {
	int kind;
	double value;
	double fallback;  // NaN: none
	bool hasFallback() const { return !std::isnan(fallback); }
};

struct Node {
	int parent;
	Kind kind;
	bool visible, visibleInParent;
	double x, y;
	Size w, h;
	Layout layout;
	double pad[4];
	double gap;
	Justify justify;
	Align align;
	bool absolute;
	Growth growth;
	double fallback;
	double pathW, pathH;  // NaN: no bounds
	std::vector<int> children;
	bool live = false;
	// Its words and their style, when the scene measures them itself (`scene_text`); a card's
	// markdown is measured by the page, as are all words when no words were given.
	bool ownWords = false, markdown = false;
	std::string text, chain;
	double fontSize = 14, letterSpacing = 0, lineHeight = NAN;
	int weight = 400;
	bool italic = false;
	// A card's blocks, encoded as `card.cpp` reads them, when the page sent them (`scene_card`).
	bool ownCard = false;
	std::vector<double> card;
	std::string cardPool;
	// What its words measured, by the width asked and whether the item was passed along.
	struct Measured { double maxWidth; int withNode; Dim size; };
	std::vector<Measured> measured;
};

std::vector<Node> nodes;
std::vector<int> freeHandles;
std::vector<int> roots;
// Where the page writes what it sends: a record, or a list of children.
std::vector<double> input(F_COUNT);
// What the layout found, seven numbers per placed item: handle, x, y, w, h, parent, order.
std::vector<double> results;
// Each item's box from the last layout, by handle, for the painter (`paint.cpp`).
struct Placement { double x, y, w, h; bool placed; };
std::vector<Placement> placements;
const double NaN = std::nan("");

// A size as stated, or what an absent one means here.
Size orMissing(const Size& s, Size whenMissing) { return s.kind == MISSING ? whenMissing : s; }
double fixedOr(const Size& s, double fallback) { return s.kind == FIXED ? s.value : (s.hasFallback() ? s.fallback : fallback); }
Size fixed(double v) { return Size{FIXED, v, NaN}; }
Size hug() { return Size{HUG, 0, NaN}; }
bool has(double v) { return !std::isnan(v); }

Dim measure(int handle, double maxWidth, bool withNode) {
	auto& known = nodes[handle].measured;
	for (const auto& one : known)
		if (one.withNode == int(withNode) && (one.maxWidth == maxWidth || (std::isnan(one.maxWidth) && std::isnan(maxWidth)))) return one.size;
	const Node& n = nodes[handle];
	Dim size{0, 0};
	if (n.ownCard && n.markdown && withNode) {
		// A card: as wide as asked (240 when not), as tall as its blocks, as `PenFonts.measure` has it.
		const double w = std::isnan(maxWidth) ? 240 : maxWidth;
		size = {w, cardHeight(n.card.data(), n.card.size(), n.cardPool.data(), std::max(1.0, w))};
	} else if (n.ownWords && !(n.markdown && withNode)) {
		// Plain words, measured here as the page's `PenFonts.measure` measures them: an empty text as one space.
		double out[4] = {0, 0, 0, 0};
		const std::string& words = n.text.empty() ? std::string(" ") : n.text;
		measureWords(words.data(), int(words.size()), n.chain.data(), int(n.chain.size()), n.fontSize, n.weight, n.italic ? 1 : 0, n.letterSpacing, n.lineHeight, std::isnan(maxWidth) ? NAN : std::max(1.0, maxWidth), out);
		size = {std::isnan(maxWidth) ? std::ceil(out[0]) : std::min(maxWidth, std::ceil(out[1])), out[2]};
	} else {
		double out[2] = {0, 0};
		scene_measure(handle, maxWidth, withNode ? 1 : 0, out);
		size = {out[0], out[1]};
	}
	// A few widths per item at most: a fill share and its own width. More means a resize is passing through.
	if (known.size() >= 8) known.erase(known.begin());
	known.push_back({maxWidth, int(withNode), size});
	return size;
}

Dim sizeOf(int handle, double forcedW = NaN, double forcedH = NaN);

Dim textSize(int handle, double forcedW, double forcedH) {
	const Node& n = nodes[handle];
	if (n.kind == NOTE) {
		// A note, prompt or context is a card: its width, and a height that holds its words.
		double w = has(forcedW) ? forcedW : fixedOr(orMissing(n.w, fixed(NOTE_WIDTH)), NOTE_WIDTH);
		Size hs = orMissing(n.h, hug());
		Dim words = measure(handle, std::max(1.0, w - NOTE_PAD * 2), true);
		double h = has(forcedH) ? forcedH : (hs.kind == FIXED ? hs.value : words.h + NOTE_PAD * 2);
		return {w, h};
	}
	if (n.growth == G_BOTH) {
		double w = has(forcedW) ? forcedW : fixedOr(orMissing(n.w, fixed(100)), 100);
		double h = has(forcedH) ? forcedH : fixedOr(orMissing(n.h, fixed(20)), 20);
		return {w, h};
	}
	if (n.growth == G_WIDTH) {
		double w = has(forcedW) ? forcedW : fixedOr(orMissing(n.w, fixed(100)), 100);
		return {w, has(forcedH) ? forcedH : measure(handle, w, true).h};
	}
	Dim size = measure(handle, NaN, false);
	return {has(forcedW) ? forcedW : size.w, has(forcedH) ? forcedH : size.h};
}

struct Content {
	double w, h;
	int count;
	std::vector<Box> locals;   // by child position
	std::vector<char> placed;  // whether each child has a box
};

Content frameContent(int handle, double w, double h);

Dim sizeOf(int handle, double forcedW, double forcedH) {
	const Node& n = nodes[handle];
	if (n.kind == GROUP) {
		double w = 0, h = 0;
		for (int child : n.children) {
			if (!nodes[child].visibleInParent) continue;
			Dim size = sizeOf(child);
			w = std::max(w, nodes[child].x + size.w);
			h = std::max(h, nodes[child].y + size.h);
		}
		return {w, h};
	}
	if (n.kind == TEXT || n.kind == NOTE) return textSize(handle, forcedW, forcedH);
	if (n.kind == PATH) {
		double bw = has(n.pathW) ? n.pathW : 0, bh = has(n.pathH) ? n.pathH : 0;
		Size ws = orMissing(n.w, fixed(bw)), hs = orMissing(n.h, fixed(bh));
		return {has(forcedW) ? forcedW : fixedOr(ws, bw), has(forcedH) ? forcedH : fixedOr(hs, bh)};
	}
	if (n.kind == FRAME) {
		Size ws = orMissing(n.w, hug()), hs = orMissing(n.h, hug());
		Content inner = frameContent(handle, ws.kind == FIXED ? ws.value : forcedW, hs.kind == FIXED ? hs.value : forcedH);
		double w = has(forcedW) ? forcedW
			: ws.kind == FIXED ? ws.value
			: ws.kind == HUG ? (inner.count == 0 && ws.hasFallback() ? ws.fallback : inner.w)
			: (ws.hasFallback() ? ws.fallback : inner.w);
		double h = has(forcedH) ? forcedH
			: hs.kind == FIXED ? hs.value
			: hs.kind == HUG ? (inner.count == 0 && hs.hasFallback() ? hs.fallback : inner.h)
			: (hs.hasFallback() ? hs.fallback : inner.h);
		return {w, h};
	}
	// Rectangles, ellipses, polygons, browsers, icons, scripts, placeholders: the box they state.
	Size ws = orMissing(n.w, fixed(n.fallback)), hs = orMissing(n.h, fixed(n.fallback));
	return {has(forcedW) ? forcedW : fixedOr(ws, n.fallback), has(forcedH) ? forcedH : fixedOr(hs, n.fallback)};
}

// The content box a frame's children need, and where each goes relative to the frame. `w` and `h`
// are the frame's own size when known and NaN when it hugs.
Content frameContent(int handle, double w, double h) {
	const Node& n = nodes[handle];
	Content out{0, 0, 0, std::vector<Box>(n.children.size()), std::vector<char>(n.children.size(), 0)};
	if (n.layout == NONE) {
		double right = 0, bottom = 0;
		for (size_t i = 0; i < n.children.size(); i++) {
			int child = n.children[i];
			if (!nodes[child].visible) continue;
			out.count++;
			Dim size = sizeOf(child);
			Box box{nodes[child].x, nodes[child].y, size.w, size.h};
			out.locals[i] = box;
			out.placed[i] = 1;
			right = std::max(right, box.x + box.w);
			bottom = std::max(bottom, box.y + box.h);
		}
		out.w = right;
		out.h = bottom;
		return out;
	}
	const double pt = n.pad[0], pr = n.pad[1], pb = n.pad[2], pl = n.pad[3];
	const bool row = n.layout == HORIZONTAL;
	std::vector<size_t> flow, floating;
	for (size_t i = 0; i < n.children.size(); i++) {
		const Node& c = nodes[n.children[i]];
		if (!c.visible) continue;
		(c.absolute ? floating : flow).push_back(i);
	}
	const double innerMain = row ? (has(w) ? w - pl - pr : NaN) : (has(h) ? h - pt - pb : NaN);
	const double innerCross = row ? (has(h) ? h - pt - pb : NaN) : (has(w) ? w - pl - pr : NaN);
	auto mainOf = [&](const Node& c) { return row ? c.w.kind : c.h.kind; };
	auto crossOf = [&](const Node& c) { return row ? c.h.kind : c.w.kind; };

	// First pass: every child that is not filling the main axis, at its own size.
	std::vector<Dim> sizes(n.children.size(), Dim{0, 0});
	double used = 0;
	std::vector<size_t> fillers;
	for (size_t i : flow) {
		int child = n.children[i];
		const Node& c = nodes[child];
		if (mainOf(c) == FILL && has(innerMain)) {
			fillers.push_back(i);
			continue;
		}
		double forcedCross = crossOf(c) == FILL && has(innerCross) ? std::max(0.0, innerCross) : NaN;
		Dim size = row ? sizeOf(child, NaN, forcedCross) : sizeOf(child, forcedCross, NaN);
		sizes[i] = size;
		used += row ? size.w : size.h;
	}
	const double gaps = std::max(0.0, double(flow.size()) - 1) * n.gap;
	if (!fillers.empty() && has(innerMain)) {
		double share = std::max(0.0, (innerMain - used - gaps) / double(fillers.size()));
		for (size_t i : fillers) {
			int child = n.children[i];
			double forcedCross = crossOf(nodes[child]) == FILL && has(innerCross) ? std::max(0.0, innerCross) : NaN;
			Dim size = row ? sizeOf(child, share, forcedCross) : sizeOf(child, forcedCross, share);
			sizes[i] = size;
			used += row ? size.w : size.h;
		}
	}
	const double contentMain = used + gaps;
	double contentCross = 0;
	for (size_t i : flow) contentCross = std::max(contentCross, row ? sizes[i].h : sizes[i].w);
	const double mainBox = has(innerMain) ? innerMain : contentMain;
	const double crossBox = has(innerCross) ? innerCross : contentCross;

	// Second pass: positions along the main axis, then the cross.
	const double free = std::max(0.0, mainBox - contentMain);
	double cursor = 0, between = n.gap;
	if (n.justify == J_CENTER) cursor = free / 2;
	else if (n.justify == J_END) cursor = free;
	else if (n.justify == J_BETWEEN && flow.size() > 1) between = n.gap + free / double(flow.size() - 1);
	else if (n.justify == J_AROUND && !flow.empty()) {
		cursor = free / double(flow.size()) / 2;
		between = n.gap + free / double(flow.size());
	}
	for (size_t i : flow) {
		Dim size = sizes[i];
		double childMain = row ? size.w : size.h, childCross = row ? size.h : size.w;
		double crossAt = n.align == A_CENTER ? (crossBox - childCross) / 2 : n.align == A_END ? crossBox - childCross : 0;
		out.locals[i] = row ? Box{pl + cursor, pt + crossAt, size.w, size.h} : Box{pl + crossAt, pt + cursor, size.w, size.h};
		out.placed[i] = 1;
		cursor += childMain + between;
	}
	for (size_t i : floating) {
		int child = n.children[i];
		Dim size = sizeOf(child);
		out.locals[i] = Box{nodes[child].x, nodes[child].y, size.w, size.h};
		out.placed[i] = 1;
	}
	out.w = row ? contentMain + pl + pr : contentCross + pl + pr;
	out.h = row ? contentCross + pt + pb : contentMain + pt + pb;
	out.count = int(flow.size());
	return out;
}

int order = 0;

// Place an item at its stage position, then its children. Returns where its box was written.
size_t place(int handle, double x, double y, Dim size, int parent) {
	const size_t at = results.size();
	results.insert(results.end(), {double(handle), x, y, size.w, size.h, double(parent), double(order++)});
	const Node& n = nodes[handle];
	if (n.children.empty()) return at;
	if (n.kind == GROUP) {
		double x1 = INFINITY, y1 = INFINITY, x2 = -INFINITY, y2 = -INFINITY;
		for (int child : n.children) {
			if (!nodes[child].visible) continue;
			size_t c = place(child, x + nodes[child].x, y + nodes[child].y, sizeOf(child), handle);
			x1 = std::min(x1, results[c + 1]);
			y1 = std::min(y1, results[c + 2]);
			x2 = std::max(x2, results[c + 1] + results[c + 3]);
			y2 = std::max(y2, results[c + 2] + results[c + 4]);
		}
		// A group is the box round what is in it, wherever that starts, not a box from its own corner.
		if (x1 != INFINITY) {
			results[at + 1] = x1;
			results[at + 2] = y1;
			results[at + 3] = x2 - x1;
			results[at + 4] = y2 - y1;
		}
		return at;
	}
	Content content = frameContent(handle, size.w, size.h);
	for (size_t i = 0; i < n.children.size(); i++) {
		if (!content.placed[i]) continue;
		const Box& local = content.locals[i];
		place(n.children[i], x + local.x, y + local.y, Dim{local.w, local.h}, handle);
	}
	return at;
}

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE double* scene_input(int count) {
	if (int(input.size()) < count) input.resize(count);
	return input.data();
}

EMSCRIPTEN_KEEPALIVE void scene_reset() {
	nodes.clear();
	roots.clear();
	freeHandles.clear();
}

// A handle for a new item, reusing one let go of.
EMSCRIPTEN_KEEPALIVE int scene_add() {
	if (!freeHandles.empty()) {
		int handle = freeHandles.back();
		freeHandles.pop_back();
		nodes[handle] = Node{};
		nodes[handle].live = true;
		return handle;
	}
	nodes.push_back(Node{});
	nodes.back().live = true;
	return int(nodes.size() - 1);
}

// An item's record, from the numbers in `scene_input()`. Its children are set apart (`scene_children`).
EMSCRIPTEN_KEEPALIVE void scene_set(int handle) {
	const double* f = input.data();
	Node& n = nodes[handle];
	n.kind = Kind(int(f[F_KIND]));
	n.visible = f[F_VISIBLE] != 0;
	n.visibleInParent = f[F_VISIBLE_IN_PARENT] != 0;
	n.x = f[F_X];
	n.y = f[F_Y];
	n.w = Size{int(f[F_W_KIND]), f[F_W_VALUE], f[F_W_FALLBACK]};
	n.h = Size{int(f[F_H_KIND]), f[F_H_VALUE], f[F_H_FALLBACK]};
	n.layout = Layout(int(f[F_LAYOUT]));
	for (int i = 0; i < 4; i++) n.pad[i] = f[F_PAD_T + i];
	n.gap = f[F_GAP];
	n.justify = Justify(int(f[F_JUSTIFY]));
	n.align = Align(int(f[F_ALIGN]));
	n.absolute = f[F_ABSOLUTE] != 0;
	n.growth = Growth(int(f[F_GROWTH]));
	n.fallback = f[F_FALLBACK];
	n.pathW = f[F_PATH_W];
	n.pathH = f[F_PATH_H];
}

// What is in an item, in order, or the drawing's top level for -1: `count` handles from `scene_input()`.
EMSCRIPTEN_KEEPALIVE void scene_children(int handle, int count) {
	std::vector<int>& list = handle < 0 ? roots : nodes[handle].children;
	list.resize(count);
	for (int i = 0; i < count; i++) list[i] = int(input[i]);
}

// The item's words, or what it is, changed: what they measured no longer holds.
EMSCRIPTEN_KEEPALIVE void scene_words(int handle) { nodes[handle].measured.clear(); }

// An item's words for the scene to measure itself: `length` bytes of UTF-8 at `scene_bytes`, then its
// font chain, one family a line. `markdown`: a card's words, which the page still measures when the
// item is passed along (see `measure`).
std::vector<char> bytes(256);
EMSCRIPTEN_KEEPALIVE char* scene_bytes(int count) {
	if (int(bytes.size()) < count) bytes.resize(count);
	return bytes.data();
}
// An item's card: `count` numbers at `scene_input`, its strings `poolLength` bytes at `scene_bytes`.
EMSCRIPTEN_KEEPALIVE void scene_card(int handle, int count, int poolLength) {
	Node& n = nodes[handle];
	n.ownCard = count > 0;
	n.card.assign(input.begin(), input.begin() + count);
	n.cardPool.assign(bytes.data(), size_t(poolLength));
	n.measured.clear();
}

EMSCRIPTEN_KEEPALIVE void scene_text(int handle, int length, int chainLength, double size, int weight, int italic, double letterSpacing, double lineHeight, int markdown) {
	Node& n = nodes[handle];
	n.ownWords = true;
	n.text.assign(bytes.data(), size_t(length));
	n.chain.assign(bytes.data() + length, size_t(chainLength));
	n.fontSize = size;
	n.weight = weight;
	n.italic = italic != 0;
	n.letterSpacing = letterSpacing;
	n.lineHeight = lineHeight;
	n.markdown = markdown != 0;
	n.measured.clear();
}

// A font arrived, or anything else every measure depends on changed.
EMSCRIPTEN_KEEPALIVE void scene_fonts() {
	for (Node& n : nodes) n.measured.clear();
}

EMSCRIPTEN_KEEPALIVE void scene_remove(int handle) {
	nodes[handle] = Node{};
	freeHandles.push_back(handle);
}

// How many items the scene holds, and how many words it measured since the last call.
EMSCRIPTEN_KEEPALIVE int scene_count() { return int(nodes.size() - freeHandles.size()); }

// Lay out every visible top-level item and what is in it. Returns how many items were placed; their
// boxes are at `scene_results()`, seven numbers each.
EMSCRIPTEN_KEEPALIVE int scene_layout() {
	results.clear();
	order = 0;
	for (int root : roots) {
		if (!nodes[root].visible) continue;
		Dim size = sizeOf(root);
		place(root, nodes[root].x, nodes[root].y, size, -1);
	}
	placements.assign(nodes.size(), Placement{0, 0, 0, 0, false});
	for (size_t k = 0; k + 6 < results.size(); k += 7) placements[size_t(results[k])] = Placement{results[k + 1], results[k + 2], results[k + 3], results[k + 4], true};
	return int(results.size() / 7);
}

EMSCRIPTEN_KEEPALIVE double* scene_results() { return results.data(); }

}  // extern "C"

// What the painter reads of the scene: the top items, an item's children, an item's box.
struct PaintBox { double x, y, w, h; bool placed; };
int sceneRoots(const int** out) {
	*out = roots.data();
	return int(roots.size());
}
int sceneChildren(int handle, const int** out) {
	if (handle < 0 || size_t(handle) >= nodes.size()) return 0;
	if (out) *out = nodes[size_t(handle)].children.data();
	return int(nodes[size_t(handle)].children.size());
}
PaintBox sceneBox(int handle) {
	if (handle < 0 || size_t(handle) >= placements.size()) return {0, 0, 0, 0, false};
	const Placement& p = placements[size_t(handle)];
	return {p.x, p.y, p.w, p.h, p.placed};
}
