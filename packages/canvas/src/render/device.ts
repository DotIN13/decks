/**
 * What kind of device the canvas runs on, and the budget that follows from it.
 *
 * Told by the operating system, not by the screen or the pointer: a mobile system (iOS, iPadOS,
 * Android) gives a web page one thread and a hard memory ceiling whatever is plugged into it, and
 * that is what a budget has to fit. Safari on an iPad mini was killed at 2.9 GB with six board pages
 * up. A touch screen alone would count a Surface as mobile, a screen size an iPad Pro as a computer,
 * and the user agent alone an iPad as a Mac, which is what iPadOS calls itself: a real Mac has no
 * touch screen, so a "Mac" with one is an iPad.
 */
import { ROWS, type AwakeBudget } from "../device/rules.ts";
import { PROFILE } from "../device/profile.ts";

/** A row of the rules table that differs by browser engine, as a record (`device/rules.json`). */
function byEngine<T>(name: string): Record<"webkit" | "chromium" | "other", T> {
	const row = ROWS[name]!;
	return { webkit: row.webkit as T, chromium: row.chromium as T, other: row.other as T };
}

export type DeviceKind = "computer" | "mobile";

export interface DeviceFacts {
	platform: string;
	userAgent: string;
	maxTouchPoints: number;
	/** `?device=computer` or `mobile` in the page's address, or a form (`desk`, `tablet`, `phone`, `device/profile.ts`), for testing one on the other. */
	forced?: string | null | undefined;
}

export function deviceKind(facts: DeviceFacts): DeviceKind {
	if (facts.forced === "computer" || facts.forced === "mobile") return facts.forced;
	if (facts.forced === "desk") return "computer";
	if (facts.forced === "tablet" || facts.forced === "phone") return "mobile";
	const apple = /iPhone|iPad|iPod/.test(facts.platform) || /iPhone|iPad|iPod/.test(facts.userAgent) || (facts.platform === "MacIntel" && facts.maxTouchPoints > 1);
	const android = /Android/i.test(facts.userAgent);
	return apple || android ? "mobile" : "computer";
}

/** This device's kind, read once. */
export const DEVICE: DeviceKind =
	typeof navigator === "undefined"
		? "computer"
		: deviceKind({
				platform: navigator.platform ?? "",
				userAgent: navigator.userAgent ?? "",
				maxTouchPoints: navigator.maxTouchPoints ?? 0,
				forced: typeof location === "undefined" ? undefined : new URLSearchParams(location.search).get("device"),
			});

/**
 * Which browser engine draws the page: WebKit (Safari, and every browser on iOS and iPadOS), Chromium
 * (Chrome, Edge, and Chrome on a Mac, which says AppleWebKit too), or another (Firefox).
 *
 * Told by the user agent: AppleWebKit without Chrome's, Chromium's or Edge's name is WebKit. Chrome on
 * iOS says CriOS, not Chrome/, and is WebKit, as it should be.
 */
export type BrowserEngine = "webkit" | "chromium" | "other";

export interface EngineFacts {
	userAgent: string;
	/** `?engine=webkit`, `chromium` or `other` in the page's address, for testing one on another. */
	forced?: string | null | undefined;
}

