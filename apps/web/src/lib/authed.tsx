import { createResource, type JSX, Show, splitProps } from "solid-js";
import { authHeaders } from "./session.ts";

/**
 * A picture or a file of the harness's, read with this tab's token.
 *
 * Every file and picture the harness serves is read with a credential (`server/src/auth/guard.ts`),
 * and an `<img>` or a new tab cannot send a header. So this page fetches it, with its token in the
 * header as every fetch of its own carries it, and shows what came back from memory (`blob:`). An
 * address that is not this harness's (`data:`, another site's) is used as it is.
 */

/** The pictures read, by address, as `blob:` addresses: the newest few hundred, the oldest let go. */
const read = new Map<string, Promise<string>>();
const KEEP = 300;

/** Whether an address is the harness's own, which needs this tab's token. */
function ours(url: string): boolean {
	try {
		const at = new URL(url, location.href);
		return at.origin === location.origin && /^\/(?:api|c)\//.test(at.pathname);
	} catch {
		return false;
	}
}

/** An address an `<img>` can show: the harness's read with this tab's token, anything else as it is. */
export function authedSrc(url: string): Promise<string> {
	if (!ours(url)) return Promise.resolve(url);
	let got = read.get(url);
	if (got) return got;
	got = fetch(url, { headers: authHeaders() }).then(async (response) => {
		if (!response.ok) throw new Error(`${url}: ${response.status}`);
		return URL.createObjectURL(await response.blob());
	});
	read.set(url, got);
	got.catch(() => read.delete(url));
	if (read.size > KEEP) {
		const [oldest, held] = read.entries().next().value as [string, Promise<string>];
		read.delete(oldest);
		void held.then((blob) => setTimeout(() => URL.revokeObjectURL(blob), 60_000)).catch(() => undefined);
	}
	return got;
}

/**
 * An `<img>` of the harness's picture: read with this tab's token; `onError` when it cannot be. The
 * harness's address it shows stays on it as `data-src`, for whoever looks at what it is of.
 */
export function AuthedImg(props: JSX.ImgHTMLAttributes<HTMLImageElement> & { src: string }): JSX.Element {
	const [own, rest] = splitProps(props, ["src", "onError"]);
	const [src] = createResource(
		() => own.src,
		(url) =>
			authedSrc(url).catch((error: unknown) => {
				const onError = own.onError as ((event: Event) => void) | undefined;
				onError?.(new Event("error"));
				throw error;
			}),
	);
	return (
		<Show when={!src.error}>
			<img {...rest} data-src={own.src} src={src.loading ? undefined : src()} onError={own.onError} />
		</Show>
	);
}

/**
 * Open a file of the harness's in a tab of its own: read with this tab's token, and shown from memory.
 * A web page among them is shown as its text, since from memory it would run as this page's own.
 */
export async function openAuthed(url: string): Promise<void> {
	// Opened now, while the press that asked still counts, and cut off from this page.
	const opened = window.open("about:blank", "_blank");
	if (opened) opened.opener = null;
	try {
		const response = await fetch(url, { headers: authHeaders() });
		if (!response.ok) throw new Error(`${response.status}`);
		const blob = await response.blob();
		const shown = /html|xml|svg|javascript/i.test(blob.type) ? new Blob([await blob.arrayBuffer()], { type: "text/plain;charset=utf-8" }) : blob;
		const address = URL.createObjectURL(shown);
		if (opened) opened.location.href = address;
		else window.open(address, "_blank", "noopener");
		setTimeout(() => URL.revokeObjectURL(address), 120_000);
	} catch (error) {
		opened?.close();
		throw error;
	}
}
