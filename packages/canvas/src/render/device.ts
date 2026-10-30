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
export type DeviceKind = "computer" | "mobile";

export interface DeviceFacts {
	platform: string;
	userAgent: string;
	maxTouchPoints: number;
	/** `?device=computer` or `?device=mobile` in the page's address, for testing one on the other. */
	forced?: string | null | undefined;
}

export function deviceKind(facts: DeviceFacts): DeviceKind {
	if (facts.forced === "computer" || facts.forced === "mobile") return facts.forced;
	const apple = /iPhone|iPad|iPod/.test(facts.platform) || (facts.platform === "MacIntel" && facts.maxTouchPoints > 1);
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
export const LAYERS: Record<BrowserEngine, { scaling: boolean; sliding: boolean }> = {
	webkit: { scaling: false, sliding: false },
	chromium: { scaling: true, sliding: true },
	other: { scaling: true, sliding: true },
};

/**
 * How much a device's GPU can hold, as far as a page can tell: no browser says how much memory its
 * GPU has, so it is read from what they do say. A phone or tablet is small, and so is a computer whose
 * WebGPU allows buffers under 1 GB or that says it has 4 GB of memory or less; any other is big.
 * Each board's picture is fetched at one width for the class (`PICTURES`) and copied to the GPU once;
 * the GPU makes its smaller sizes and draws it at any zoom from the nearest (`stage/engine.ts`).
 */
export type GpuClass = "big" | "small";

export interface GpuFacts {
	kind: DeviceKind;
	/** `navigator.deviceMemory`, in GB, where the browser gives it (Chrome). */
	deviceMemory?: number | undefined;
	/** WebGPU's `maxBufferSize`, in bytes. */
	maxBufferSize?: number | undefined;
	/** `?pictures=192` or `?pictures=480` in the page's address, for testing one class on the other (512 and 1024, the old widths, still say small and big). */
	forced?: string | null | undefined;
}

export function gpuClass(facts: GpuFacts): GpuClass {
	if (facts.forced === "192" || facts.forced === "512") return "small";
	if (facts.forced === "480" || facts.forced === "1024") return "big";
	if (facts.kind === "mobile") return "small";
	if (facts.deviceMemory !== undefined && facts.deviceMemory <= 4) return "small";
	if (facts.maxBufferSize !== undefined && facts.maxBufferSize < 2 ** 30) return "small";
	return "big";
}

/**
 * A class's board pictures: the width each is fetched at, and the GPU memory they may hold together, in MB.
 *
 * A picture is shown only below the live zoom (a card's page above it), where a card 1,000 to 1,400 px
 * wide is drawn a few hundred pixels wide at most, so 480 px on a big GPU and 192 on a small one are
 * all a picture needs; the server makes exactly these two (`SMALL_WIDTHS` in `boards/thumbs.ts`).
 * A picture with its smaller sizes holds a third again: compressed (ASTC, a byte a pixel) a typical
 * card of 480 × 235 is 0.15 MB and a tall one of 480 × 1,440 0.9 MB; as RGBA (WebP where the GPU
 * takes no ASTC) four times that, 0.6 and 3.7 MB. 256 MB holds about 400 typical cards even as RGBA
 * (the decks-studio canvas, 99 cards, is about 60 MB as RGBA and 15 as ASTC). At 192 px a card is
 * 0.024 MB compressed and 0.1 MB as RGBA (a tall one 0.6), so 64 MB holds about 600 as RGBA on an
 * iPad or a phone. Over the budget the farthest shrink on the GPU (`render/engine.ts`, `fitPictures`).
 */
export const PICTURES: Record<GpuClass, { width: number; budgetMB: number }> = {
	big: { width: 480, budgetMB: 256 },
	small: { width: 192, budgetMB: 64 },
};

/** This device's class, asked of its WebGPU adapter once; without WebGPU, from the rest. */
export async function readGpuClass(): Promise<GpuClass> {
	const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { deviceMemory?: number; gpu?: { requestAdapter(): Promise<{ limits: { maxBufferSize: number } } | null> } });
	const adapter = await nav?.gpu?.requestAdapter().catch(() => null);
	return gpuClass({
		kind: DEVICE,
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
export const CARDS: Record<DeviceKind, { live: number; kept: number }> = {
	computer: { live: 12, kept: 4 },
	mobile: { live: 3, kept: 2 },
};
