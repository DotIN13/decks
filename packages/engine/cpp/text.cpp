// Text: words measured and broken into lines in C++, for the layout (`scene.cpp`) and, later, for
// drawing. Shaped by HarfBuzz, as Figma shapes text; the fonts are the files the page fetches, and
// the rest is ours: which font each letter comes from, where a line may break, and how lines stack.
//
// The reference is what the app measures with today, CanvasKit's paragraph (`apps/web/src/canvas/pen/
// fonts.ts`), and `test/text-diff.mjs` holds this to it: lines are stacked at whole pixels (a line's
// height is rounded, as Skia's paragraph rounds it), a paragraph's unbroken width is rounded to a
// hundredth, and letter spacing follows every letter, the last included.
#include <emscripten/emscripten.h>
#include <hb-ot.h>
#include <hb.h>

#include "linebreak-data.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <unordered_map>

#include "text.h"
#include <vector>

namespace {

struct Face {
	std::string family;
	int weight = 400;
	bool italic = false;
	hb_blob_t* blob = nullptr;
	hb_face_t* face = nullptr;
	hb_font_t* font = nullptr;
	const char* bytes = nullptr;  // the file, which the blob owns
	size_t length = 0;
	double upem = 1000;
	double ascent = 0, descent = 0;  // per unit of font size, both positive
	int ascender = 0, descender = 0, lineGap = 0;  // in font units, as the file states them (descender negative)
};
std::vector<Face> faces;
std::vector<char> scratch(4096);
double answer[8];
// Where each line of the last measure starts and ends, in UTF-8 bytes, and its width: three numbers a line.
std::vector<double> lineSpans;

// --- fonts ---------------------------------------------------------------------------------------

// The one face of a family that suits a weight and a slant: Skia's `matchStyleCSS3`, as CanvasKit's
// font provider uses it. Slant counts 256 a step and weight up to 1000, so an exact weight upright
// beats the right slant at another weight; on a tie the face registered first wins.
int pickFace(const std::string& family, int weight, bool italic) {
	int best = -1, bestScore = -1;
	for (int i = 0; i < int(faces.size()); i++) {
		if (faces[i].family != family) continue;
		const int w = faces[i].weight;
		int score = (faces[i].italic == italic ? 3 : 1) << 8;
		if (weight == w) score += 1000;
		else if (weight < 400) score += w <= weight ? 1000 - weight + w : 1000 - w;
		else if (weight <= 500) score += w >= weight && w <= 500 ? 1000 + weight - w : w <= weight ? 500 + w : 1000 - w;
		else score += w > weight ? 1000 + weight - w : w;
		if (score > bestScore) {
			bestScore = score;
			best = i;
		}
	}
	return best;
}

bool hasGlyph(int face, uint32_t cp) {
	hb_codepoint_t glyph;
	return hb_font_get_nominal_glyph(faces[face].font, cp, &glyph);
}

// --- where a line may break: Unicode's line-break rules (UAX #14), as of Unicode 15.1 ----------------

using namespace linebreak;

struct Prop { uint8_t cls, flags; };

Prop propOf(uint32_t c) {
	int lo = 0, hi = RANGES - 1;
	while (lo <= hi) {
		const int mid = (lo + hi) / 2;
		if (c < table[mid].from) hi = mid - 1;
		else if (c > table[mid].to) lo = mid + 1;
		else return {table[mid].cls, table[mid].flags};
	}
	return {AL, 0};
}

bool isCM(uint8_t k) { return k == CM || k == ZWJ; }
bool isHard(uint8_t k) { return k == BK || k == CR || k == LF || k == NL; }

// Whether a line may break before each code point; index 0 never. The rules, LB7 to LB31, in order:
// the first that speaks decides.
void breaks(const std::vector<uint32_t>& cps, std::vector<char>& out) {
	const size_t n = cps.size();
	out.assign(n, 0);
	std::vector<uint8_t> raw(n), cls(n), fl(n);
	std::vector<char> attached(n, 0);
	for (size_t i = 0; i < n; i++) {
		const Prop p = propOf(cps[i]);
		raw[i] = p.cls;
		cls[i] = p.cls;
		fl[i] = p.flags;
		// LB9: a mark or a joiner after anything but a space or a break is part of it, and takes its class.
		if (isCM(p.cls) && i > 0 && !isHard(cls[i - 1]) && cls[i - 1] != SP && cls[i - 1] != ZW) {
			cls[i] = cls[i - 1];
			fl[i] = fl[i - 1];
			attached[i] = 1;
		} else if (isCM(p.cls)) cls[i] = AL;  // LB10
	}
	auto ea = [&](size_t i) { return (fl[i] & EAST_ASIAN) != 0; };
	auto in = [](uint8_t k, std::initializer_list<uint8_t> set) {
		for (uint8_t s : set)
			if (k == s) return true;
		return false;
	};
	for (size_t i = 1; i < n; i++) {
		const uint8_t a = cls[i - 1], b = cls[i];
		// The last code point before any spaces in front of this one.
		size_t j = i - 1;
		while (j > 0 && cls[j] == SP) j--;
		const uint8_t p = cls[j];
		const bool afterSpaces = a == SP;
		bool can = true;
		if (attached[i]) can = false;                                                        // LB9
		else if (b == SP || b == ZW) can = false;                                           // LB7
		else if (p == ZW && (afterSpaces || a == ZW)) can = true;                           // LB8
		else if (raw[i - 1] == ZWJ) can = false;                                            // LB8a
		else if (a == WJ || b == WJ) can = false;                                           // LB11
		else if (a == GL) can = false;                                                      // LB12
		else if (b == GL && !in(a, {SP, BA, HY})) can = false;                              // LB12a
		else if (in(b, {CL, CP, EX, SY})) can = false;                                      // LB13
		else if (p == OP) can = false;                                                      // LB14
		else if (p == QU && (fl[j] & PI) && (j == 0 || in(cls[j - 1], {BK, CR, LF, NL, OP, QU, GL, SP, ZW}))) can = false;  // LB15a
		else if (b == QU && (fl[i] & PF) && (i + 1 == n || in(cls[i + 1], {SP, GL, WJ, CL, QU, CP, EX, IS, SY, BK, CR, LF, NL, ZW}))) can = false;  // LB15b
		else if (a == SP && b == IS && i + 1 < n && cls[i + 1] == NU) can = true;           // LB15c
		else if (b == IS) can = false;                                                      // LB15d
		else if (in(p, {CL, CP}) && b == NS) can = false;                                   // LB16
		else if (p == B2 && b == B2) can = false;                                           // LB17
		else if (afterSpaces) can = true;                                                   // LB18
		else if (b == QU && !(fl[i] & PI)) can = false;                                     // LB19
		else if (a == QU && !(fl[i - 1] & PF)) can = false;
		else if (b == QU && !ea(i - 1)) can = false;                                        // LB19a
		else if (b == QU && (i + 1 == n || !ea(i + 1))) can = false;
		else if (a == QU && !ea(i)) can = false;
		else if (a == QU && (i < 2 || !ea(i - 2))) can = false;
		else if (a == CB || b == CB) can = true;                                            // LB20
		// LB20a, as ICU has it: a dash that starts a word (a hyphen, or a narrow dash such as –) stays with the letter after it.
		else if ((a == HY || (a == BA && !ea(i - 1))) && in(b, {AL, HL}) && (i < 2 || in(cls[i - 2], {BK, CR, LF, NL, SP, ZW, CB, GL}))) can = false;
		else if (in(b, {BA, HY, NS}) || a == BB) can = false;                               // LB21
		else if (i >= 2 && cls[i - 2] == HL && (a == HY || (a == BA && !ea(i - 1))) && b != HL) can = false;  // LB21a
		else if (a == SY && b == HL) can = false;                                           // LB21b
		else if (b == IN) can = false;                                                      // LB22
		else if ((in(a, {AL, HL}) && b == NU) || (a == NU && in(b, {AL, HL}))) can = false;  // LB23
		else if ((a == PR && in(b, {ID, EB, EM})) || (in(a, {ID, EB, EM}) && b == PO)) can = false;  // LB23a
		else if ((in(a, {PR, PO}) && in(b, {AL, HL})) || (in(a, {AL, HL}) && in(b, {PR, PO}))) can = false;  // LB24
		else {
			// LB25, as Unicode 15.1 writes it: the parts of a number stay together.
			bool keep = false;
			if (in(a, {PR, PO}) && b == NU) keep = true;
			else if (in(a, {PR, PO}) && in(b, {OP, HY}) && i + 1 < n && cls[i + 1] == NU) keep = true;
			else if (in(a, {OP, HY}) && b == NU) keep = true;
			// ICU's number also lets a full stop, comma or colon lead it: ".5".
			else if (a == IS && b == NU) keep = true;
			else if (in(b, {NU, SY, IS, CL, CP, PO, PR})) {
				size_t k = i;
				if (in(b, {PO, PR}) && k > 0 && in(cls[k - 1], {CL, CP})) k--;
				bool number = false;
				while (k > 0 && in(cls[k - 1], {NU, SY, IS})) {
					k--;
					if (cls[k] == NU) number = true;
				}
				// The run before must start at a digit: NU (NU | SY | IS)*.
				if (number) {
					size_t first = k;
					while (first < i && cls[first] != NU) first++;
					number = first < i;
				}
				if (number && (in(b, {NU, SY, IS, CL, CP}) ? !in(a, {CL, CP}) : true)) keep = true;
			}
			if (keep) can = false;
			else if ((a == JL && in(b, {JL, JV, H2, H3})) || (in(a, {JV, H2}) && in(b, {JV, JT})) || (in(a, {JT, H3}) && b == JT)) can = false;  // LB26
			else if ((in(a, {JL, JV, JT, H2, H3}) && b == PO) || (a == PR && in(b, {JL, JV, JT, H2, H3}))) can = false;  // LB27
			else if (in(a, {AL, HL}) && in(b, {AL, HL})) can = false;                       // LB28
			else if (a == AP && in(b, {AK, AS}) ) can = false;                              // LB28a, the common part
			else if (in(a, {AK, AS}) && in(b, {VF, VI})) can = false;
			else if (a == IS && in(b, {AL, HL})) can = false;                               // LB29
			else if (in(a, {AL, HL, NU}) && b == OP && !ea(i)) can = false;                 // LB30
			else if (a == CP && !ea(i - 1) && in(b, {AL, HL, NU})) can = false;
			else if (a == RI && b == RI) {                                                  // LB30a
				size_t count = 0;
				for (size_t k = i; k > 0 && cls[k - 1] == RI; k--) count++;
				can = count % 2 == 0;
			} else if (b == EM && (a == EB || ((fl[i - 1] & PICTOGRAPHIC) && (fl[i - 1] & UNASSIGNED)))) can = false;  // LB30b
			else can = true;                                                                // LB31
		}
		out[i] = can;
	}
}

// --- measuring ------------------------------------------------------------------------------------

struct Run { int face; size_t from, to; };  // code point indices

uint32_t decode(const char* s, size_t n, size_t& i) {
	const unsigned char c = (unsigned char)s[i];
	if (c < 0x80) return s[i++], c;
	int len = c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : 2;
	uint32_t cp = c & (len == 4 ? 0x07 : len == 3 ? 0x0F : 0x1F);
	i++;
	for (int k = 1; k < len && i < n; k++, i++) cp = (cp << 6) | ((unsigned char)s[i] & 0x3F);
	return cp;
}

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE char* text_scratch(int bytes) {
	if (int(scratch.size()) < bytes) scratch.resize(bytes);
	return scratch.data();
}
EMSCRIPTEN_KEEPALIVE double* text_answer() { return answer; }
EMSCRIPTEN_KEEPALIVE double* text_lines() { return lineSpans.data(); }

// A font file, `bytes` long at `text_scratch`, for a family named by `nameLength` bytes after it.
// Its weight and slant come from the file, as Skia's provider reads them. Returns its number.
EMSCRIPTEN_KEEPALIVE int text_font(int bytes, int nameLength) {
	Face f;
	f.family.assign(scratch.data() + bytes, size_t(nameLength));
	char* copy = static_cast<char*>(std::malloc(size_t(bytes)));
	std::memcpy(copy, scratch.data(), size_t(bytes));
	f.blob = hb_blob_create(copy, unsigned(bytes), HB_MEMORY_MODE_READONLY, copy, std::free);
	f.bytes = copy;
	f.length = size_t(bytes);
	f.face = hb_face_create(f.blob, 0);
	f.font = hb_font_create(f.face);
	f.upem = hb_face_get_upem(f.face);
	hb_font_set_scale(f.font, int(f.upem), int(f.upem));
	f.weight = int(std::lround(hb_style_get_value(f.font, HB_STYLE_TAG_WEIGHT)));
	f.italic = hb_style_get_value(f.font, HB_STYLE_TAG_ITALIC) > 0.5f;
	hb_font_extents_t extents;
	hb_font_get_h_extents(f.font, &extents);
	f.ascent = double(extents.ascender) / f.upem;
	f.descent = -double(extents.descender) / f.upem;
	f.ascender = extents.ascender;
	f.descender = extents.descender;
	f.lineGap = extents.line_gap;
	faces.push_back(f);
	return int(faces.size() - 1);
}

}  // extern "C"

