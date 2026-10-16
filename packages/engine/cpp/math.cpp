// The formulas handed over by the app (`math.h`).
#include "math.h"

#include <emscripten/emscripten.h>

#include <unordered_map>

extern "C" char* text_scratch(int bytes);  // `text.cpp`'s buffer, which the app writes into

namespace {
std::unordered_map<uint32_t, MathObject> formulas;
}

const MathObject* mathOf(uint32_t cp) {
	const auto found = formulas.find(cp - MATH_FIRST);
	return found == formulas.end() ? nullptr : &found->second;
}

extern "C" {

// A formula: `count` numbers at `text_scratch`, then `poolLength` bytes of its paths' SVG data:
// [number, width, ascent, descent, paths, then per path: a b c d e f (to ems, y down), r g b a,
// where its data starts in the pool and how long it is]. Handing a number over again replaces it.
EMSCRIPTEN_KEEPALIVE void text_math(int count, int poolLength) {
	const char* data = text_scratch(0);
	const double* n = reinterpret_cast<const double*>(data);
	const char* pool = data + size_t(count) * 8;
	if (count < 5) return;
	MathObject formula;
	const uint32_t number = uint32_t(n[0]);
	formula.width = n[1], formula.ascent = n[2], formula.descent = n[3];
	const int paths = int(n[4]);
	size_t at = 5;
	for (int i = 0; i < paths && at + 12 <= size_t(count); i++, at += 12) {
		const size_t from = size_t(n[at + 10]), length = size_t(n[at + 11]);
		if (from + length > size_t(poolLength)) break;
		raster::Path parsed;
		if (!raster::parseSvg(std::string(pool + from, length), parsed)) continue;
		MathPath one;
		one.path = parsed.transformed({n[at], n[at + 1], n[at + 2], n[at + 3], n[at + 4], n[at + 5]});
		for (int k = 0; k < 4; k++) one.rgba[k] = float(n[at + 6 + k]);
		formula.paths.push_back(std::move(one));
	}
	formulas[number] = std::move(formula);
}

}  // extern "C"
