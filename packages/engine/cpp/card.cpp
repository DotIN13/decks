// A markdown card's height, laid out in C++ as the app's `layoutMarkdown` lays it out
// (`apps/web/src/canvas/pen/markdown-layout.ts`): the same blocks, gaps, indents and table widths, with
// every paragraph measured by `text.cpp`. The page parses the markdown and hands the blocks here
// encoded (`card-wire.ts` in the app); `test/card-diff.mjs` holds the height to CanvasKit's.
//
// The encoding: numbers, and a pool of UTF-8 a string is a reference into (its offset and length).
// A card is [version, fontSize, fontWeight, letterSpacing, lineHeight or NaN, base chain, mono chain,
// block count, blocks...]; a run of words is [text, chain, flags (1 code, 2 superscript, 4 bold,
// 8 italic), size scale]; the blocks are read in `one`.
#include <emscripten/emscripten.h>

#include <algorithm>
#include <cstring>
#include <cmath>
#include <map>
#include <string>
#include <tuple>
#include <vector>

struct Span {
	size_t from, to;
	std::vector<int> chain;
	double size;
	double letterSpacing;
};
int measureSpans(const char* s, int length, const std::vector<Span>& spans, const Span& base, double lineHeight, double maxWidth, double* out);
std::vector<int> chainOf(const char* names, int length, int weight, bool italic);

namespace {

constexpr double HEADING_SIZE[6] = {1.6, 1.3, 1.12, 1, 0.9, 0.85};
constexpr double SIZE_SCALE_NONE = 1;

struct Ref { size_t at, length; };

struct Run {
	Ref text, chain;
	int flags;
	double scale;
};

struct Frame {
	double size;
	double weight;
	int depth;
};

struct Para {
	double height;
	double intrinsic;  // unbroken width, to a hundredth
};

class Card {
public:
	Card(const double* nums, size_t count, const char* pool) : n_(nums), count_(count), pool_(pool) {}

	double height(double width) {
		at_ = 0;
		const double version = next();
		(void)version;
		fontSize_ = next();
		fontWeight_ = next();
		letterSpacing_ = next();
		lineHeight_ = next();
		base_ = ref();
		mono_ = ref();
		const int blocks = int(next());
		const Frame f{fontSize_, fontWeight_, 0};
		return stack(blocks, 0, width, f, fontSize_);
	}

private:
	const double* n_;
	size_t count_;
	const char* pool_;
	size_t at_ = 0;
	double fontSize_ = 14, fontWeight_ = 400, letterSpacing_ = 0, lineHeight_ = NAN;
	Ref base_{0, 0}, mono_{0, 0};
	std::map<std::tuple<size_t, size_t, int, bool>, std::vector<int>> chains_;