// A font chain, each family named one a line, narrowed to its faces for a weight and a slant.
std::vector<int> chainOf(const char* names, int length, int weight, bool italic) {
	std::vector<int> chain;
	std::string all(names, size_t(length));
	size_t at = 0;
	while (at <= all.size()) {
		size_t nl = all.find('\n', at);
		if (nl == std::string::npos) nl = all.size();
		const int face = pickFace(all.substr(at, nl - at), weight, italic);
		if (face >= 0 && std::find(chain.begin(), chain.end(), face) == chain.end()) chain.push_back(face);
		at = nl + 1;
	}
	return chain;
}


// One glyph of a cluster: its number in its font, and where it sits from the cluster's start, in pixels.
struct ClusterGlyph { uint32_t id; float dx, dy; };

// A line as laid out: its code points [start, visible) drawn, up to `end` with the spaces it ends in;
// its width without them, its top and height in the paragraph, and its fonts' ascent (negative) and descent.
struct LineOut { size_t start, visible, end; double width, top, height; float ascent, descent; };

// A paragraph shaped: everything about it that does not depend on the width it is laid out at.
struct Shaped {
	std::vector<std::vector<ClusterGlyph>> glyphs;  // each cluster's, at its first code point
	std::vector<uint32_t> cps;
	std::vector<size_t> starts;
	std::vector<int> sp, faceOf, glyphCount, scriptRun, glyphFrom, glyphTo, runOf;
	std::vector<double> advance;
	std::vector<char> clusterStart, canBreak;
	std::vector<float> posAt;
};

