// A markdown card's height, laid out in C++ as the app's `layoutMarkdown` lays it out
// (`apps/web/src/canvas/pen/markdown-layout.ts`): the same blocks, gaps, indents and table widths, with
// every paragraph measured by `text.cpp`. The page parses the markdown and hands the blocks here
// encoded (`card-wire.ts` in the app); `test/card-diff.mjs` holds the height to CanvasKit's.
//
// The encoding: numbers, and a pool of UTF-8 a string is a reference into (its offset and length).
// A card is [version, fontSize, fontWeight, letterSpacing, lineHeight or NaN, base chain, mono chain,
// palette (nine colours), alignment, block count, blocks...]; a run of words is [text, chain, flags
// (1 code, 2 superscript, 4 bold, 8 italic), size scale, ink, background, lines, their colour]; the
// blocks are read in `one`. With ops asked for, it also records what `layoutMarkdown` draws.
#include <emscripten/emscripten.h>

#include <algorithm>
#include <cstring>
#include <cmath>
#include <map>
#include <string>
#include <tuple>
#include <vector>

#include "card.h"
#include "text.h"

namespace {

constexpr double HEADING_SIZE[6] = {1.6, 1.3, 1.12, 1, 0.9, 0.85};
constexpr double SIZE_SCALE_NONE = 1;

struct Ref { size_t at, length; };

struct Run {
	Ref text, chain;
	int flags;
	double scale;
	CardRunPaint paint;
};

struct Frame {
	double size;
	double weight;
	int depth;
	CardColour colour;
};

struct Para {
	double height;
	double intrinsic;  // unbroken width, to a hundredth
};

class Card {
public:
	Card(const double* nums, size_t count, const char* pool) : n_(nums), count_(count), pool_(pool) {}

	// The card's height; with `ops`, what it draws too.
	double layout(double width, std::vector<CardOp>* ops = nullptr) {
		ops_ = ops;
		at_ = 0;
		const double version = next();
		(void)version;
		fontSize_ = next();
		fontWeight_ = next();
		letterSpacing_ = next();
		lineHeight_ = next();
		base_ = ref();
		mono_ = ref();
		CardColour* palette[] = {&palette_.fg, &palette_.muted, &palette_.faint, &palette_.line, &palette_.strong, &palette_.subtle, &palette_.code, &palette_.accent, &palette_.box};
		for (CardColour* c : palette) *c = colour();
		align_ = int(next());
		const int blocks = int(next());
		const Frame f{fontSize_, fontWeight_, 0, palette_.fg};
		return stack(blocks, 0, 0, width, f, fontSize_);
	}
	const CardPalette& palette() const { return palette_; }
	bool ok() const { return ok_; }

private:
	const double* n_;
	size_t count_;
	const char* pool_;
	size_t at_ = 0;
	double fontSize_ = 14, fontWeight_ = 400, letterSpacing_ = 0, lineHeight_ = NAN;
	Ref base_{0, 0}, mono_{0, 0};
	CardPalette palette_;
	int align_ = 0;
	std::vector<CardOp>* ops_ = nullptr;
	bool ok_ = true;
	std::map<std::tuple<size_t, size_t, int, bool>, std::vector<int>> chains_;

	double next() { return at_ < count_ ? n_[at_++] : 0; }
	Ref ref() {
		const size_t a = size_t(next());
		const size_t l = size_t(next());
		return {a, l};
	}
	CardColour colour() {
		CardColour c;
		c.r = float(next());
		c.g = float(next());
		c.b = float(next());
		c.a = float(next());
		return c;
	}
	Run run() {
		Run r;
		r.text = ref();
		r.chain = ref();
		r.flags = int(next());
		r.scale = next();
		r.paint.ink = colour();
		r.paint.back = colour();
		r.paint.lines = int(next());
		r.paint.lineInk = colour();
		const Ref href = ref();
		r.paint.hrefAt = href.at;
		r.paint.hrefLength = href.length;
		return r;
	}
	std::vector<Run> runs(int count) {
		std::vector<Run> out;
		for (int i = 0; i < count; i++) out.push_back(run());
		return out;
	}
	const std::vector<int>& chain(Ref names, int weight, bool italic) {
		auto key = std::make_tuple(names.at, names.length, weight, italic);
		auto found = chains_.find(key);
		if (found != chains_.end()) return found->second;
		return chains_[key] = chainOf(pool_ + names.at, int(names.length), weight, italic);
	}
	static CardRunPaint plain() {
		CardRunPaint p;
		p.ink.a = -1;
		p.lineInk.a = -1;
		return p;
	}
	Run own(Ref text) { return Run{text, base_, 0, 1, plain()}; }

