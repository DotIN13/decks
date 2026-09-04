/**
 * OS notifications, and the honest account of when the browser will refuse one.
 *
 * A thin wrapper on purpose — the Notification API is four calls — but the *reporting* is not
 * thin, and that is the whole reason this is a module rather than six lines in `App.tsx`.
 *
 * ### Why `availability()` has five answers instead of a boolean
 *
 * This app is routinely opened over the network rather than on `localhost`: the dev server
 * binds `0.0.0.0` so the deck can be looked at on a phone, and the phone reaches it at
 * `http://10.0.0.249:4327`. **`Notification` is a secure-context feature.** On that origin
 * Chrome exposes the constructor and then refuses the permission, and Safari does not expose
 * it at all — so the setting would be a switch that turns on, stays on, and never produces a
 * banner, which is the worst kind of broken thing to ship.
 *
 * So the state is named and Settings says it out loud: `insecure` is a different sentence
 * from `denied`, and the fix is different too (reach the app over `localhost` or behind TLS,
 * versus change a permission the browser is holding). The sounds are unaffected either way —
 * Web Audio has no such requirement — which is what makes the two halves of this feature
 * worth keeping independent.
 */

export type Availability =
	/** Permission granted; a banner will appear. */
	| "ready"
	/** Supported and not yet decided. A gesture can ask. */
	| "ask"
	/** The user said no. Only the browser's own UI can undo this. */
	| "denied"
	/** The page is not a secure context, so the browser will refuse whatever we do. */
	| "insecure"
	/** No Notification API at all — an old browser, or an iOS Safari tab. */
	| "unsupported";

export function availability(): Availability {
	if (typeof window === "undefined") return "unsupported";
	/*
	 * Read through a widened alias rather than with `"Notification" in window`.
	 *
	 * The DOM lib declares the constructor as always present, so the `in` check narrows the
	 * *false* branch to `never` and every property read in it is a type error — which is the
	 * type system asserting something about browsers that is not true.
	 */
	const host = window as Window & typeof globalThis & { Notification?: typeof Notification };
	if (typeof host.Notification !== "function") {
		// The order matters: on a plain-HTTP origin Safari hides the constructor entirely, and
		// "your browser does not support this" would be a lie about the browser.
		return host.isSecureContext ? "unsupported" : "insecure";
	}
	if (!host.isSecureContext) return "insecure";
	const permission = host.Notification.permission;
	if (permission === "granted") return "ready";
	if (permission === "denied") return "denied";
	return "ask";
}

/**
 * Ask for permission, from a gesture.
 *
 * Called from a button in Settings and nowhere else. The alternative — asking the first time
 * an agent finishes — is the pattern every guide on the subject names as the one to avoid: a
 * permission dialog that arrives unprompted is refused, and a refusal is permanent in a way
 * that ignoring a button is not.
 */
export async function request(): Promise<Availability> {
	const before = availability();
	if (before !== "ask") return before;
	try {
		await Notification.requestPermission();
	} catch {
		/* Older Safari's callback-only signature rejects; the state below is still right. */
	}
	return availability();
}

export interface Banner {
	title: string;
	body?: string;
	/**
	 * The collapsing key. Two banners with the same tag are one banner showing the newer —
	 * so four agents finishing in a row is four, and one agent whose failure is reported
	 * twice is one.
	 */
	tag?: string;
	onClick?: () => void;
}

/**
 * Show a banner, or do nothing at all.
 *
 * Never throws and never reports: this is the least important thing on the page, and a toast
 * saying "could not show a notification" is a notification about a notification.
 *
 * The caller decides whether the page being in view should suppress it (`shouldNotify` in
 * `alerts.ts`), because that is a policy question and this is a transport.
 */
export function post(banner: Banner): void {
	if (availability() !== "ready") return;
	try {
		const notification = new Notification(banner.title, {
			body: banner.body ?? "",
			// The same mark the tab strip shows. A relative URL, because the app is served from
			// its own origin and hard-coding a hostname is how an icon 404s behind a proxy.
			icon: "/icon-192.png",
			badge: "/favicon-32.png",
			tag: banner.tag,
		});
		notification.onclick = () => {
			window.focus();
			banner.onClick?.();
			notification.close();
		};
	} catch {
		/* Android requires a service worker for `new Notification`; there is nothing to do. */
	}
}
