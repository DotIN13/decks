import type { Line } from "./line.ts";

// For tests: an extension that speaks the real one's wire (clients/extension/background.js):
// tabs.onCreated and extension.initialized on connect, { id, result } or
// { id, error } answers, debugger events up. Its page is a small table.

export type FakeField = { name: string; role: string; value?: string; covered?: string };
export type FakePage = { url: string; title: string; fields: FakeField[] };
type Frame = { id?: number; method: string; params: unknown[] };

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 0x20, 0, 0, 2, 0x58]);

/** A pair of lines: one end for the server, one driven by this fake. */
export class FakeExtension {
	readonly sent: Frame[] = [];
	closedWith: string | undefined;
	paint = true;
	page: FakePage;
	private hearText: ((text: string) => void) | undefined;
	private hearClose: (() => void) | undefined;
	readonly line: Line;

	constructor(
		page: FakePage,
		readonly tabId = 7,
	) {
		this.page = page;
		this.line = {
			send: (text) => void this.receive(JSON.parse(text) as Frame),
			close: (_code, reason) => {
				this.closedWith = reason ?? "";
				this.hearClose?.();
			},
			onText: (hear) => void (this.hearText = hear),
			onClose: (hear) => void (this.hearClose = hear),
		};
	}

	/** What background.js sends once its socket opens and the tab joins the group. */
	share(): void {
		this.up({ method: "chrome.tabs.onCreated", params: [{ id: this.tabId, url: this.page.url, title: this.page.title, index: 0, windowId: 1, active: true, pinned: false }] });
		this.up({ method: "extension.initialized", params: [] });
	}

	/** The person closed the socket from Chrome. */
	hangUp(): void {
		this.hearClose?.();
	}

	navigated(url: string): void {
		this.page.url = url;
		this.up({ method: "chrome.debugger.onEvent", params: [{ tabId: this.tabId }, "Page.frameNavigated", { frame: { url } }] });
	}

	methods(): string[] {
		return this.sent.map((f) => (f.method === "chrome.debugger.sendCommand" ? String(f.params[1]) : f.method));
	}

	private up(message: unknown): void {
		this.hearText?.(JSON.stringify(message));
	}

	private async receive(frame: Frame): Promise<void> {
		this.sent.push(frame);
		await Promise.resolve();
		try {
			this.up({ id: frame.id, result: this.answer(frame) ?? {} });
		} catch (error) {
			this.up({ id: frame.id, error: (error as Error).message });
		}
	}

	private answer(frame: Frame): unknown {
		if (frame.method === "decks.ping" || frame.method === "chrome.debugger.attach") return {};
		if (frame.method !== "chrome.debugger.sendCommand") throw new Error(`Unknown method: ${frame.method}`);
		const [, method, params] = frame.params as [unknown, string, Record<string, unknown>];
		if (method === "Page.navigate") return void (this.page.url = String(params.url));
		if (method === "Page.captureScreenshot") return this.paint ? { data: Buffer.from(PNG).toString("base64") } : new Promise(() => {});
		if (method === "Runtime.evaluate") return { result: { value: this.evaluate(String(params.expression)) } };
		return {};
	}

	private evaluate(expression: string): unknown {
		const { url, title, fields } = this.page;
		if (expression.includes("document.readyState")) return { url, title, ready: "complete" };
		if (expression.includes("window.__decksRefs = refs")) {
			return { url, title, snapshot: fields.map((f, i) => `- ${f.role} "${f.name}" [ref=e${i + 1}]`).join("\n") };
		}
		const args = JSON.parse(expression.slice(expression.lastIndexOf(")(") + 2, -1)) as { mode: string; target: unknown; text?: string; option?: string };
		return this.act(args);
	}

	private act(args: { mode: string; target: unknown; text?: string; option?: string }): unknown {
		const t = args.target as string | { ref?: string; name?: string; nth?: number };
		const byRef = typeof t === "object" && t.ref ? this.page.fields[Number(t.ref.slice(1)) - 1] : undefined;
		const name = typeof t === "string" ? t : t.name;
		const hits = byRef ? [byRef] : this.page.fields.filter((f) => f.name === name);
		if (!hits.length) return { error: `Nothing on the page is called "${name}".` };
		const nth = typeof t === "object" ? t.nth : undefined;
		if (hits.length > 1 && nth === undefined) return { error: `"${name}" matches ${hits.length} elements on this page, so I did not guess.` };
		const field = hits[(nth ?? 1) - 1]!;
		if (args.mode === "fill") field.value = args.text;
		if (args.mode === "select") field.value = args.option;
		if (args.mode !== "click") return { label: field.name };
		if (field.covered) return { error: `${field.name} is on the page, but ${field.covered} is over it.` };
		return { label: field.name, point: { x: 10, y: 20 } };
	}
}
