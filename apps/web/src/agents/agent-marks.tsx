import type { AgentKind } from "@decks/protocol";
import { createUniqueId, For, Match, Show, Switch } from "solid-js";

/**
 * A mark for each runtime: Claude's burst, the Pi glyph, and a sign for the other two.
 *
 * The published symbols rather than drawings of our own — Anthropic's Claude symbol (CC0,
 * Wikimedia Commons, `File:Claude_AI_symbol.svg`) and the Pi glyph from `pi.dev/logo.svg` —
 * because a product's own mark is the thing people recognise, and an approximation of one
 * looks like a mistake. Both have their fills dropped so they take the colour of the text
 * beside them. (Ported from picone's `ui/agent-marks.tsx`, which is where the sizing
 * reasoning below was worked out.)
 *
 * ### Why neither is used as it comes
 *
 * The two drawings have nothing in common: Claude's burst fills its 100 box edge to edge,
 * while Pi's glyph occupies 59% of an 800 box with 165 units of air on every side. Dropped
 * into the same frame at the same size, the Pi mark would render visibly smaller than
 * Claude's for the same nominal measurement.
 *
 * So each declares its *ink* box rather than its viewBox, and is scaled into one 24-unit
 * frame at a size chosen per runtime — 15.5 against 18 — because a chunky block glyph reads
 * heavier than a spiky star at identical measurements. Optical, not arithmetic.
 */

/** How much of the 24-unit frame each mark's ink may fill. */
const INK: Record<AgentKind, number> = { claude: 18, pi: 15.5, opencode: 16.5, antigravity: 17 };

const CLAUDE_PATH =
	"m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6.9 3.3 2.2 2 2.6-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.4h-.8v.5l4.5 4.4 8.3 7.5 10.4 9.6.5 2.4-1.3 1.9-1.4-.2-9.2-7-3.6-3.1-8-6.7h-.5v.7l1.8 2.7L74 80.5l.8 4.6-.7 1.5-2.6.9-2.8-.5-5.8-8.2-6-9.1-4.8-8.3-.6.3-2.8 30.5-1.3 1.6-3 1.1-2.5-1.9-1.3-3 1.3-6.1 1.6-8 1.3-6.3 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z";
const CLAUDE_INK = { x: 0, y: 0, w: 100, h: 100 };

/** A blocky P and its dot, drawn in an 800 box — hence the declared ink. */
const PI_P = "M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z";
const PI_DOT = "M517.36 400 H634.72 V634.72 H517.36 Z";
const PI_INK = { x: 165.29, y: 165.29, w: 469.43, h: 469.43 };

/*
 * The two newer runtimes are drawn rather than borrowed, and that is a deliberate step
 * down from the rule above.
 *
 * Claude's burst and the Pi glyph are their owners' published marks, because a product's
 * own symbol is the thing people recognise. opencode's is a blocky ASCII wordmark and
 * antigravity's is a full-colour Google lockup: neither reduces to a single monochrome
 * path at 14px, and a bad tracing of a real logo looks worse than an honest glyph. So
 * these two are *signs*, chosen to be told apart at a glance and in a list: a prompt for
 * the terminal program, a rising arrow for the one named after leaving the ground.
 */