	// One paragraph of runs, as `para` in markdown-layout.ts builds it, laid out at `w`; drawn at
	// (x, y) when `draw` (a table measures its cells before it places them).
	Para para(const std::vector<Run>& list, const Frame& f, double x, double y, double w, bool draw, double lineHeight = 1.5, double size = NAN, double weight = NAN, int align = -1) {
		const double sz = std::isnan(size) ? f.size : size;
		const double wt = std::isnan(weight) ? f.weight : weight;
		std::string text;
		std::vector<Span> spans;
		std::vector<CardRunPaint> paints;
		Span base{0, 0, chain(base_, int(wt), false), sz, letterSpacing_, int(wt), false};
		auto add = [&](const std::string& words, Ref names, int flags, double scale, const CardRunPaint& paint) {
			const bool code = flags & 1, sup = flags & 2, bold = flags & 4, italic = flags & 8;
			const double runSize = (sup ? sz * 0.75 : code ? sz * 0.88 : sz) * scale;
			const int runWeight = int(bold ? std::max(600.0, wt + 200) : wt);
			Span span{text.size(), text.size() + words.size(), chain(names, runWeight, italic), runSize, letterSpacing_, runWeight, italic};
			text += words;
			spans.push_back(span);
			paints.push_back(paint);
		};
		if (list.empty()) add(" ", base_, 0, SIZE_SCALE_NONE, plain());
		for (const Run& r : list) add(std::string(pool_ + r.text.at, r.text.length), r.chain, r.flags, r.scale, r.paint);
		const double lh = std::isnan(lineHeight_) ? lineHeight : lineHeight_;
		double out[4];
		measureSpans(text.data(), int(text.size()), spans, base, lh, std::max(1.0, w), out);
		if (draw && ops_) {
			CardOp op;
			op.kind = CardOp::TEXT;
			op.x = x;
			op.y = y;
			op.w = std::max(1.0, w);
			op.colour = f.colour;
			op.text = std::move(text);
			op.spans = std::move(spans);
			op.base = base;
			op.lineHeight = lh;
			op.align = align < 0 ? align_ : align;
			op.paints = std::move(paints);
			ops_->push_back(std::move(op));
		}
		return {out[2], out[0]};
	}
	// Words of the card's own, a marker, a title, a placeholder: one plain run.
	Para words(Ref text, const Frame& f, double x, double y, double w, double size = NAN, double weight = NAN, int align = -1) {
		return para(std::vector<Run>{own(text)}, f, x, y, w, true, 1.5, size, weight, align);
	}
	void box(double x, double y, double w, double h, CardColour colour, double r = 0) {
		if (!ops_) return;
		CardOp op;
		op.kind = CardOp::BOX;
		op.x = x, op.y = y, op.w = w, op.h = h, op.r = r;
		op.colour = colour;
		ops_->push_back(std::move(op));
	}