void shapeInto(Shaped& out, const char* s, int length, const std::vector<Span>& spans) {
	// Code points, where each starts, and the font each comes from.
	std::vector<uint32_t> cps;
	std::vector<size_t> starts;
	for (size_t i = 0; i < size_t(length);) {
		starts.push_back(i);
		cps.push_back(decode(s, size_t(length), i));
	}
	const size_t n = cps.size();
	// Which run each code point is in.
	std::vector<int> sp(n, 0);
	for (size_t i = 0, k = 0; i < n; i++) {
		while (k + 1 < spans.size() && starts[i] >= spans[k].to) k++;
		sp[i] = int(k);
	}
	/*
	 * Shaped as Skia's paragraph shapes (`OneLineShaper`): all of it with the first font, keeping each
	 * cluster that font draws, then what is left with the next font, and so on; what no font draws
	 * stays with the first. A letter a font lacks may still be drawn by it: HarfBuzz takes "ź" apart
	 * into "z" and its accent, so a bold face without "ź" draws it bold rather than handing it on.
	 */
	std::vector<int> faceOf(n, -1);
	std::vector<double> advance(n, 0);
	std::vector<char> clusterStart(n, 0);
	std::vector<int> glyphCount(n, 0);
	std::vector<std::vector<ClusterGlyph>> clusterGlyphs(n);
	// With letter spacing that pulls letters apart, they are not joined into ligatures, as Skia's paragraph shapes them.
	static const hb_feature_t noLigatures[] = {{HB_TAG('l', 'i', 'g', 'a'), 0, 0, unsigned(-1)}, {HB_TAG('c', 'l', 'i', 'g'), 0, 0, unsigned(-1)}};
	/*
	 * Script runs, as Skia's shaper makes them: a run takes the script of its first letter that has one,
	 * and spaces, punctuation and marks stay in the run they follow. So in "中 [d" the bracket shapes with
	 * the Chinese, and "[" and "d" are never kerned as a pair.
	 */
	std::vector<int> scriptRun(n, 0);
	std::vector<hb_script_t> runScript;
	{
		hb_unicode_funcs_t* ufuncs = hb_unicode_funcs_get_default();
		hb_script_t current = HB_SCRIPT_COMMON;
		int run = 0;
		runScript.push_back(HB_SCRIPT_COMMON);
		for (size_t i = 0; i < n; i++) {
			const hb_script_t sc = hb_unicode_script(ufuncs, cps[i]);
			const bool neutral = sc == HB_SCRIPT_COMMON || sc == HB_SCRIPT_INHERITED || sc == HB_SCRIPT_UNKNOWN;
			if (!neutral) {
				if (current == HB_SCRIPT_COMMON) {
					current = sc;
					runScript[size_t(run)] = sc;
				} else if (sc != current) {
					current = sc;
					runScript.push_back(sc);
					run++;
				}
			}
			scriptRun[i] = run;
		}
	}
	auto shapeWith = [&](int faceIndex, size_t from, size_t to, bool force) {
		const Face& face = faces[size_t(faceIndex)];
		const double scaleFor = spans[size_t(sp[from])].size;
		const double letterSpacing = spans[size_t(sp[from])].letterSpacing;
		hb_buffer_t* buffer = hb_buffer_create();
		const size_t byteFrom = starts[from], byteTo = to < n ? starts[to] : size_t(length);
		hb_buffer_add_utf8(buffer, s, length, unsigned(byteFrom), int(byteTo - byteFrom));
		hb_buffer_set_script(buffer, runScript[size_t(scriptRun[from])] == HB_SCRIPT_COMMON ? HB_SCRIPT_LATIN : runScript[size_t(scriptRun[from])]);
		hb_buffer_guess_segment_properties(buffer);
		hb_buffer_set_direction(buffer, HB_DIRECTION_LTR);
		hb_shape(face.font, buffer, letterSpacing > 0 ? noLigatures : nullptr, letterSpacing > 0 ? 2 : 0);
		unsigned count = 0;
		hb_glyph_info_t* info = hb_buffer_get_glyph_infos(buffer, &count);
		hb_glyph_position_t* pos = hb_buffer_get_glyph_positions(buffer, &count);
		/*
		 * Widths as Skia's FreeType gives them, so a line comes to the same hair either side of a whole
		 * pixel: the size goes to FreeType in 64ths, its scale is rounded to 16.16, and each width is
		 * rounded again as FreeType's linear advance. Kerning, which HarfBuzz adds, is scaled plainly.
		 */
		// The size goes to FreeType in 64ths cut down, not rounded: 18.2 px is set as 18.1875.
		const long size64 = long(scaleFor * 64);
		const long xScale = std::lround(double(size64) * 65536.0 / face.upem);
		size_t cp = from;
		for (unsigned g = 0; g < count;) {
			// One HarfBuzz cluster: the glyphs sharing a cluster value, and the code points up to the next.
			unsigned h = g;
			bool drawn = true;
			double width = 0;
			while (h < count && info[h].cluster == info[g].cluster) {
				if (info[h].codepoint == 0) drawn = false;
				const hb_position_t plain = hb_font_get_glyph_h_advance(face.font, info[h].codepoint);
				width += double(std::llround(double(plain) * double(xScale) / 64.0)) / 65536.0 + double(pos[h].x_advance - plain) / face.upem * scaleFor;
				h++;
			}
			while (cp + 1 < to && starts[cp + 1] <= info[g].cluster) cp++;
			const unsigned endByte = h < count ? info[h].cluster : unsigned(byteTo);
			size_t last = cp;
			while (last + 1 < to && starts[last + 1] < endByte) last++;
			if (drawn || force) {
				for (size_t k = cp; k <= last; k++) {
					faceOf[k] = faceIndex;
					advance[k] = 0;
					clusterStart[k] = 0;
					clusterGlyphs[k].clear();
				}
				advance[cp] = width;
				clusterStart[cp] = 1;
				glyphCount[cp] = int(h - g);
				// Each glyph where Skia's shaper puts it: the advances before it in the cluster, each with
				// the letter spacing after it, then its own offset.
				float at = 0;
				for (unsigned k = g; k < h; k++) {
					const hb_position_t plain = hb_font_get_glyph_h_advance(face.font, info[k].codepoint);
					const double own = double(std::llround(double(plain) * double(xScale) / 64.0)) / 65536.0 + double(pos[k].x_advance - plain) / face.upem * scaleFor;
					clusterGlyphs[cp].push_back({info[k].codepoint, float(at + pos[k].x_offset / face.upem * scaleFor), float(-pos[k].y_offset / face.upem * scaleFor)});
					at += float(own + letterSpacing);
				}
			}
			g = h;
		}
		hb_buffer_destroy(buffer);
	};
	auto shapeUnresolved = [&](int run, int faceIndex, bool force) {
		for (size_t i = 0; i < n;) {
			if (sp[i] != run || faceOf[i] >= 0 || cps[i] == '\n') {
				i++;
				continue;
			}
			size_t j = i;
			while (j < n && sp[j] == run && faceOf[j] < 0 && cps[j] != '\n' && scriptRun[j] == scriptRun[i]) j++;
			shapeWith(faceIndex, i, j, force);
			i = j;
		}
	};
	for (int run = 0; run < int(spans.size()); run++) {
		for (int face : spans[size_t(run)].chain) shapeUnresolved(run, face, false);
		shapeUnresolved(run, spans[size_t(run)].chain[0], true);
	}
	for (size_t i = 0; i < n; i++)
		if (faceOf[i] < 0) faceOf[i] = spans[size_t(sp[i])].chain[0];
	// Each cluster's glyphs, numbered within its run (the code points one font drew in a row): Skia's wrapper counts in these.
	std::vector<int> glyphFrom(n, 0), glyphTo(n, 0);
	for (size_t i = 0, counter = 0; i < n; i++) {
		if (i == 0 || faceOf[i] != faceOf[i - 1] || cps[i - 1] == '\n' || scriptRun[i] != scriptRun[i - 1] || sp[i] != sp[i - 1]) counter = 0;
		if (!clusterStart[i]) continue;
		glyphFrom[i] = int(counter);
		counter += size_t(glyphCount[i]);
		glyphTo[i] = int(counter);
	}
	// Letter spacing follows every glyph, so a letter drawn as two ("z" and its accent) is spaced twice, as Skia spaces it.
	for (size_t i = 0; i < n; i++)
		if (clusterStart[i]) advance[i] += spans[size_t(sp[i])].letterSpacing * glyphCount[i];
	/*
	 * Where each cluster starts in its run, in single precision, the way Skia keeps glyph positions: a
	 * line's width is then the difference of two of them, which far along a run is a hair off the sum of
	 * its letters, and the hair decides which whole pixel a line rounds up to.
	 */
	std::vector<float> posAt(n + 1, 0.f);
	std::vector<int> runOf(n, 0);
	for (size_t i = 0, run = 0; i < n; i++) {
		if (i > 0 && (faceOf[i] != faceOf[i - 1] || cps[i - 1] == '\n' || cps[i] == '\n' || scriptRun[i] != scriptRun[i - 1] || sp[i] != sp[i - 1])) run++;
		runOf[i] = int(run);
	}
	{
		float x = 0;
		for (size_t i = 0; i < n; i++) {
			if (i > 0 && runOf[i] != runOf[i - 1]) x = 0;
			posAt[i] = x;
			x += float(advance[i]);
			if (i + 1 == n || runOf[i + 1] != runOf[i]) posAt[n] = x;
		}
	}
	std::vector<char> canBreak;
	breaks(cps, canBreak);
	out.glyphs = std::move(clusterGlyphs);
	out.cps = std::move(cps);
	out.starts = std::move(starts);
	out.sp = std::move(sp);
	out.faceOf = std::move(faceOf);
	out.glyphCount = std::move(glyphCount);
	out.scriptRun = std::move(scriptRun);
	out.glyphFrom = std::move(glyphFrom);
	out.glyphTo = std::move(glyphTo);
	out.runOf = std::move(runOf);
	out.advance = std::move(advance);
	out.clusterStart = std::move(clusterStart);
	out.canBreak = std::move(canBreak);
	out.posAt = std::move(posAt);
}

