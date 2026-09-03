import type { AgentChat, AgentKind, Identity } from "@decks/protocol";
import { For, Show } from "solid-js";

/**
 * A mark for each runtime: Claude's burst and the Pi glyph.
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
const INK = { claude: 18, pi: 15.5 } as const;

const CLAUDE_PATH =
	"m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6.9 3.3 2.2 2 2.6-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.4h-.8v.5l4.5 4.4 8.3 7.5 10.4 9.6.5 2.4-1.3 1.9-1.4-.2-9.2-7-3.6-3.1-8-6.7h-.5v.7l1.8 2.7L74 80.5l.8 4.6-.7 1.5-2.6.9-2.8-.5-5.8-8.2-6-9.1-4.8-8.3-.6.3-2.8 30.5-1.3 1.6-3 1.1-2.5-1.9-1.3-3 1.3-6.1 1.6-8 1.3-6.3 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z";
const CLAUDE_INK = { x: 0, y: 0, w: 100, h: 100 };

/** A blocky P and its dot, drawn in an 800 box — hence the declared ink. */
const PI_P = "M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z";
const PI_DOT = "M517.36 400 H634.72 V634.72 H517.36 Z";
const PI_INK = { x: 165.29, y: 165.29, w: 469.43, h: 469.43 };

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
	/*
	 * Four drawings, four ink boxes — which is the whole reason this indirection exists. A
	 * working mark is a *different drawing* at a different natural size, so if it took the
	 * still mark's box the sign would change size at the moment a turn started, which is the
	 * one moment nothing should move but the mark itself.
	 */
	const ink = () => (props.busy ? (claude() ? GLYPH_INK : TILE_INK) : claude() ? CLAUDE_INK : PI_INK);
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
			<g transform={`translate(${left()} ${top()}) scale(${scale()}) translate(${-ink().x} ${-ink().y})`}>
				<Show when={props.busy} fallback={<Still agent={props.agent} />}>
					<Show
						when={claude()}
						fallback={
							<For each={TILES}>
								{([x, y], index) => (
									<rect class="pi-tile" x={x} y={y} width={5} height={5} style={{ "animation-delay": `${index() * 55}ms` }} />
								)}
							</For>
						}
					>
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
					</Show>
				</Show>
			</g>
		</svg>
	);
}

/** The published symbol for a runtime, at rest. */
function Still(props: { agent: AgentKind }) {
	return (
		<Show
			when={props.agent === "claude"}
			fallback={
				<>
					<path fill-rule="evenodd" d={PI_P} />
					<path d={PI_DOT} />
				</>
			}
		>
			<path d={CLAUDE_PATH} />
		</Show>
	);
}

/**
 * An agent's face: its avatar or its initial, with its state as a ring.
 *
 * Here rather than in `ChatList`, where it was: it was drawn in two places for a while, and
 * `size` is the only thing that differed between them — the ring and the initial scale off
 * it. Kept general now that only the list uses it, because a face at one size is a face at
 * any size, and the alternative is finding this out again.
 */
export function AgentFace(props: { chat: AgentChat; identity: Identity | undefined; unread?: number; size?: number }) {
	const size = () => props.size ?? 26;
	const colour = () => props.identity?.color ?? "var(--color-accent)";
	const avatar = () => props.identity?.avatar;
	return (
		/*
		 * A wrapper, because the count sits on the corner of the avatar and the avatar itself
		 * clips to its circle — that `overflow: hidden` is what rounds an image avatar, so a
		 * badge inside it would be cut in half.
		 */
		<span class="face" style={{ "--face": `${size()}px` }}>
			<span class="avatar" data-state={props.chat.state} style={{ background: avatar() ? "transparent" : colour(), "--dot": colour() }}>
				<Show when={avatar()} fallback={(props.identity?.name ?? props.chat.name).slice(0, 1).toUpperCase()}>
					{(src) => <img src={src()} alt="" />}
				</Show>
			</span>
			{/*
			 * A dot, not a count. A 16px numbered badge on a 26px avatar covers the face it is
			 * reporting on — and the number was never the point: what a person does with it is
			 * "that one has something", which a dot says at a fifth of the area. The count
			 * stays in the title for anyone who wants it.
			 */}
			<Show when={(props.unread ?? 0) > 0}>
				<span class="unread" title={props.unread === 1 ? "1 unread message" : `${props.unread} unread messages`} />
			</Show>
		</span>
	);
}

/** "thinking", not "streaming": what the state means to someone watching. */
export function agentState(state: AgentChat["state"]): string {
	switch (state) {
		case "tool":
			return "working…";
		case "waiting":
			return "waiting for you";
		default:
			return "thinking…";
	}
}