	// Code, set as `colouredCode` sets it: the mono face at 0.88 of the size, a line height of 1.5, no spacing.
	double code(int count, double x, double y, double size, double w) {
		std::string text;
		std::vector<Span> spans;
		std::vector<CardRunPaint> paints;
		Span base{0, 0, chain(mono_, 400, false), size, 0};
		for (int i = 0; i < count; i++) {
			const Ref t = ref();
			const int flags = int(next());
			CardRunPaint paint = plain();
			paint.ink = colour();
			std::string words(pool_ + t.at, t.length);
			if (words.empty()) words = " ";
			spans.push_back(Span{text.size(), text.size() + words.size(), chain(mono_, flags & 4 ? 700 : 400, flags & 8), size, 0, flags & 4 ? 700 : 400, (flags & 8) != 0});
			paints.push_back(paint);
			text += words;
		}
		if (spans.empty()) {
			text = " ";
			spans.push_back(Span{0, 1, base.chain, size, 0});
			paints.push_back(plain());
		}
		double out[4];
		measureSpans(text.data(), int(text.size()), spans, base, 1.5, std::max(1.0, w), out);
		if (ops_) {
			CardOp op;
			op.kind = CardOp::TEXT;
			op.x = x, op.y = y, op.w = std::max(1.0, w);
			op.colour = palette_.fg;
			op.text = std::move(text);
			op.spans = std::move(spans);
			op.base = base;
			op.lineHeight = 1.5;
			op.align = 0;
			op.paints = std::move(paints);
			ops_->push_back(std::move(op));
		}
		return out[2];
	}

	double stack(int count, double x, double y, double w, const Frame& f, double gap) {
		for (int i = 0; i < count; i++) {
			const int kind = int(n_[at_]);
			if (i > 0) y += kind == 1 ? std::max(gap, f.size * 1.25) : gap;
			y = one(x, y, w, f);
		}
		return y;
	}

	static std::string roman(int n) {
		static const std::pair<int, const char*> table[] = {{10, "x"}, {9, "ix"}, {5, "v"}, {4, "iv"}, {1, "i"}};
		std::string out;
		for (const auto& [value, letters] : table)
			while (n >= value) out += letters, n -= value;
		return out;
	}
	static std::string marker(bool ordered, int n, int depth) {
		if (!ordered) return depth == 0 ? "\u2022" : depth == 1 ? "\u25e6" : "\u25aa";
		if (depth == 0) return std::to_string(n) + ".";
		if (depth == 1) return roman(n) + ".";
		return std::string(1, char(96 + (((n - 1) % 26) + 26) % 26 + 1)) + ".";
	}
	// A marker's words go into the pool's place: a run over a string of our own.
	Para ownWords(const std::string& words, const Frame& f, double x, double y, double w, int align) {
		extra_.push_back(words);
		const std::string& kept = extra_.back();
		// A run's text is a reference into the pool; this one is our own string, set as one plain span.
		std::vector<Span> spans{Span{0, kept.size(), chain(base_, int(f.weight), false), f.size, letterSpacing_, int(f.weight), false}};
		const double lh = std::isnan(lineHeight_) ? 1.5 : lineHeight_;
		double out[4];
		measureSpans(kept.data(), int(kept.size()), spans, spans[0], lh, std::max(1.0, w), out);
		if (ops_) {
			CardOp op;
			op.kind = CardOp::TEXT;
			op.x = x, op.y = y, op.w = std::max(1.0, w);
			op.colour = f.colour;
			op.text = kept;
			op.spans = spans;
			op.base = spans[0];
			op.lineHeight = lh;
			op.align = align;
			op.paints = {plain()};
			ops_->push_back(std::move(op));
		}
		return {out[2], out[0]};
	}
	std::vector<std::string> extra_;

