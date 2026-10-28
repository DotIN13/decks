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
 * How many board pages show at once, and how many let go are kept loaded and hidden for going back
 * (`live-set.ts`). One rule on every device; only these numbers differ.
 */
export interface LiveBudget {
	live: number;
	kept: number;
	/**
	 * The GPU memory board pictures may hold, in MB (`stage/engine.ts`, `fitPictures`): over it, the
	 * boards farthest from the window drop to the size they are drawn at, or to the smallest, 256 px.
	 */
	pictureMB: number;
}

export const BUDGETS: Record<DeviceKind, LiveBudget> = {
	computer: { live: 6, kept: 4, pictureMB: 512 },
	mobile: { live: 1, kept: 1, pictureMB: 128 },
};

export const BUDGET: LiveBudget = BUDGETS[DEVICE];