// Shaped paragraphs kept by their words and runs: a table's cell is shaped once and laid out at two
// widths, and a card laid out again at a new width shapes nothing.
std::unordered_map<std::string, Shaped> shapedCache;
std::vector<std::string> shapedOrder;

const Shaped& shapedFor(const char* s, int length, const std::vector<Span>& spans) {
	std::string key(s, size_t(length));
	key.push_back('\x01');
	for (const Span& span : spans) {
		key += std::to_string(span.from) + ',' + std::to_string(span.to) + ',' + std::to_string(span.size) + ',' + std::to_string(span.letterSpacing);
		for (int face : span.chain) key += ':' + std::to_string(face);
		key.push_back(';');
	}
	auto found = shapedCache.find(key);
	if (found != shapedCache.end()) return found->second;
	if (shapedOrder.size() >= 2048) {
		for (size_t k = 0; k < 512; k++) shapedCache.erase(shapedOrder[k]);
		shapedOrder.erase(shapedOrder.begin(), shapedOrder.begin() + 512);
	}
	Shaped& made = shapedCache[key];
	shapeInto(made, s, length, spans);
	shapedOrder.push_back(key);
	return made;
}

/*
 * A paragraph of styled runs, as Skia's paragraph sets one built with pushed styles: each run picks
 * from its own font chain and is shaped on its own, so nothing kerns across a change of style, and a
 * line is as tall as its tallest run. `base` is the paragraph's own style, which an empty line takes.
 * Answers in `out`: the unbroken width (to a hundredth), the longest line, the height, the lines.
 */