	double one(double x, double y, double w, const Frame& f) {
		const int kind = int(next());
		switch (kind) {
			case 1: {  // heading
				const int level = std::clamp(int(next()), 1, 6);
				const auto list = runs(int(next()));
				Frame hf = f;
				if (level >= 5) hf.colour = palette_.muted;
				return y + para(list, hf, x, y, w, true, 1.3, f.size * HEADING_SIZE[level - 1], 600).height;
			}
			case 2: {  // paragraph
				const auto list = runs(int(next()));
				return y + para(list, f, x, y, w, true).height;
			}
			case 3: {  // image: [has picture, its width, its height, the width asked for or NaN, words, picture id or -1]
				const bool has = next() != 0;
				const double iw0 = next(), ih0 = next(), asked = next();
				const Ref text = ref();
				const int image = int(next());
				if (has && iw0 > 0) {
					const double iw = std::min(w, std::isnan(asked) ? iw0 : asked);
					const double ih = iw * ih0 / iw0;
					if (image < 0) ok_ = false;
					else if (ops_) {
						CardOp op;
						op.kind = CardOp::IMAGE;
						op.x = x, op.y = y, op.w = iw, op.h = ih;
						op.image = image;
						ops_->push_back(std::move(op));
					}
					return y + ih;
				}
				const double h = f.size * 3;
				box(x, y, w, h, palette_.subtle, 8);
				Frame mf = f;
				mf.colour = palette_.muted;
				// Measured first, then placed in the middle of the box.
				std::vector<CardOp>* keep = ops_;
				ops_ = nullptr;
				const double ph = words(text, mf, 0, 0, w - f.size * 2, f.size * 0.875, NAN, 2).height;
				ops_ = keep;
				words(text, mf, x + f.size, y + (h - ph) / 2, w - f.size * 2, f.size * 0.875, NAN, 2);
				return y + h;
			}
			case 4: {  // embed: [words]
				const Ref text = ref();
				const double pad = f.size * 0.75;
				std::vector<CardOp>* keep = ops_;
				ops_ = nullptr;
				const double ph = words(text, f, 0, 0, w - pad * 2, f.size * 0.94).height;
				ops_ = keep;
				const double h = ph + pad * 2;
				box(x, y, w, h, palette_.subtle, 8);
				words(text, f, x + pad, y + pad, w - pad * 2, f.size * 0.94);
				return y + h;
			}
			case 5: {  // list: [ordered, start, loose, items, then each: checked (-1 none), blocks, blocks...]
				const bool ordered = next() != 0;
				const int start = int(next());
				const bool loose = next() != 0;
				const int items = int(next());
				const double indent = f.size * 1.6;
				for (int i = 0; i < items; i++) {
					if (i > 0) y += loose ? f.size : f.size * 0.2;
					const double top = y;
					const int checked = int(next());
					if (checked >= 0) {
						const double size = f.size * 0.85;
						if (ops_) {
							CardOp op;
							op.kind = CardOp::CHECK;
							op.x = x + indent - size - f.size * 0.45;
							op.y = top + (f.size * 1.5 - size) / 2;
							op.w = op.h = size;
							op.checked = checked == 1;
							ops_->push_back(std::move(op));
						}
					} else {
						Frame mf = f;
						mf.colour = palette_.muted;
						ownWords(marker(ordered, start + i, f.depth), mf, x, top, indent - f.size * 0.4, 1);
					}
					const int blocks = int(next());
					y = stack(blocks, x + indent, y, w - indent, Frame{f.size, f.weight, f.depth + 1, f.colour}, loose ? f.size : 0);
				}
				return y;
			}
			case 6: {  // quote: [alert, title, alert colour, blocks, blocks...]
				const bool alert = next() != 0;
				const Ref title = ref();
				const CardColour accent = colour();
				const int blocks = int(next());
				const double bar = 2;
				const double pad = alert ? f.size * 0.4 : 0;
				const double inset = bar + f.size * 0.9;
				const double top = y;
				y += pad;
				if (alert) {
					Frame tf = f;
					tf.colour = accent;
					y += words(title, tf, x + inset, y, w - inset, NAN, 600).height;
					if (blocks) y += f.size * 0.3;
				}
				Frame qf = f;
				if (!alert) qf.colour = palette_.muted;
				y = stack(blocks, x + inset, y, w - inset, qf, f.size);
				y += pad;
				box(x, top, bar, std::max(1.0, y - top), alert ? accent : palette_.strong, 1);
				return y;
			}
			case 7: {  // code: [runs, then each: text, flags, colour]
				const double pad = f.size * 0.85;
				const int count = int(next());
				// The box goes under the words: measured, the box laid, then the words.
				const size_t mark = at_;
				std::vector<CardOp>* keep = ops_;
				ops_ = nullptr;
				const double ch = code(count, 0, 0, f.size * 0.88, w - pad * 2);
				ops_ = keep;
				at_ = mark;
				const double h = ch + pad * 2;
				box(x, y, w, h, palette_.subtle, 8);
				code(count, x + pad, y + pad, f.size * 0.88, w - pad * 2);
				return y + h;
			}
			case 8:
				return table(x, y, w, f);
			case 9:  // rule
				box(x, y + f.size * 0.5, w, 1, palette_.line);
				return y + f.size + 1;
			case 10: {  // footnotes: [items, then each: number, blocks, blocks...]
				box(x, y, w, 1, palette_.line);
				y += f.size * 0.75;
				const Frame small{f.size * 0.875, f.weight, f.depth, palette_.muted};
				const double indent = small.size * 1.6;
				const int items = int(next());
				for (int i = 0; i < items; i++) {
					if (i > 0) y += small.size * 0.2;
					const int number = int(next());
					ownWords(std::to_string(number) + ".", small, x, y, indent - small.size * 0.4, 1);
					y = stack(int(next()), x + indent, y, w - indent, small, 0);
				}
				return y;
			}
		}
		return y;
	}