export function browserEngine(facts: EngineFacts): BrowserEngine {
	if (facts.forced === "webkit" || facts.forced === "chromium" || facts.forced === "other") return facts.forced;
	if (/(Chrome|Chromium|Edg|HeadlessChrome)\//.test(facts.userAgent)) return "chromium";
	if (/AppleWebKit\//.test(facts.userAgent)) return "webkit";
	return "other";
}

/** This page's engine, read once. */
export const ENGINE: BrowserEngine =
	typeof navigator === "undefined"
		? "other"
		: browserEngine({
				userAgent: navigator.userAgent ?? "",
				forced: typeof location === "undefined" ? undefined : new URLSearchParams(location.search).get("engine"),
			});

/**
 * Which items an engine puts on layers of their own while the camera moves (`canvas.css`, set by
 * `stage/Stage.tsx`): `scaling`, each awake card, document and app while the zoom changes, so it is
 * stretched rather than painted at every step; `sliding`, the whole world while the camera pans at one
 * zoom, so it is slid as one picture.
 *
 * WebKit gets neither. Measured with a test page of 60 to 240 cards (light, with pictures and shadows,
 * and with blurred glass) zoomed 3×, on an iPad and in WebKit on a Mac: with no layers every zoom frame
 * held 17 ms and the frame at rest was 15 to 17 ms, while either layer setup cost a frame of 100 to 230
 * ms as the layers were built and 50 to 115 ms as they went. WebKit paints these cards inside a frame,
 * so a layer saves nothing it needs and costs both ends. Chromium keeps both: with no layers, 240 heavy
 * cards showed 164 of 288 frames on an M4, against 276 with a layer per card. Another engine (Firefox)
 * is unmeasured and keeps what Chromium does.
 */
export const LAYERS = byEngine<{ scaling: boolean; sliding: boolean }>("layers");

/**
 * What an awake item is while the camera moves, by its kind and the engine: `live`, its surface kept
 * shown (and on a layer where `LAYERS` gives it one, so a zoom stretches it rather than painting it at
 * every step); or `cover`, the sheet drawing its picture over it from the first camera step to two
 * frames after rest, its surface not painted meanwhile (`items-layer.tsx`).
 *
 * A card stays live: in Chromium on its own layer (measured: 0 to 6 late frames of 495 on layers,
 * 97 of 300 off); in WebKit, which gets no layers, covering it with its picture was measured on a
 * simulated iPad and changed nothing a pinch costs, so it stays live there too, and `?card-pictures=1`
 * tries the other way. An app stays live as a card does, the person's choice (2026-10-31): its window
 * is a whole page in a sandboxed frame, repainted at every camera step when it animates (1,280 paints
 * in a two-second pan), which is the cost of seeing it move; so does a document's editor, laid out at
 * every step of a zoom. Covering is kept in the table for a measure on a slow device.
 */
export type Moving = "live" | "cover";
export const MOVING = byEngine<{ card: Moving; app: Moving; document: Moving }>("moving");

/**
 * How much a device's GPU can hold, as far as a page can tell: no browser says how much memory its
 * GPU has, so it is read from what they do say. A phone or tablet is small, and so is a computer whose
 * WebGPU allows buffers under 1 GB or that says it has 4 GB of memory or less; any other is big.
 * Each card's picture is fetched at the rung of the class's ladder (`PICTURES`) its drawn width needs
 * (`picture-ladder.ts`); the GPU makes its smaller sizes and draws it at any zoom from the nearest.
 */
export type GpuClass = "big" | "small" | "phone";

export { isPhone } from "../device/profile.ts";

export interface GpuFacts {
	kind: DeviceKind;
	/** `navigator.deviceMemory`, in GB, where the browser gives it (Chrome). */
	deviceMemory?: number | undefined;
	/** WebGPU's `maxBufferSize`, in bytes. */
	maxBufferSize?: number | undefined;
	/** A phone (`isPhone`): its pictures are only ever the smallest rung. */
	phone?: boolean | undefined;
	/** `?pictures=phone`, `small` or `big` in the page's address, for testing one class on the other. */
	forced?: string | null | undefined;
}

export function gpuClass(facts: GpuFacts): GpuClass {
	if (facts.forced === "small" || facts.forced === "big" || facts.forced === "phone") return facts.forced;
	// A phone whatever else it says of itself (an emulated iPhone reports a Mac's platform).
	if (facts.phone) return "phone";
	if (facts.kind === "mobile") return "small";
	if (facts.deviceMemory !== undefined && facts.deviceMemory <= 4) return "small";
	if (facts.maxBufferSize !== undefined && facts.maxBufferSize < 2 ** 30) return "small";
	return "big";
}

/**
 * A class's card pictures: the ladder's rungs it fetches among, by how wide a card is drawn on the
 * screen (`picture-ladder.ts`), and the GPU memory they may hold together, in MB. As ASTC a card
 * about two thirds as tall as it is wide holds 0.03 MB at 192, 0.2 at 480 and 0.55 at 800; as plain
 * pictures four times that. A computer's 256 MB holds about 450 cards at 800 compressed, or 115 plain;
 * a small device's 64 MB about 300 at 480 compressed. Past it, far cards drop to a lower rung.
 */
export const PICTURES: Record<GpuClass, { ladder: readonly number[]; budgetMB: number }> = { big: ROWS.pictures!.big as never, small: ROWS.pictures!.small as never, phone: ROWS.pictures!.phone as never };

/**
 * This device's class as far as is known at once, before its WebGPU adapter answers (`readGpuClass`):
 * a phone's or a tablet's is certain from what it is, so no picture is ever fetched at a computer's rungs
 * on one while the adapter is asked; an iPhone fetched every card at 800 until it answered.
 */
export function knownGpuClass(): GpuClass {
	const nav = typeof navigator === "undefined" ? undefined : navigator;
	return gpuClass({
		kind: DEVICE,
		phone: PROFILE.form === "phone",
		forced: typeof location === "undefined" ? undefined : new URLSearchParams(location.search).get("pictures"),
	});
}

/** This device's class, asked of its WebGPU adapter once; without WebGPU, from the rest. */
export async function readGpuClass(): Promise<GpuClass> {
	const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { deviceMemory?: number; gpu?: { requestAdapter(): Promise<{ limits: { maxBufferSize: number } } | null> } });
	const adapter = await nav?.gpu?.requestAdapter().catch(() => null);
	return gpuClass({
		kind: DEVICE,
		phone: PROFILE.form === "phone",
		deviceMemory: nav?.deviceMemory,
		maxBufferSize: adapter?.limits.maxBufferSize,
		forced: typeof location === "undefined" ? undefined : new URLSearchParams(location.search).get("pictures"),
	});
}

/**
 * A device's cards (`items/live-cards.ts`): how many are live at once besides the selected one, the
 * nearest the middle of the screen, and how many let go keep their roots, asleep, so that coming back
 * to one is instant. A live card is a root of elements this one page lays out, paints and runs the
 * scripts of; an iPad or a phone has one thread and a hard memory ceiling for all of it.
 */
/**
 * A device's awake items (`items/awake.ts`): how many of each kind are awake at once besides the
 * selected one, the nearest the middle of the screen, and how many let go keep their surfaces, asleep,
 * so that coming back to one is instant. A card is a root of elements this one page lays out and
 * paints; an app a whole page of its own in a sandboxed frame, a document an editor; an iPad or a
 * phone has one thread and a hard memory ceiling for all of it.
 */
export const AWAKE: Record<DeviceKind, { live: { card: number; app: number; document: number }; kept: number }> = { computer: ROWS.awake!.computer as AwakeBudget, mobile: ROWS.awake!.mobile as AwakeBudget };