int layoutSpans(const char* s, int length, const std::vector<Span>& spans, const Span& base, double lineHeight, double maxWidth, double* out, std::vector<LineOut>* linesOut, const Shaped** shapedOut) {
	double* answer = out;
	for (const Span& span : spans)
		if (span.chain.empty()) {
			answer[0] = answer[1] = answer[2] = answer[3] = 0;
			return 0;
		}
	if (base.chain.empty()) {
		answer[0] = answer[1] = answer[2] = answer[3] = 0;
		return 0;
	}
	const Shaped& S = shapedFor(s, length, spans);
	if (shapedOut) *shapedOut = &S;
	if (linesOut) linesOut->clear();
	const auto& cps = S.cps;
	const auto& starts = S.starts;
	const size_t n = cps.size();
	const auto& sp = S.sp;
	const auto& faceOf = S.faceOf;
	const auto& glyphFrom = S.glyphFrom;
	const auto& glyphTo = S.glyphTo;
	const auto& runOf = S.runOf;
	const auto& advance = S.advance;
	const auto& clusterStart = S.clusterStart;
	const auto& canBreak = S.canBreak;
	const auto& posAt = S.posAt;
	// The width of [a, b) as Skia's line measures it: run by run, the end position less the start.
	auto spanWidth = [&](size_t a, size_t b) {
		float w = 0;
		for (size_t k = a; k < b;) {
			size_t e = k;
			while (e < b && runOf[e] == runOf[k]) e++;
			float endPos;
			if (e < n && runOf[e] == runOf[k]) endPos = posAt[e];
			else {
				// The run ends at e: its end is its last cluster's start plus that cluster's advance.
				size_t last = e - 1;
				endPos = posAt[last] + float(advance[last]);
			}
			w += endPos - posAt[k];
			k = e;
		}
		return double(w);
	};

	const bool wrap = !std::isnan(maxWidth);
	// Skia's paragraph lays out at the width rounded down to a whole pixel.
	const double limit = wrap ? std::floor(maxWidth) : maxWidth;
	double unbroken = 0, longest = 0, height = 0, lastLineHeight = 0;
	int lines = 0;
	lineSpans.clear();
	// One line's height, in whole pixels: its fonts' tallest ascent and tallest descent. A line height
	// asked for is given to each font apart, its extra split evenly above and below (Skia's half
	// leading), so fonts of different proportions in one line make it a little taller than asked.
	// Worked in single precision as Skia works it, since 13 px at 1.5 comes to a hair under 19.5.
	float lineAscent = 0, lineDescent = 0;
	auto lineHeightOf = [&](size_t a, size_t b) {
		float asc = 0, desc = 0;
		bool first = true;
		auto take = [&](const Face& f, double size) {
			// Skia's `Run::calculateMetrics`: the font's line gap split above and below, then the height asked for.
			const float leading = float(f.lineGap) / float(f.upem) * float(size);
			float fa = -float(f.ascender) / float(f.upem) * float(size) - leading * 0.5f;
			float fd = -float(f.descender) / float(f.upem) * float(size) + leading * 0.5f;
			if (!std::isnan(lineHeight)) {
				const float runHeight = float(lineHeight) * float(size);
				const float extra = (runHeight - (fd - fa)) / 2;
				fa -= extra;
				fd += extra;
			}
			if (first || fa < asc) asc = fa;
			if (first || fd > desc) desc = fd;
			first = false;
		};
		for (size_t i = a; i < b; i++) take(faces[size_t(faceOf[i])], spans[size_t(sp[i])].size);
		// An empty line is as tall as the style of the line break that makes it; an empty text, the paragraph's own.
		if (first && b < n && cps[b] == '\n') take(faces[size_t(faceOf[b])], spans[size_t(sp[b])].size);
		if (first) take(faces[size_t(base.chain[0])], base.size);
		lineAscent = asc;
		lineDescent = desc;
		// The difference taken in double, as Skia's `InternalLineMetrics::height` takes it.
		return std::round(double(desc) - double(asc));
	};
	auto isSpace = [&](size_t i) { return cps[i] == ' ' || cps[i] == '\t' || cps[i] == 0x3000; };
	// Paragraph by paragraph, at each hard break.
	size_t para = 0;
	while (true) {
		size_t end = para;
		while (end < n && cps[end] != '\n') end++;
		double full = 0;
		for (size_t i = para; i < end; i++) full += advance[i];
		unbroken = std::max(unbroken, full);
		// Lines, greedily: as many breakable pieces as fit, and a piece wider than the line broken by letters.
		size_t lineStart = para;
		while (true) {
			double width = 0;       // up to the last piece taken, trailing spaces in
			size_t lastBreak = lineStart;
			double widthAtBreak = 0;
			size_t i = lineStart;
			size_t lineEnd = end;
			// A first cluster wider than the whole line has the line to itself.
			if (wrap && lineStart < end) {
				size_t firstEnd = lineStart + 1;
				while (firstEnd < end && !clusterStart[firstEnd]) firstEnd++;
				double first = 0;
				for (size_t m = lineStart; m < firstEnd; m++) first += advance[m];
				if (!isSpace(lineStart) && std::round(first * 100) / 100 > limit && first > limit && firstEnd < end) i = end + 1, lineEnd = firstEnd;
			}
			for (; i < end; i++) {
				if (i > lineStart && canBreak[i]) {
					lastBreak = i;
					widthAtBreak = width;
				}
				double next = width + advance[i];
				// A space past the edge hangs there, and ends the word it follows: the line may end after it
				// even where the rules allow no break (Skia's wrapper commits the word on an overflowing space).
				if (wrap && isSpace(i) && std::round(next * 100) / 100 > limit) {
					lastBreak = i + 1;
					widthAtBreak = next;
				}
				// Spaces hang past the edge; a letter that does not fit ends the line.
				// Skia's wrapper compares the running width rounded to a hundredth, so a hair over a whole pixel fits.
				if (wrap && !isSpace(i) && std::round(next * 100) / 100 > limit && i > lineStart) {
					// The word being added goes to the next line, unless it is wider than a whole line and
					// at least two of its letters are already on this one, or this line has nothing else:
					// then it is broken by letters where it stands, filling this line (Skia's wrapper).
					/*
					 * The word's length as Skia's wrapper measures it (`TextWrapper::lookAhead`): what of it is on
					 * the line, then the clusters after, stopping before a space, a hard break, or a cluster a
					 * line may break after. That last cluster is not counted, so "drawn" at the end of a text
					 * measures as "draw".
					 */
					double word = 0;
					for (size_t k = lastBreak; k < i; k++) word += advance[k];
					for (size_t k = i; k < end;) {
						size_t next = k + 1;
						while (next < end && !clusterStart[next] && advance[next] == 0) next++;
						const bool softAfter = next < end ? canBreak[next] != 0 : end == n;
						if (isSpace(k) || softAfter) break;
						for (size_t m = k; m < next; m++) word += advance[m];
						k = next;
					}
					// How much of the word is on this line, as Skia counts it: the last cluster's end less the
					// first one's start, in glyphs of their own runs, so a word that crosses fonts counts short.
					int first = -1, lastEnd = 0;
					for (size_t k = lastBreak; k < i; k++)
						if (clusterStart[k]) {
							if (first < 0) first = glyphFrom[k];
							lastEnd = glyphTo[k];
						}
					// Skia subtracts these as unsigned positions: a word that starts far into one run and
					// ends early in the next wraps round to a huge count, and so counts as long.
					const size_t onLine = first < 0 ? 0 : size_t(lastEnd) - size_t(first);
					bool tooLong = word > limit && (onLine > 1 || lastBreak == lineStart);
					// A single cluster wider than the whole line goes on this one, after what is there.
					size_t clusterEnd = i + 1;
					while (clusterEnd < end && !clusterStart[clusterEnd]) clusterEnd++;
					double clusterWidth = 0;
					for (size_t m = i; m < clusterEnd; m++) clusterWidth += advance[m];
					if (clusterWidth > limit) {
						tooLong = true;
						i = clusterEnd;
					}
					lineEnd = lastBreak > lineStart && !tooLong ? lastBreak : i;
					(void)widthAtBreak;
					break;
				}
				width = next;
			}
			if (i == end) lineEnd = end;
			// Spaces after a forced break hang on this line rather than starting the next, though they
			// take no part in its height (Skia adds them as ghosts, after the line's metrics are set).
			const size_t metricsEnd = lineEnd;
			while (lineEnd < end && isSpace(lineEnd)) lineEnd++;
			// The line's own width, without the spaces it ends in.
			size_t visible = lineEnd;
			while (visible > lineStart && isSpace(visible - 1)) visible--;
			const double w = spanWidth(lineStart, visible);
			longest = std::max(longest, w);
			lineSpans.push_back(double(starts.empty() || lineStart >= n ? size_t(length) : starts[lineStart]));
			lineSpans.push_back(double(lineEnd >= n ? size_t(length) : starts[lineEnd]));
			lineSpans.push_back(w);
			// The empty line after a final line break keeps the line before's height: Skia does not clear its metrics there.
			const double lineHeightHere = lineStart == end && end == n && n > 0 && cps[n - 1] == '\n' && lines > 0 ? lastLineHeight : lineHeightOf(lineStart, metricsEnd > lineStart ? metricsEnd : lineEnd);
			lastLineHeight = lineHeightHere;
			if (linesOut) linesOut->push_back({lineStart, visible, lineEnd, w, height, lineHeightHere, lineAscent, lineDescent});
			height += lineHeightHere;
			lines++;
			if (lineEnd >= end) break;
			lineStart = lineEnd;
		}
		if (end >= n) break;
		para = end + 1;
	}
	answer[0] = std::round(unbroken * 100) / 100;
	answer[1] = longest;
	answer[2] = height;
	answer[3] = lines;
	return lines;
}