	// A table, as `table` in markdown-layout.ts sets it: [columns, rows, aligns..., then each cell: runs, runs...].
	double table(double x, double y, double w, const Frame& f) {
		const int columns = int(next());
		const int rows = int(next());
		std::vector<int> aligns;
		for (int c = 0; c < columns; c++) aligns.push_back(int(next()));
		std::vector<std::vector<std::vector<Run>>> cells(static_cast<size_t>(rows), std::vector<std::vector<Run>>(static_cast<size_t>(columns)));
		for (int r = 0; r < rows; r++)
			for (int c = 0; c < columns; c++) cells[size_t(r)][size_t(c)] = runs(int(next()));
		const double padX = f.size * 0.75, padY = f.size * 0.45;
		auto left = [&](int c) { return c == 0 ? 0.0 : padX; };
		auto pads = [&](int c) { return left(c) + (c == columns - 1 ? 0.0 : padX); };
		Frame header = f;
		header.colour = palette_.muted;
		// Alignment as encoded (0 left, 1 centre, 2 right) to the painter's (0 left, 1 right, 2 centre).
		auto alignOf = [&](int c) { return aligns[size_t(c)] == 1 ? 2 : aligns[size_t(c)] == 2 ? 1 : 0; };
		auto cellPara = [&](int r, int c, double cx, double cy, double width, bool draw) {
			return para(cells[size_t(r)][size_t(c)], r == 0 ? header : f, cx, cy, width, draw, 1.5, r == 0 ? f.size * 0.9 : f.size, r == 0 ? 600 : f.weight, alignOf(c));
		};
		std::vector<double> natural(static_cast<size_t>(columns));
		for (int c = 0; c < columns; c++) {
			double widest = f.size * 2 + pads(c);
			for (int r = 0; r < rows; r++) {
				const double width = std::ceil(cellPara(r, c, 0, 0, 1e5, false).intrinsic) + 1;
				widest = std::max(widest, std::min(width, std::max(f.size * 16, w * 0.66)) + pads(c));
			}
			natural[size_t(c)] = widest;
		}
		double total = 0;
		for (double v : natural) total += v;
		std::vector<double> widths = natural;
		if (total < w)
			for (double& v : widths) v = v * w / total;
		double sum = 0;
		for (double v : widths) sum += v;
		const double content = std::max(w, sum);
		const bool scrolls = content > w + 0.5;
		std::vector<CardOp>* outer = ops_;
		std::vector<CardOp> own;
		if (scrolls && ops_) ops_ = &own;
		const double top = y;
		for (int r = 0; r < rows; r++) {
			double tallest = 0;
			for (int c = 0; c < columns; c++) tallest = std::max(tallest, cellPara(r, c, 0, 0, widths[size_t(c)] - pads(c), false).height);
			double cx = x;
			for (int c = 0; c < columns; c++) {
				cellPara(r, c, cx + left(c), y + padY, widths[size_t(c)] - pads(c), true);
				cx += widths[size_t(c)];
			}
			y += tallest + padY * 2;
			// A line under the header and a hairline between rows; none after the last.
			if (r < rows - 1) box(x, y - 0.5, content, 1, r == 0 ? palette_.strong : palette_.line);
		}
		if (scrolls) {
			ops_ = outer;
			const double bar = f.size * 0.6;
			if (ops_) {
				CardOp op;
				op.kind = CardOp::SCROLL;
				op.index = scrollers_++;
				op.x = x, op.y = top, op.w = w, op.h = y - top + bar;
				op.content = content;
				op.ops = std::move(own);
				ops_->push_back(std::move(op));
			}
			y += bar;
		}
		return y;
	}
	int scrollers_ = 0;
};

}  // namespace

