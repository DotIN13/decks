// Right-to-left text: the embedding level of each code point (UAX #9), and the order a line's pieces
// are drawn in. A paragraph here always reads left to right at its base, as the app's CanvasKit
// paragraphs do (no text direction is set on them).
#pragma once
#include <cstddef>
#include <cstdint>
#include <vector>

// Each code point's level, 0 for left-to-right and 1 or 2 for right-to-left text and the numbers in
// it, resolved by the rules W1 to W7, N1, N2 and I1 of UAX #9 over each paragraph (split at line
// breaks). Explicit embeddings and isolates are taken as neutral; bracket pairs (N0) are not paired.
void bidiLevels(const std::vector<uint32_t>& cps, std::vector<uint8_t>& levels);

// The visual order of a line's items, given each one's level (rule L2): reversed from the highest
// level down to the lowest odd one. `order` comes back as indices into `levels`.
void bidiOrder(const std::vector<uint8_t>& levels, std::vector<size_t>& order);

// Whether a code point is whitespace or a separator that rule L1 puts back at the base level at a
// line's end.
bool bidiTrailing(uint32_t cp);
