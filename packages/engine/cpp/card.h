// A markdown card laid out for drawing (`card.cpp`): what `layoutMarkdown` in the app records as its
// drawing ops, so the painter (`paint.cpp`) can draw a card as CanvasKit does.
#pragma once
#include <string>
#include <vector>

#include "text.h"

// A colour; an alpha below zero means the colour of the block the words are in.
struct CardColour { float r = 0, g = 0, b = 0, a = 0; };

// How one run of a paragraph is drawn: its ink, the background behind it, and its lines (1 under,
// 2 through) in their colour.
struct CardRunPaint {
	CardColour ink, back;
	int lines = 0;
	CardColour lineInk;
	size_t hrefAt = 0, hrefLength = 0;  // its link's address in the card's pool; none when empty
};

struct CardOp {
	enum Kind { TEXT, BOX, CHECK, SCROLL, IMAGE } kind = BOX;
	double x = 0, y = 0, w = 0, h = 0, r = 0;
	CardColour colour;  // a box's fill; a paragraph's block colour
	bool checked = false;
	int image = -1;  // a picture's id (`paint_image`)
	// A paragraph: its words and runs, laid out `w` wide from (x, y).
	std::string text;
	std::vector<Span> spans;
	Span base{0, 0, {}, 14, 0};
	double lineHeight = 1.5;
	int align = 0;  // left, right, centre
	std::vector<CardRunPaint> paints;
	// A table too wide for the card: which one, how wide, and what is drawn in it.
	int index = 0;
	double content = 0;
	std::vector<CardOp> ops;
};

// The app's palette, as the card was encoded with it.
struct CardPalette { CardColour fg, muted, faint, line, strong, subtle, code, accent, box; };

// A card laid out `width` wide into `ops`; answers its height. `ok` is false for what it cannot record
// (a picture that has arrived but was not handed to the painter).
double cardOps(const double* nums, size_t count, const char* pool, double width, std::vector<CardOp>& ops, CardPalette& palette, bool& ok);

// What the page presses on a card: each link's box (from the card's top-left, and the wide table it
// scrolls with or -1) and its address in the pool, and each wide table's box and width.
struct CardLink { double x, y, w, h; size_t hrefAt, hrefLength; int scroller; };
struct CardScroller { double x, y, w, h, content; };
void cardGeometry(const double* nums, size_t count, const char* pool, double width, std::vector<CardLink>& links, std::vector<CardScroller>& scrollers);