// A card's height: `count` numbers at `nums`, strings in `pool`, laid out `width` wide.
double cardHeight(const double* nums, size_t count, const char* pool, double width) {
	Card card(nums, count, pool);
	return card.layout(width);
}

namespace {
void linksIn(const std::vector<CardOp>& ops, int scroller, std::vector<CardLink>& links, std::vector<CardScroller>& scrollers) {
	for (const CardOp& op : ops) {
		if (op.kind == CardOp::SCROLL) {
			scrollers.push_back({op.x, op.y, op.w, op.h, op.content});
			linksIn(op.ops, op.index, links, scrollers);
			continue;
		}
		if (op.kind != CardOp::TEXT) continue;
		bool any = false;
		for (const CardRunPaint& p : op.paints) any = any || p.hrefLength > 0;
		if (!any) continue;
		std::vector<PlacedGlyph> glyphs;
		std::vector<PlacedLine> lines;
		std::vector<PlacedPiece> pieces;
		double out[4];
		placeGlyphs(op.text.data(), int(op.text.size()), op.spans, op.base, op.lineHeight, op.w, op.align, glyphs, lines, out, &pieces);
		for (const PlacedPiece& piece : pieces) {
			if (piece.span < 0 || size_t(piece.span) >= op.paints.size()) continue;
			const CardRunPaint& p = op.paints[size_t(piece.span)];
			if (!p.hrefLength) continue;
			// As tall as the run's font, about its baseline (`getRectsForRange`, tight).
			double asc, desc;
			faceExtents(piece.face, &asc, &desc);
			const double size = op.spans[size_t(piece.span)].size;
			links.push_back({op.x + piece.x0, op.y + piece.baseline - asc * size, piece.x1 - piece.x0, (asc + desc) * size, p.hrefAt, p.hrefLength, scroller});
		}
	}
}
}  // namespace

void cardGeometry(const double* nums, size_t count, const char* pool, double width, std::vector<CardLink>& links, std::vector<CardScroller>& scrollers) {
	std::vector<CardOp> ops;
	CardPalette palette;
	bool ok = true;
	cardOps(nums, count, pool, width, ops, palette, ok);
	links.clear();
	scrollers.clear();
	linksIn(ops, -1, links, scrollers);
}

double cardOps(const double* nums, size_t count, const char* pool, double width, std::vector<CardOp>& ops, CardPalette& palette, bool& ok) {
	Card card(nums, count, pool);
	ops.clear();
	const double height = card.layout(width, &ops);
	palette = card.palette();
	ok = card.ok();
	return height;
}

extern "C" {
// For the tests: a card at `text_scratch` (its numbers first, as doubles, then its strings), `width` wide.
extern char* text_scratch(int bytes);
EMSCRIPTEN_KEEPALIVE double text_card(int count, int poolLength, double width) {
	const char* at = text_scratch(0);
	std::vector<double> nums(static_cast<size_t>(count));
	std::memcpy(nums.data(), at, size_t(count) * sizeof(double));
	return cardHeight(nums.data(), nums.size(), at + size_t(count) * sizeof(double), width);
	(void)poolLength;
}
}