/*
 * opencode's own vector, from `opencode.ai/favicon.svg`, and antigravity's own arch, traced
 * from `antigravity.google/apple-touch-icon.png`.
 *
 * The note above used to say that neither of these two could be used, and it was right about the
 * version of them it was looking at: opencode was published as a blocky ASCII wordmark and
 * antigravity as a full-colour Google lockup, and neither reduced to a monochrome path at 14px.
 * That is no longer the state of either mark. opencode now ships a five-rectangle symbol — a
 * frame with a block in the lower half of its opening — and antigravity's icon is a single arch
 * with a gradient fill, which is one filled path once the gradient is dropped, as it must be here
 * because every mark in this file is drawn in `currentColor`.
 *
 * opencode's symbol is exact: the ring and the block are the two paths of its own file, in its
 * own 512 box. antigravity's is traced, because a raster is all there is: sub-pixel edges out of
 * the icon's alpha channel, the outer and inner boundaries fitted as curves, the feet taken from
 * their own bottom outline, and the whole mirrored about the mark's axis so it is symmetrical to
 * the pixel. Against the icon it lands at 95% pixel overlap, 1 to 2px out along the flanks at
 * 180px.
 *
 * **What neither of them is good at is 14px.** opencode's wall is 25% of its width, so the
 * opening is 1.7px in the working sign and the block inside it disappears; the Pi grid and
 * Claude's asterisk both survive that size because they are made of gaps rather than of fills.
 * The symbols are still the right drawings to use, and the sizes the app draws them at are worth
 * a look: `--face` is 20 to 28px in the panel and the dropdown, and the working sign is 13.
 */

/** opencode: the frame, a ring 64 units thick, `evenodd` so the opening is a hole. */
const OPENCODE_RING = "M384 416H128V96H384V416ZM320 160H192V352H320V160Z";
/** …and the block, filling the lower two thirds of that opening. */
const OPENCODE_BLOCK = "M320 224V352H192V224H320Z";
/** The symbol's ink: a 256x320 frame whose opening is 128x192 from (192,160). */
const OPENCODE_INK = { x: 128, y: 96, w: 256, h: 320 };

/*
 * The arch, traced. One path with one hole in it, so the fill rule does not matter: the outline
 * runs up the left flank, over the dome, down the right flank, and back through the opening
 * under it.
 */