	double next() { return at_ < count_ ? n_[at_++] : 0; }
	Ref ref() {
		const size_t a = size_t(next());
		const size_t l = size_t(next());
		return {a, l};
	}
	Run run() {
		Run r;
		r.text = ref();
		r.chain = ref();
		r.flags = int(next());
		r.scale = next();
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

	// One paragraph of runs, as `para` in markdown-layout.ts builds it, laid out at `w`.
	Para para(const std::vector<Run>& list, const Frame& f, double w, double lineHeight = 1.5, double size = NAN, double weight = NAN) {
		const double sz = std::isnan(size) ? f.size : size;
		const double wt = std::isnan(weight) ? f.weight : weight;
		std::string text;
		std::vector<Span> spans;
		Span base{0, 0, chain(base_, int(wt), false), sz, letterSpacing_};
		auto add = [&](const std::string& words, Ref names, int flags, double scale) {
			const bool code = flags & 1, sup = flags & 2, bold = flags & 4, italic = flags & 8;
			const double runSize = (sup ? sz * 0.75 : code ? sz * 0.88 : sz) * scale;
			const int runWeight = int(bold ? std::max(600.0, wt + 200) : wt);
			Span span{text.size(), text.size() + words.size(), chain(names, runWeight, italic), runSize, letterSpacing_};
			text += words;
			spans.push_back(span);
		};
		if (list.empty()) add(" ", base_, 0, SIZE_SCALE_NONE);
		for (const Run& r : list) add(std::string(pool_ + r.text.at, r.text.length), r.chain, r.flags, r.scale);
		double out[4];
		measureSpans(text.data(), int(text.size()), spans, base, std::isnan(lineHeight_) ? lineHeight : lineHeight_, std::max(1.0, w), out);
		return {out[2], out[0]};
	}
	// Words of the card's own, a marker, a title, a placeholder: one plain run.
	Para words(Ref text, const Frame& f, double w, double size = NAN, double weight = NAN) {
		return para(std::vector<Run>{Run{text, base_, 0, 1}}, f, w, 1.5, size, weight);
	}

	// Code, set as `colouredCode` sets it: the mono face at 0.88 of the size, a line height of 1.5, no spacing.
	double code(int count, double size, double w) {
		std::string text;
		std::vector<Span> spans;
		Span base{0, 0, chain(mono_, 400, false), size, 0};
		for (int i = 0; i < count; i++) {
			const Ref t = ref();
			const int flags = int(next());
			std::string words(pool_ + t.at, t.length);
			if (words.empty()) words = " ";
			spans.push_back(Span{text.size(), text.size() + words.size(), chain(mono_, flags & 4 ? 700 : 400, flags & 8), size, 0});
			text += words;
		}
		if (spans.empty()) {
			text = " ";
			spans.push_back(Span{0, 1, base.chain, size, 0});
		}
		double out[4];
		measureSpans(text.data(), int(text.size()), spans, base, 1.5, std::max(1.0, w), out);
		return out[2];
	}

	double stack(int count, double y, double w, const Frame& f, double gap) {
		for (int i = 0; i < count; i++) {
			const int kind = int(n_[at_]);
			if (i > 0) y += kind == 1 ? std::max(gap, f.size * 1.25) : gap;
			y = one(y, w, f);
		}
		return y;
	}

	double one(double y, double w, const Frame& f) {
		const int kind = int(next());
		switch (kind) {
			case 1: {  // heading
				const int level = std::clamp(int(next()), 1, 6);
				const auto list = runs(int(next()));
				return y + para(list, f, w, 1.3, f.size * HEADING_SIZE[level - 1], 600).height;
			}
			case 2: {  // paragraph
				const auto list = runs(int(next()));
				return y + para(list, f, w).height;
			}
			case 3: {  // image: [has picture, its width, its height, the width asked for or NaN, words]
				const bool has = next() != 0;
				const double iw0 = next(), ih0 = next(), asked = next();
				const Ref text = ref();
				if (has && iw0 > 0) {
					const double iw = std::min(w, std::isnan(asked) ? iw0 : asked);
					return y + iw * ih0 / iw0;
				}
				(void)text;
				return y + f.size * 3;
			}
			case 4: {  // embed: [words]
				const Ref text = ref();
				const double pad = f.size * 0.75;
				return y + words(text, f, w - pad * 2, f.size * 0.94).height + pad * 2;
			}
			case 5: {  // list: [ordered, start, loose, items, then each: checked (-1 none), blocks, blocks...]
				next();
				next();
				const bool loose = next() != 0;
				const int items = int(next());
				const double indent = f.size * 1.6;
				for (int i = 0; i < items; i++) {
					if (i > 0) y += loose ? f.size : f.size * 0.2;
					next();  // checked: drawn, not measured
					const int blocks = int(next());
					y = stack(blocks, y, w - indent, Frame{f.size, f.weight, f.depth + 1}, loose ? f.size : 0);
				}
				return y;
			}
			case 6: {  // quote: [alert, title, blocks, blocks...]
				const bool alert = next() != 0;
				const Ref title = ref();
				const int blocks = int(next());
				const double pad = alert ? f.size * 0.4 : 0;
				const double inset = 2 + f.size * 0.9;
				y += pad;
				if (alert) {
					y += words(title, f, w - inset, NAN, 600).height;
					if (blocks) y += f.size * 0.3;
				}
				y = stack(blocks, y, w - inset, f, f.size);
				return y + pad;
			}
			case 7: {  // code: [runs, then each: text, flags]
				const double pad = f.size * 0.85;
				return y + code(int(next()), f.size * 0.88, w - pad * 2) + pad * 2;
			}
			case 8:
				return table(y, w, f);
			case 9:  // rule
				return y + f.size + 1;
			case 10: {  // footnotes: [items, then each: number, blocks, blocks...]
				y += f.size * 0.75;
				const Frame small{f.size * 0.875, f.weight, f.depth};
				const double indent = small.size * 1.6;
				const int items = int(next());
				for (int i = 0; i < items; i++) {
					if (i > 0) y += small.size * 0.2;
					next();
					y = stack(int(next()), y, w - indent, small, 0);
				}
				return y;
			}
		}
		return y;
	}

	// A table, as `table` in markdown-layout.ts sets it: [columns, rows, aligns..., then each cell: runs, runs...].
	double table(double y, double w, const Frame& f) {
		const int columns = int(next());
		const int rows = int(next());
		for (int c = 0; c < columns; c++) next();  // alignment: drawn, not measured
		std::vector<std::vector<std::vector<Run>>> cells(static_cast<size_t>(rows), std::vector<std::vector<Run>>(static_cast<size_t>(columns)));
		for (int r = 0; r < rows; r++)
			for (int c = 0; c < columns; c++) cells[size_t(r)][size_t(c)] = runs(int(next()));
		const double padX = f.size * 0.75, padY = f.size * 0.45;
		auto left = [&](int c) { return c == 0 ? 0.0 : padX; };
		auto pads = [&](int c) { return left(c) + (c == columns - 1 ? 0.0 : padX); };
		auto cellPara = [&](int r, int c, double width) {
			return para(cells[size_t(r)][size_t(c)], f, width, 1.5, r == 0 ? f.size * 0.9 : f.size, r == 0 ? 600 : f.weight);
		};
		std::vector<double> natural(static_cast<size_t>(columns));
		for (int c = 0; c < columns; c++) {
			double widest = f.size * 2 + pads(c);
			for (int r = 0; r < rows; r++) {
				const double width = std::ceil(cellPara(r, c, 1e5).intrinsic) + 1;
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
		for (int r = 0; r < rows; r++) {
			double tallest = 0;
			for (int c = 0; c < columns; c++) tallest = std::max(tallest, cellPara(r, c, widths[size_t(c)] - pads(c)).height);
			y += tallest + padY * 2;
		}
		if (scrolls) y += f.size * 0.6;
		return y;
	}
};

}  // namespace

// A card's height: `count` numbers at `nums`, strings in `pool`, laid out `width` wide.
double cardHeight(const double* nums, size_t count, const char* pool, double width) {
	Card card(nums, count, pool);
	return card.height(width);
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
