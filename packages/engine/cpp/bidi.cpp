// UAX #9, the part a left-to-right paragraph of plain text needs (`bidi.h`). The classes come from
// Unicode 15.1 (`bidi-data.h`, written by tools/gen-bidi.mjs).
#include "bidi.h"

#include <algorithm>

#include "bidi-data.h"

namespace {

uint8_t classOf(uint32_t cp) {
	size_t lo = 0, hi = sizeof(BIDI_RANGES) / sizeof(BIDI_RANGES[0]);
	while (lo < hi) {
		const size_t mid = (lo + hi) / 2;
		if (cp < BIDI_RANGES[mid].first) hi = mid;
		else if (cp > BIDI_RANGES[mid].last) lo = mid + 1;
		else return BIDI_RANGES[mid].cls;
	}
	return B_L;
}

bool neutral(uint8_t t) { return t == B_B || t == B_S || t == B_WS || t == B_ON || t == B_LRI || t == B_RLI || t == B_FSI || t == B_PDI; }

// One paragraph at base level 0, as one isolating run sequence with sos and eos both L.
void paragraph(const std::vector<uint32_t>& cps, size_t from, size_t to, std::vector<uint8_t>& levels) {
	const size_t n = to - from;
	std::vector<uint8_t> t(n);
	for (size_t i = 0; i < n; i++) {
		uint8_t c = classOf(cps[from + i]);
		// X9: embeddings and overrides are taken out, as boundary neutrals; isolates stay as neutrals.
		if (c == B_LRE || c == B_RLE || c == B_LRO || c == B_RLO || c == B_PDF) c = B_BN;
		t[i] = c;
	}
	if (std::none_of(t.begin(), t.end(), [](uint8_t c) { return c == B_R || c == B_AL || c == B_AN; })) {
		std::fill(levels.begin() + long(from), levels.begin() + long(to), 0);
		return;
	}
	// A boundary neutral takes the type of what it follows, so it changes nothing below (X9's removal).
	for (size_t i = 0; i < n; i++)
		if (t[i] == B_BN) t[i] = i > 0 ? t[i - 1] : B_L;
	// W1: a mark takes the type of what it follows; after an isolate's edge, ON.
	for (size_t i = 0; i < n; i++)
		if (t[i] == B_NSM) t[i] = i == 0 ? B_L : (t[i - 1] == B_LRI || t[i - 1] == B_RLI || t[i - 1] == B_FSI || t[i - 1] == B_PDI) ? B_ON : t[i - 1];
	// W2: European digits after Arabic letters are Arabic digits.
	{
		uint8_t strong = B_L;
		for (size_t i = 0; i < n; i++) {
			if (t[i] == B_R || t[i] == B_L || t[i] == B_AL) strong = t[i];
			else if (t[i] == B_EN && strong == B_AL) t[i] = B_AN;
		}
	}
	// W3: Arabic letters are right to left.
	for (auto& c : t)
		if (c == B_AL) c = B_R;
	// W4: one separator between two numbers of a kind joins them.
	for (size_t i = 1; i + 1 < n; i++) {
		if (t[i] == B_ES && t[i - 1] == B_EN && t[i + 1] == B_EN) t[i] = B_EN;
		else if (t[i] == B_CS && t[i - 1] == B_EN && t[i + 1] == B_EN) t[i] = B_EN;
		else if (t[i] == B_CS && t[i - 1] == B_AN && t[i + 1] == B_AN) t[i] = B_AN;
	}
	// W5: terminators (currency, percent) next to European digits are part of the number.
	for (size_t i = 0; i < n;) {
		if (t[i] != B_ET) {
			i++;
			continue;
		}
		size_t j = i;
		while (j < n && t[j] == B_ET) j++;
		const bool touches = (i > 0 && t[i - 1] == B_EN) || (j < n && t[j] == B_EN);
		if (touches)
			for (size_t k = i; k < j; k++) t[k] = B_EN;
		i = j;
	}
	// W6: the separators and terminators left are neutrals.
	for (auto& c : t)
		if (c == B_ES || c == B_ET || c == B_CS) c = B_ON;
	// W7: European digits in left-to-right surroundings are left to right.
	{
		uint8_t strong = B_L;
		for (size_t i = 0; i < n; i++) {
			if (t[i] == B_R || t[i] == B_L) strong = t[i];
			else if (t[i] == B_EN && strong == B_L) t[i] = B_L;
		}
	}
	// N1, N2: a run of neutrals between two of one direction takes it (numbers count as right to left);
	// otherwise the paragraph's, left to right.
	auto dir = [](uint8_t c) -> int { return c == B_L ? 0 : (c == B_R || c == B_EN || c == B_AN) ? 1 : -1; };
	for (size_t i = 0; i < n;) {
		if (!neutral(t[i])) {
			i++;
			continue;
		}
		size_t j = i;
		while (j < n && neutral(t[j])) j++;
		const int before = i == 0 ? 0 : dir(t[i - 1]);
		const int after = j == n ? 0 : dir(t[j]);
		const uint8_t to = before == after && before >= 0 ? (before == 1 ? B_R : B_L) : B_L;
		for (size_t k = i; k < j; k++) t[k] = to;
		i = j;
	}
	// I1: at the even base level, right to left goes up one, numbers two.
	for (size_t i = 0; i < n; i++) levels[from + i] = t[i] == B_R ? 1 : (t[i] == B_AN || t[i] == B_EN) ? 2 : 0;
}

}  // namespace

void bidiLevels(const std::vector<uint32_t>& cps, std::vector<uint8_t>& levels) {
	levels.assign(cps.size(), 0);
	size_t from = 0;
	for (size_t i = 0; i <= cps.size(); i++) {
		if (i < cps.size() && classOf(cps[i]) != B_B) continue;
		if (i > from) paragraph(cps, from, i, levels);
		from = i + 1;
	}
}

void bidiOrder(const std::vector<uint8_t>& levels, std::vector<size_t>& order) {
	order.resize(levels.size());
	for (size_t i = 0; i < order.size(); i++) order[i] = i;
	if (levels.empty()) return;
	uint8_t high = 0, lowOdd = 255;
	for (uint8_t l : levels) {
		high = std::max(high, l);
		if (l % 2 == 1) lowOdd = std::min(lowOdd, l);
	}
	if (high == 0) return;
	if (lowOdd == 255) lowOdd = 1;
	for (int level = high; level >= lowOdd; level--)
		for (size_t i = 0; i < order.size();) {
			if (levels[order[i]] < level) {
				i++;
				continue;
			}
			size_t j = i;
			while (j < order.size() && levels[order[j]] >= level) j++;
			std::reverse(order.begin() + long(i), order.begin() + long(j));
			i = j;
		}
}

bool bidiTrailing(uint32_t cp) {
	const uint8_t c = classOf(cp);
	return c == B_WS || c == B_S || c == B_B || c == B_BN || c == B_LRI || c == B_RLI || c == B_FSI || c == B_PDI;
}