const ANTIGRAVITY_ARCH = "M25.8 151.0 C25.4 150.8 23.9 151.0 23.4 150.0 C22.9 149.0 22.4 146.7 22.9 145.0 C23.4 143.3 25.3 141.7 26.7 140.0 C28.1 138.3 29.9 136.7 31.3 135.0 C32.6 133.3 33.6 131.7 34.7 130.0 C35.7 128.3 36.7 126.7 37.6 125.0 C38.5 123.3 39.3 121.7 40.1 120.0 C40.9 118.3 41.6 116.7 42.3 115.0 C43.0 113.3 43.6 111.7 44.2 110.0 C44.8 108.3 45.2 106.7 45.8 105.0 C46.3 103.3 46.9 101.7 47.5 100.0 C48.0 98.3 48.5 96.7 49.0 95.0 C49.5 93.3 50.0 91.7 50.4 90.0 C50.9 88.3 51.3 86.7 51.7 85.0 C52.2 83.3 52.8 81.7 53.3 80.0 C53.8 78.3 54.1 76.7 54.6 75.0 C55.0 73.3 55.6 71.7 56.1 70.0 C56.6 68.3 57.1 66.5 57.6 65.0 C58.0 63.5 58.5 61.8 58.8 61.0 C59.1 60.2 59.2 60.3 59.3 60.0 C59.4 59.7 59.5 59.3 59.5 59.0 C59.6 58.7 59.7 58.3 59.9 58.0 C60.0 57.7 60.2 57.3 60.4 57.0 C60.5 56.7 60.5 56.3 60.6 56.0 C60.7 55.7 60.9 55.3 61.1 55.0 C61.2 54.7 61.3 54.3 61.5 54.0 C61.6 53.7 61.6 53.3 61.8 53.0 C61.9 52.7 62.2 52.3 62.3 52.0 C62.5 51.7 62.5 51.3 62.6 51.0 C62.7 50.7 63.0 50.3 63.2 50.0 C63.3 49.7 63.4 49.3 63.5 49.0 C63.7 48.7 63.9 48.3 64.1 48.0 C64.2 47.7 64.3 47.3 64.5 47.0 C64.7 46.7 64.8 46.3 65.0 46.0 C65.2 45.7 65.3 45.3 65.5 45.0 C65.7 44.7 65.9 44.3 66.1 44.0 C66.3 43.7 66.4 43.3 66.6 43.0 C66.8 42.7 67.1 42.3 67.3 42.0 C67.5 41.7 67.6 41.3 67.8 41.0 C68.0 40.7 68.3 40.3 68.5 40.0 C68.8 39.7 69.1 39.3 69.3 39.0 C69.6 38.7 69.8 38.3 70.0 38.0 C70.3 37.7 70.5 37.3 70.8 37.0 C71.0 36.7 71.3 36.3 71.6 36.0 C72.0 35.7 72.3 35.3 72.6 35.0 C72.9 34.7 73.3 34.3 73.6 34.0 C74.0 33.7 74.4 33.3 74.8 33.0 C75.2 32.7 75.7 32.3 76.2 32.0 C76.7 31.7 77.1 31.3 77.7 31.0 C78.2 30.7 77.7 30.6 79.5 30.0 C81.4 29.4 87.4 27.8 89.0 27.4 C98.8 30.2 99.8 30.7 100.3 31.0 C100.9 31.3 101.3 31.7 101.8 32.0 C102.3 32.3 102.8 32.7 103.2 33.0 C103.6 33.3 104.0 33.7 104.4 34.0 C104.7 34.3 105.1 34.7 105.4 35.0 C105.7 35.3 106.0 35.7 106.4 36.0 C106.7 36.3 107.0 36.7 107.2 37.0 C107.5 37.3 107.7 37.7 108.0 38.0 C108.2 38.3 108.4 38.7 108.7 39.0 C108.9 39.3 109.2 39.7 109.5 40.0 C109.7 40.3 110.0 40.7 110.2 41.0 C110.4 41.3 110.5 41.7 110.7 42.0 C110.9 42.3 111.2 42.7 111.4 43.0 C111.6 43.3 111.7 43.7 111.9 44.0 C112.1 44.3 112.3 44.7 112.5 45.0 C112.7 45.3 112.8 45.7 113.0 46.0 C113.2 46.3 113.3 46.7 113.5 47.0 C113.7 47.3 113.8 47.7 113.9 48.0 C114.1 48.3 114.3 48.7 114.5 49.0 C114.6 49.3 114.7 49.7 114.8 50.0 C115.0 50.3 115.3 50.7 115.4 51.0 C115.5 51.3 115.5 51.7 115.7 52.0 C115.8 52.3 116.1 52.7 116.2 53.0 C116.4 53.3 116.4 53.7 116.5 54.0 C116.7 54.3 116.8 54.7 116.9 55.0 C117.1 55.3 117.3 55.7 117.4 56.0 C117.5 56.3 117.5 56.7 117.6 57.0 C117.8 57.3 118.0 57.7 118.1 58.0 C118.3 58.3 118.4 58.7 118.5 59.0 C118.5 59.3 118.6 59.7 118.7 60.0 C118.8 60.3 118.9 60.2 119.2 61.0 C119.5 61.8 120.0 63.5 120.4 65.0 C120.9 66.5 121.4 68.3 121.9 70.0 C122.4 71.7 123.0 73.3 123.4 75.0 C123.9 76.7 124.2 78.3 124.7 80.0 C125.2 81.7 125.8 83.3 126.3 85.0 C126.7 86.7 127.1 88.3 127.6 90.0 C128.0 91.7 128.5 93.3 129.0 95.0 C129.5 96.7 130.0 98.3 130.5 100.0 C131.1 101.7 131.7 103.3 132.2 105.0 C132.8 106.7 133.2 108.3 133.8 110.0 C134.4 111.7 135.0 113.3 135.7 115.0 C136.4 116.7 137.1 118.3 137.9 120.0 C138.7 121.7 139.5 123.3 140.4 125.0 C141.3 126.7 142.3 128.3 143.3 130.0 C144.4 131.7 145.4 133.3 146.7 135.0 C148.1 136.7 149.9 138.3 151.3 140.0 C152.7 141.7 154.6 143.3 155.1 145.0 C155.6 146.7 155.1 149.0 154.6 150.0 C154.1 151.0 152.6 150.8 152.2 151.0 C154.7 145.8 153.7 149.7 153.0 150.8 C152.3 151.8 151.7 151.2 151.0 151.2 C150.3 151.3 149.7 151.1 149.0 151.0 C148.3 150.9 147.7 150.7 147.0 150.5 C146.3 150.3 145.7 150.0 145.0 149.7 C144.3 149.3 143.7 148.9 143.0 148.5 C142.3 148.1 141.7 147.6 141.0 147.1 C140.3 146.6 139.7 146.1 139.0 145.5 C138.3 145.0 137.7 144.4 137.0 143.8 C136.3 143.3 135.3 142.4 135.0 142.1 C147.7 150.3 143.3 148.5 140.9 147.0 C138.5 145.5 136.6 143.7 134.9 142.0 C133.1 140.3 131.7 138.7 130.2 137.0 C128.8 135.3 127.5 133.7 126.3 132.0 C125.0 130.3 123.8 128.7 122.7 127.0 C121.6 125.3 120.7 123.7 119.7 122.0 C118.7 120.3 117.7 118.7 116.7 117.0 C115.8 115.3 114.8 113.7 113.8 112.0 C112.8 110.3 111.8 108.7 110.6 107.0 C109.4 105.3 108.3 103.7 106.6 102.0 C104.9 100.3 103.3 98.2 100.3 97.0 C97.4 95.8 90.9 95.0 89.0 94.6 C76.6 97.8 73.1 100.3 71.4 102.0 C69.7 103.7 68.6 105.3 67.4 107.0 C66.2 108.7 65.2 110.3 64.2 112.0 C63.2 113.7 62.2 115.3 61.3 117.0 C60.3 118.7 59.3 120.3 58.3 122.0 C57.3 123.7 56.4 125.3 55.3 127.0 C54.2 128.7 53.0 130.3 51.7 132.0 C50.5 133.7 49.2 135.3 47.8 137.0 C46.3 138.7 44.9 140.3 43.1 142.0 C41.4 143.7 39.5 145.5 37.1 147.0 C34.7 148.5 30.3 150.3 28.9 151.0 C42.7 142.4 41.7 143.3 41.0 143.8 C40.3 144.4 39.7 145.0 39.0 145.5 C38.3 146.1 37.7 146.6 37.0 147.1 C36.3 147.6 35.7 148.1 35.0 148.5 C34.3 148.9 33.7 149.3 33.0 149.7 C32.3 150.0 31.7 150.3 31.0 150.5 C30.3 150.7 29.7 150.9 29.0 151.0 C28.3 151.1 27.7 151.3 27.0 151.2 C26.3 151.2 25.7 151.8 25.0 150.8 C24.3 149.7 23.3 145.8 23.0 144.9 Z";
/** Its ink, measured from the traced path's own extremes in the icon's 180 box. */
const ANTIGRAVITY_INK = { x: 22.4, y: 27.4, w: 133.2, h: 124.4 };