int measureSpans(const char* s, int length, const std::vector<Span>& spans, const Span& base, double lineHeight, double maxWidth, double* out) {
	return layoutSpans(s, length, spans, base, lineHeight, maxWidth, out, nullptr, nullptr);
}

// Every glyph of a paragraph laid out at `maxWidth`, where Skia's paragraph draws it: lines one under
// another, each aligned in the width rounded down (left 0, right 1, centre 2), each run of a line after
// the one before, each cluster where its run puts it. `y` is the glyph's baseline.
int placeGlyphs(const char* s, int length, const std::vector<Span>& spans, const Span& base, double lineHeight, double maxWidth, int align, std::vector<PlacedGlyph>& glyphs, std::vector<PlacedLine>& lines, double* out, std::vector<PlacedPiece>* pieces) {
	glyphs.clear();
	lines.clear();
	if (pieces) pieces->clear();
	std::vector<LineOut> laid;
	const Shaped* S = nullptr;
	const int count = layoutSpans(s, length, spans, base, lineHeight, maxWidth, out, &laid, &S);
	if (!S || count == 0) return count;
	const double width = std::isnan(maxWidth) ? 0 : std::floor(maxWidth);
	for (const LineOut& line : laid) {
		float shift = 0;
		if (!std::isnan(maxWidth)) {
			// A line wider than the paragraph is not moved at all (`TextLine::format` returns on delta <= 0).
			const float delta = float(width) - float(line.width);
			if (delta > 0) shift = align == 1 ? delta : align == 2 ? delta / 2 : 0;
		}
		// Skia's paragraph draws a line's glyphs at its top plus its ascent rounded to a whole pixel.
		const double baseline = line.top + std::floor(-double(line.ascent) + 0.5);
		lines.push_back({double(shift), baseline, line.width, line.top, line.height});
		float runX = shift;
		for (size_t k = line.start; k < line.visible;) {
			// One run's piece of this line.
			size_t e = k;
			while (e < line.visible && S->runOf[e] == S->runOf[k]) e++;
			for (size_t c = k; c < e; c++) {
				if (!S->clusterStart[c]) continue;
				const float at = runX + (S->posAt[c] - S->posAt[k]);
				// Letter spacing puts half its gap before each letter of a left-aligned line (`Run::addSpacesEvenly`
				// starts at half); a centred or right-aligned line starts at its aligned edge, as CanvasKit draws them.
				const float half = shift == 0 && align == 0 ? float(spans[size_t(S->sp[c])].letterSpacing) / 2 : 0;
				for (const ClusterGlyph& g : S->glyphs[c]) glyphs.push_back({S->faceOf[c], g.id, double(at + half + g.dx), baseline + g.dy, spans[size_t(S->sp[c])].size, S->sp[c]});
			}
			float endPos;
			if (e < S->cps.size() && S->runOf[e] == S->runOf[k]) endPos = S->posAt[e];
			else {
				size_t last = e - 1;
				endPos = S->posAt[last] + float(S->advance[last]);
			}
			const float next = runX + (endPos - S->posAt[k]);
			if (pieces && e > k) pieces->push_back({S->sp[k], S->faceOf[k], double(runX), double(next), line.top, line.height, line.top + line.height - double(line.descent)});
			runX = next;
			k = e;
		}
	}
	return count;
}

