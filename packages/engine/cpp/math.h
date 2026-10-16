// Formulas: TeX typeset by MathJax in the app (`math.ts`), handed to the engine as a box and the paths
// that draw it. In text a formula is one character from Unicode's private-use plane, U+F0000 plus its
// number, so every path that carries words carries it too; the text engine gives that character the
// formula's width, height and depth (`text.cpp`), and the painter draws its paths there (`paint.cpp`).
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "raster.h"

constexpr uint32_t MATH_FIRST = 0xF0000, MATH_LAST = 0xFFFFD;
inline bool isMath(uint32_t cp) { return cp >= MATH_FIRST && cp <= MATH_LAST; }

// One path of a formula: its outline in ems, y down from the baseline, and its own colour, or none
// (alpha below zero) for the colour of the words around it.
struct MathPath {
	raster::Path path;
	float rgba[4];
};

// A formula, in ems: its width, how far it rises above the baseline and drops below it, and its paths.
struct MathObject {
	double width = 0, ascent = 0, descent = 0;
	std::vector<MathPath> paths;
};

// The formula a character stands for, if one has been handed over.
const MathObject* mathOf(uint32_t cp);
