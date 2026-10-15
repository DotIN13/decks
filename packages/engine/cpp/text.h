// What `text.cpp` offers the rest of the engine: runs of styled words, measured or placed glyph by glyph.
#pragma once
#include <cstddef>
#include <cstdint>
#include <vector>

struct hb_font_t;

// One run of words in one style: bytes [from, to) of the paragraph, its faces, size and spacing.
struct Span {
	size_t from, to;
	std::vector<int> chain;
	double size;
	double letterSpacing;
	// The weight and slant asked for, for a style its face does not have and Skia fakes.
	int weight = 400;
	bool italic = false;
};

// A glyph placed: its face, its number, its origin on the baseline, and its size; and a line, for its
// decorations: how far it is shifted by its alignment, its baseline, width, top and height.
struct PlacedGlyph { int face; uint32_t id; double x, y, size; int span; };
struct PlacedLine { double x, baseline, width, top, height; };
// A run's piece of a line, for what is drawn behind and over its words: its span and face, where it
// starts and ends across, its line's top and height, and the baseline Skia reports for the line.
struct PlacedPiece { int span, face; double x0, x1, top, height, baseline; };

int measureSpans(const char* s, int length, const std::vector<Span>& spans, const Span& base, double lineHeight, double maxWidth, double* out);
int placeGlyphs(const char* s, int length, const std::vector<Span>& spans, const Span& base, double lineHeight, double maxWidth, int align, std::vector<PlacedGlyph>& glyphs, std::vector<PlacedLine>& lines, double* out, std::vector<PlacedPiece>* pieces = nullptr);
std::vector<int> chainOf(const char* names, int length, int weight, bool italic);
// A face's HarfBuzz font (its scale is its units per em), for its outlines, and its metrics in those
// units: units per em, underline position and thickness, strikeout position and thickness.
hb_font_t* faceFont(int face);
void faceDecorations(int face, double out[5]);
// A face's font file, as it was handed over (`text_font`), for FreeType to draw its glyphs.
const char* faceBytes(int face, size_t* length);
// A face's own weight and slant, as it was matched (`pickFace`).
void faceStyle(int face, int* weight, bool* italic);