// Plain words in one style, one run: for the layout (`scene.cpp`) and for `text_measure`. `length`
// bytes of UTF-8 at `s`, the chain of family names one a line at `chainNames`.
extern "C" int measureWords(const char* s, int length, const char* chainNames, int chainLength, double size, int weight, int italic, double letterSpacing, double lineHeight, double maxWidth, double* out) {
	Span one{0, size_t(length), chainOf(chainNames, chainLength, weight, italic != 0), size, letterSpacing};
	return measureSpans(s, length, std::vector<Span>{one}, one, lineHeight, maxWidth, out);
}

extern "C" {

// Measure `length` bytes of UTF-8 at `text_scratch`, followed by the family chain, one name a line
// (`chainLength` bytes). `maxWidth` NaN is one line per paragraph. Answers in `text_answer`: the
// unbroken width (rounded to a hundredth, trailing spaces in), the longest line (trailing spaces
// out), the height, and the number of lines.
EMSCRIPTEN_KEEPALIVE int text_measure(int length, int chainLength, double size, int weight, int italic, double letterSpacing, double lineHeight, double maxWidth) {
	return measureWords(scratch.data(), length, scratch.data() + length, chainLength, size, weight, italic, letterSpacing, lineHeight, maxWidth, answer);
}

}  // extern "C"