/**
 * The arch's centreline, from under the left foot to under the right one, for the working
 * reveal: the drawn line the band was laid around, not a second outline of it.
 */
const ARCH_CENTRELINE = "M29.5 149 C48 128 62 88 89 61 C116 88 130 128 148.5 149";

/*
 * ### Working: a second drawing per runtime, not the still one in motion
 *
 * This app had the still mark scaled and faded on a 1.8s loop — one element, no second
 * drawing, and the argument for it was that a single shape can breathe. It can, and what it
 * looks like is a flower opening and closing: Claude's burst is a ten-pointed star, and
 * pulsing a star in an identity colour reads as a decorative bloom rather than as a machine
 * doing something. Picone draws each runtime *working* in its own idiom instead (§58), and
 * those are the two marks below.
 */

/**
 * The frames Claude's asterisk grows through — and back down again.
 *
 * Picone's note, kept because it is the reason there are ten and not six: six frames looping
 * straight back to the dot flickered, since the jump from the largest glyph to the smallest
 * is a hard cut every cycle, which the eye reads as a fault rather than as motion. Growing
 * and shrinking through the same frames makes it breathe, and at 180ms a frame the cycle is
 * 1.8s rather than 0.7.
 *
 * They are text, and they are stacked: ten `<text>` nodes, each visible for a tenth of the
 * cycle, offset by its own delay. It has to be a stack because the frames are *different
 * glyphs* — only CSS can step between them without a re-render, and a turn that runs four
 * minutes has to cost what one that runs four seconds costs.
 */
