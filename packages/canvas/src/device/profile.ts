/**
 * Which column of the rules table (`rules.ts`) this page is: its form, its operating system and its
 * browser engine, read once at boot.
 *
 * The form is told by the operating system first and the pointer second: a mobile system is a tablet,
 * or a phone when it is an iPhone, an iPod or an Android phone, or when its short side is under 600 px;
 * a computer is a desk unless its main pointer is coarse (a Surface folded into a tablet), when it is a
 * tablet too. `?device=desk`, `tablet` or `phone` in the address forces a form (and the system that
 * goes with it), for testing one on another; the older `?device=computer` and `mobile` still force the
 * system alone. `?engine=` forces the engine. The page passes both on to the canvas frame.
 */
import { rulesFor, type Engine, type Form, type Os, type Profile, type Rules } from "./rules.ts";

export type ProfileFacts = {
	platform: string;
	userAgent: string;
	maxTouchPoints: number;
	/** The main pointer is coarse (`pointer: coarse`). */
	coarse: boolean;
	/** The screen's short side, in CSS pixels. */
	shortSide: number;
	/** `?device=` and `?engine=` in the address. */
	device?: string | null | undefined;
	engine?: string | null | undefined;
};

export function osOf(facts: Pick<ProfileFacts, "platform" | "userAgent" | "maxTouchPoints">): Os {
	const apple = /iPhone|iPad|iPod/.test(facts.platform) || /iPhone|iPad|iPod/.test(facts.userAgent) || (facts.platform === "MacIntel" && facts.maxTouchPoints > 1);
	return apple || /Android/i.test(facts.userAgent) ? "mobile" : "computer";
}

export function isPhone(facts: { platform: string; userAgent: string }): boolean {
	return /iPhone|iPod/.test(facts.platform) || /iPhone|iPod/.test(facts.userAgent) || /Android.*Mobile/i.test(facts.userAgent);
}

export function engineOf(facts: Pick<ProfileFacts, "userAgent" | "engine">): Engine {
	if (facts.engine === "webkit" || facts.engine === "chromium" || facts.engine === "other") return facts.engine;
	if (/(Chrome|Chromium|Edg|HeadlessChrome)\//.test(facts.userAgent)) return "chromium";
	if (/AppleWebKit\//.test(facts.userAgent)) return "webkit";
	return "other";
}

export function profileFrom(facts: ProfileFacts): Profile {
	const engine = engineOf(facts);
	const forced = facts.device;
	if (forced === "desk") return { form: "desk", os: "computer", engine };
	if (forced === "tablet" || forced === "phone") return { form: forced, os: "mobile", engine };
	const os: Os = forced === "computer" || forced === "mobile" ? forced : osOf(facts);
	let form: Form;
	if (os === "mobile") form = isPhone(facts) || (facts.shortSide > 0 && facts.shortSide < 600) ? "phone" : "tablet";
	else form = facts.coarse ? "tablet" : "desk";
	return { form, os, engine };
}

const browser = typeof navigator !== "undefined" && typeof location !== "undefined";
const params = browser ? new URLSearchParams(location.search) : undefined;

/** This page's profile, read once. Outside a browser (the tests, a worker with no screen) a desk. */
export const PROFILE: Profile = browser
	? profileFrom({
			platform: navigator.platform ?? "",
			userAgent: navigator.userAgent ?? "",
			maxTouchPoints: navigator.maxTouchPoints ?? 0,
			coarse: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
			shortSide: typeof screen === "undefined" ? 0 : Math.min(screen.width, screen.height),
			device: params?.get("device"),
			engine: params?.get("engine"),
		})
	: { form: "desk", os: "computer", engine: "other" };

/** The rules for this page's profile. */
export const RULES: Rules = rulesFor(PROFILE);

/** Whether this is a touch form (a tablet or a phone): what the code once called `COARSE`. */
export const TOUCH = PROFILE.form !== "desk";

/*
 * The form on the root element, for the stylesheets: `data-form` is the form, `data-touch` is there on a
 * tablet and a phone. A style that differs by form asks these, never `(pointer: coarse)`, so it follows
 * the table and `?device=` as the code does.
 */
if (typeof document !== "undefined") {
	document.documentElement.dataset.form = PROFILE.form;
	if (TOUCH) document.documentElement.dataset.touch = "true";
}

/* For the browser checks and anyone at the console: which column this page reads, and what it says. */
if (typeof globalThis !== "undefined") (globalThis as { __decksRules?: () => { profile: Profile; rules: Rules } }).__decksRules = () => ({ profile: PROFILE, rules: RULES });
