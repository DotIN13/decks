import { Refused } from "../../protocol/index.ts";
import type { ExtensionLine } from "./line.ts";
import { actScript, READ, WHERE, type Acted, type Mode } from "./page.ts";

// What each call does in the tab, as Chrome DevTools commands sent through the
// extension's chrome.debugger. Rules 5 to 9 of the README.

export const SNAPSHOT_MAX = 60_000;
const OPEN_MS = 30_000;
const SHOT_MS = 15_000;

export type Target = string | { ref: string } | { name: string; nth?: number };
export type Where = { url: string; title: string };
export type Page = Where & { snapshot: string; truncated?: boolean };

const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
	Enter: { code: "Enter", keyCode: 13, text: "\r" },
	Tab: { code: "Tab", keyCode: 9 },
	Escape: { code: "Escape", keyCode: 27 },
	Backspace: { code: "Backspace", keyCode: 8 },
	Delete: { code: "Delete", keyCode: 46 },
	ArrowUp: { code: "ArrowUp", keyCode: 38 },
	ArrowDown: { code: "ArrowDown", keyCode: 40 },
	ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
	ArrowRight: { code: "ArrowRight", keyCode: 39 },
	Space: { code: "Space", keyCode: 32, text: " " },
};

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** One attached tab, driven through the extension. */
export class Driver {
	/** The address the last read's references belong to. */
	private refsAt: string | undefined;

	constructor(
		private readonly line: ExtensionLine,
		readonly tabId: number,
	) {}

	/** Run a script in the page and answer its value; a thrown script is a sentence. */
	async evaluate<T>(expression: string): Promise<T> {
		const got = (await this.command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })) as {
			result?: { value?: unknown };
			exceptionDetails?: { text?: string; exception?: { description?: string } };
		};
		if (got?.exceptionDetails) {
			const why = got.exceptionDetails.exception?.description ?? got.exceptionDetails.text ?? "an error";
			throw new Refused("conflict", `The page threw while it was read: ${why.split("\n")[0]}.`, "tab.read");
		}
		return got?.result?.value as T;
	}

	/** A DevTools command in the tab. */
	command(method: string, params: Record<string, unknown> = {}, waitMs?: number): Promise<unknown> {
		return this.line.send("chrome.debugger.sendCommand", [{ tabId: this.tabId }, method, params], waitMs);
	}

	where(): Promise<Where & { ready?: string }> {
		return this.evaluate(WHERE);
	}

	async open(url: string): Promise<Where> {
		await this.command("Page.navigate", { url });
		this.refsAt = undefined;
		const until = Date.now() + OPEN_MS;
		for (;;) {
			const here = await this.where().catch(() => undefined);
			if (here && here.ready !== "loading" && here.url !== "about:blank") return { url: here.url, title: here.title };
			if (Date.now() > until) throw new Refused("unavailable", `${url} did not load in 30 s.`, "tab.status");
			await pause(150);
		}
	}

	async read(): Promise<Page> {
		const page = await this.evaluate<Page>(READ);
		this.refsAt = page.url;
		if (page.snapshot.length <= SNAPSHOT_MAX) return page;
		return { ...page, snapshot: `${page.snapshot.slice(0, SNAPSHOT_MAX)}\n(cut at ${SNAPSHOT_MAX} characters)`, truncated: true };
	}

	/** Find a target and fill, choose or click it; a miss is refused with the page's sentence. */
	async act(mode: Mode, target: Target, more: { text?: string; option?: string } = {}): Promise<string> {
		if (typeof target === "object" && "ref" in target) await this.refsHold();
		const done = await this.evaluate<Acted>(actScript({ mode, target, ...more }));
		if (!done || done.error) throw new Refused("not_found", done?.error ?? "The page did not answer.", "tab.read");
		if (done.point) await this.mouseClick(done.point.x, done.point.y);
		return done.label ?? "";
	}

	/** A reference holds only on the address it was read at. */
	private async refsHold(): Promise<void> {
		if (!this.refsAt) throw new Refused("invalid", "References come from the page itself: read it with tab.read first, then pass one of the [ref=...] ids it shows.", "tab.read");
		const now = (await this.where()).url;
		if (now !== this.refsAt) {
			throw new Refused("conflict", `That reference was read from ${this.refsAt} and the tab is now on ${now}. Read the page again: every page numbers its references from e1.`, "tab.read");
		}
	}

	private async mouseClick(x: number, y: number): Promise<void> {
		const at = { x, y, button: "left", clickCount: 1 };
		await this.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
		await this.command("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
		await this.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
	}

	async press(key: string): Promise<void> {
		const known = KEYS[key];
		const one = known ?? { code: key.length === 1 ? `Key${key.toUpperCase()}` : key, keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0, text: key.length === 1 ? key : undefined };
		const base = { key: key === "Space" ? " " : key, code: one.code, windowsVirtualKeyCode: one.keyCode };
		await this.command("Input.dispatchKeyEvent", { type: one.text ? "keyDown" : "rawKeyDown", ...base, ...(one.text ? { text: one.text } : {}) });
		await this.command("Input.dispatchKeyEvent", { type: "keyUp", ...base });
	}

	/** A PNG of the tab, the viewport or the whole page. */
	async screenshot(full: boolean): Promise<Uint8Array> {
		const params: Record<string, unknown> = { format: "png" };
		if (full) {
			const metrics = (await this.command("Page.getLayoutMetrics")) as { cssContentSize?: { width: number; height: number }; contentSize?: { width: number; height: number } };
			const size = metrics?.cssContentSize ?? metrics?.contentSize;
			if (size) Object.assign(params, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 } });
		}
		try {
			const shot = (await this.command("Page.captureScreenshot", params, SHOT_MS)) as { data?: string };
			return new Uint8Array(Buffer.from(shot?.data ?? "", "base64"));
		} catch (error) {
			const late = /did not answer/.test((error as Error).message);
			if (late) throw new Refused("unavailable", "The tab did not paint in time. Chrome only draws a tab it is showing: bring the shared tab to the front of its window and try again.", "tab.status");
			throw error;
		}
	}
}

/** Width and height from a PNG's header. */
export function pngSize(png: Uint8Array): { w: number; h: number } {
	if (png.length < 24) return { w: 0, h: 0 };
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	return { w: view.getUint32(16), h: view.getUint32(20) };
}