const FRAMES = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
/** How long each frame is held. Ten of these is one cycle. */
const FRAME_MS = 180;
/**
 * The box the glyph frames are scaled from.
 *
 * Not the em box: a font's ink is smaller than the size it is set at, and picone measured
 * the moving mark at 67% of the frame against the still mark's 75% before this number
 * existed. Found by measuring, because nothing about a font can be derived from here.
 */
const GLYPH_INK = { x: 0, y: 0, w: 17.9, h: 17.9 };

/**
 * Pi working: its logo reduced to 4×4 character cells, which build in reading order and fall
 * away again — what a terminal does while it draws.
 */
const TILES: Array<[number, number]> = [
	[0, 0],
	[6, 0],
	[12, 0],
	[0, 6],
	[12, 6],
	[0, 12],
	[6, 12],
	[18, 12],
	[0, 18],
	[18, 18],
];
/** Ten tiles of 5 with 1 between them: 23 units square. */
const TILE_INK = { x: 0, y: 0, w: 23, h: 23 };

/**
 * The mark for a runtime, at a given size.
 *
 * `aria-hidden`, because every caller pairs it with a label — a row's mark sits inside a
 * button whose accessible name already says which agent it is, and the header's chip carries
 * its own. An icon that names itself twice is worse than one that does not name itself.
 */
