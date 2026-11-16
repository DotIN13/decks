/**
 * OS notifications, and the honest account of when the browser will refuse one.
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
	/** No Notification API at all: an old browser, or an iOS Safari tab. */
	| "unsupported";

export function availability(): Availability {
	if (typeof window === "undefined") return "unsupported";
	/*
	 * Read through a widened alias rather than with `"Notification" in window`: the alias lets
	 * the constructor be missing, so a plain typeof check below says whether it is there.
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
	 * The collapsing key. Two banners with the same tag are one banner showing the newer one,
	 * so four agents finishing in a row is four banners, and one agent whose failure is reported
	 * twice is one.
	 */
	tag?: string;
	onClick?: () => void;
}

/**
 * Show a banner, or do nothing at all.
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
