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
};

struct CardOp {
	enum Kind { TEXT, BOX, CHECK, SCROLL } kind = BOX;
	double x = 0, y = 0, w = 0, h = 0, r = 0;
	CardColour colour;  // a box's fill; a paragraph's block colour
	bool checked = false;
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
// (a picture that has arrived).
double cardOps(const double* nums, size_t count, const char* pool, double width, std::vector<CardOp>& ops, CardPalette& palette, bool& ok);