extern "C" {
// A face's vertical metrics in its own units, for checking: ascender, descender, line gap, units per em.
EMSCRIPTEN_KEEPALIVE double* text_face_metrics(int face) {
	answer[0] = faces[size_t(face)].ascender;
	answer[1] = faces[size_t(face)].descender;
	answer[2] = faces[size_t(face)].lineGap;
	answer[3] = faces[size_t(face)].upem;
	return answer;
}
}

hb_font_t* faceFont(int face) { return face >= 0 && size_t(face) < faces.size() ? faces[size_t(face)].font : nullptr; }
void faceDecorations(int face, double out[5]) {
	const Face& f = faces[size_t(face)];
	hb_position_t v = 0;
	out[0] = f.upem;
	out[1] = hb_ot_metrics_get_position(f.font, HB_OT_METRICS_TAG_UNDERLINE_OFFSET, &v) ? v : -f.upem / 10;
	out[2] = hb_ot_metrics_get_position(f.font, HB_OT_METRICS_TAG_UNDERLINE_SIZE, &v) ? v : f.upem / 20;
	out[3] = hb_ot_metrics_get_position(f.font, HB_OT_METRICS_TAG_STRIKEOUT_OFFSET, &v) ? v : f.upem / 4;
	out[4] = hb_ot_metrics_get_position(f.font, HB_OT_METRICS_TAG_STRIKEOUT_SIZE, &v) ? v : f.upem / 20;
}
const char* faceBytes(int face, size_t* length) {
	if (face < 0 || size_t(face) >= faces.size()) return nullptr;
	*length = faces[size_t(face)].length;
	return faces[size_t(face)].bytes;
}
void faceStyle(int face, int* weight, bool* italic) {
	*weight = faces[size_t(face)].weight;
	*italic = faces[size_t(face)].italic;
}