export function AgentMark(props: { agent: AgentKind; size?: number; class?: string; busy?: boolean }) {
	const size = () => props.size ?? 14;
	const claude = () => props.agent === "claude";
	const pi = () => props.agent === "pi";
	/*
	 * Two marks inside one SVG need two names, and the same name twice in a document is a mask
	 * that resolves to whichever one the browser saw first. This is why the ids are per instance.
	 */
	const ids = createUniqueId();
	/*
	 * A drawing and an ink box per runtime, per state. Only Claude and Pi have a working drawing
	 * of a different natural size; opencode's frame and antigravity's arch are drawn in the same
	 * box in both states, so the mark does not change size at the moment a turn starts.
	 */
	const ink = () => (props.busy && claude() ? GLYPH_INK : props.busy && pi() ? TILE_INK : STILL_INK[props.agent]);
	// The longer side is what fills the frame, so a wide mark and a square one sit at the
	// same optical size rather than the same width.
	const scale = () => INK[props.agent] / Math.max(ink().w, ink().h);
	const left = () => (24 - ink().w * scale()) / 2;
	const top = () => (24 - ink().h * scale()) / 2;

	return (
		<svg
			class={props.class}
			width={size()}
			height={size()}
			viewBox="0 0 24 24"
			fill="currentColor"
			data-agent={props.agent}
			/* Empty-string-or-absent, so the stylesheet can key on `[data-busy]` without
			   matching the literal "false" a boolean attribute would print. */
			data-busy={props.busy ? "" : undefined}
			aria-hidden="true"
		>
			{/*
				Only a working mark needs either of these, and a still mark is drawn in every row of
				a panel: two definitions per row that nothing references is a mask and a clip the
				browser parses for nothing.
			*/}
			<Show when={props.busy && (props.agent === "opencode" || props.agent === "antigravity")}>
				<defs>
				{/* Where opencode's block is allowed to be: the opening it rises into. */}
				<clipPath id={`${ids}-opening`}>
					<rect x="192" y="160" width="128" height="192" />
				</clipPath>
				{/*
					antigravity's reveal: a fat stroke along the arch's own centreline, drawn from the
					left foot to the right foot, and used as a mask over the filled arch. `pathLength`
					normalises the dash arithmetic to 100, so the keyframes do not carry a number that
					would have to be remeasured if the curve were ever retraced.
				*/}
				<mask id={`${ids}-arch`} maskUnits="userSpaceOnUse" x="0" y="0" width="180" height="180">
					<path
						class="ag-trace"
						d={ARCH_CENTRELINE}
						fill="none"
						stroke="#fff"
						stroke-width="96"
						stroke-linecap="round"
						pathLength="100"
					/>
				</mask>
				</defs>
			</Show>
			<g transform={`translate(${left()} ${top()}) scale(${scale()}) translate(${-ink().x} ${-ink().y})`}>
				<Switch fallback={<Still agent={props.agent} />}>
					<Match when={props.busy && claude()}>
						<For each={FRAMES}>
							{(frame, index) => (
								<text
									class="claude-frame"
									x={GLYPH_INK.w / 2}
									y={GLYPH_INK.h / 2}
									style={{ "animation-delay": `${index() * FRAME_MS}ms` }}
								>
									{frame}
								</text>
							)}
						</For>
					</Match>
					<Match when={props.busy && pi()}>
						<For each={TILES}>
							{([x, y], index) => (
								<rect class="pi-tile" x={x} y={y} width={5} height={5} style={{ "animation-delay": `${index() * 55}ms` }} />
							)}
						</For>
					</Match>
					{/*
						opencode working: the frame's four walls drawn clockwise from their own corners,
						and then the block rising into the opening from below it. The walls are the
						symbol's own rectangles, taken apart so each can grow on its own.
					*/}
					<Match when={props.busy && props.agent === "opencode"}>
						<g class="oc-cycle">
							<rect class="oc-wall oc-top" x="128" y="96" width="256" height="64" />
							<rect class="oc-wall oc-right" x="320" y="160" width="64" height="192" />
							<rect class="oc-wall oc-bottom" x="128" y="352" width="256" height="64" />
							<rect class="oc-wall oc-left" x="128" y="160" width="64" height="192" />
							<g clip-path={`url(#${ids}-opening)`}>
								<rect class="oc-fill" x="192" y="224" width="128" height="128" />
							</g>
						</g>
					</Match>
					{/*
						antigravity working: the same arch, revealed along its own centreline and then
						lifted a unit. One path, one mask, and no second drawing to keep in step with the
						first.
					*/}
					<Match when={props.busy && props.agent === "antigravity"}>
						<g class="ag-cycle">
							<path d={ANTIGRAVITY_ARCH} mask={`url(#${ids}-arch)`} />
						</g>
					</Match>
				</Switch>
			</g>
		</svg>
	);
}

/** Where each runtime's still drawing actually has ink, inside whatever box it was drawn in. */
const STILL_INK: Record<AgentKind, { x: number; y: number; w: number; h: number }> = {
	claude: CLAUDE_INK,
	pi: PI_INK,
	opencode: OPENCODE_INK,
	antigravity: ANTIGRAVITY_INK,
};

/** The symbol for a runtime, at rest. */
function Still(props: { agent: AgentKind }) {
	return (
		<Switch fallback={<path d={CLAUDE_PATH} />}>
			<Match when={props.agent === "pi"}>
				<path fill-rule="evenodd" d={PI_P} />
				<path d={PI_DOT} />
			</Match>
			<Match when={props.agent === "opencode"}>
				<path fill-rule="evenodd" d={OPENCODE_RING} />
				<path d={OPENCODE_BLOCK} />
			</Match>
			<Match when={props.agent === "antigravity"}>
				<path d={ANTIGRAVITY_ARCH} />
			</Match>
		</Switch>
	);
}
