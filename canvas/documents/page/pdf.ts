import type { CompileError, DocServerMessage } from "../model.ts";
import type { DocSync } from "../client.ts";
import type { LiveEditor } from "../live.ts";
import type { DocPageOptions } from "../page.ts";
import { el } from "./parts.ts";

/** The PDF beside a LaTeX page: typesetting as typing pauses, its pages, its errors, and the pane's width. */

export type PdfNeeds = {
	sync: DocSync;
	live: LiveEditor;
	options: DocPageOptions;
	pdfBar: HTMLElement;
	pdfState: HTMLElement;
	errList: HTMLElement;
	pdfBody: HTMLElement;
	pdfPane: HTMLElement;
	divider: HTMLElement;
	main: HTMLElement;
	panel: HTMLElement;
	errButton: HTMLButtonElement;
	pdfButton: HTMLButtonElement;
	iconButton: (icon: string, label: string, cls?: string) => HTMLButtonElement;
};

export class PdfPane {
	pdfOpen = false;
	pdfTimer: ReturnType<typeof setTimeout> | undefined;
	pdfBusy = false;
	pdfAgain = false;
	pdfPath: string | undefined;
	pdfBytes: ArrayBuffer | undefined;
	pdfDrawn = 0;
	readonly openPdf!: HTMLButtonElement;

	constructor(private readonly n: PdfNeeds) {
		// The bar over the PDF: its state, its errors, and typeset again, open and close.
		const recompile = this.n.iconButton("refresh", "Typeset again", "dp-ib dp-sm");
		this.openPdf = this.n.iconButton("external", "Open the PDF in a new tab", "dp-ib dp-sm");
		const closePdf = this.n.iconButton("x", "Close the PDF", "dp-ib dp-sm");
		this.n.pdfBar.append(this.n.pdfState, this.n.errButton, recompile, this.openPdf, closePdf);
		this.openPdf.disabled = true;

		const savedWidth = Number(localStorage.getItem("dp-pdf-width") ?? 0);
		if (savedWidth > 0) this.n.pdfPane.style.setProperty("--pdf-w", `${savedWidth}px`);
		// What each button does, and the divider dragged to size the pane.
		this.n.pdfButton.onclick = () => this.showPdf(!this.pdfOpen);
		closePdf.onclick = () => this.showPdf(false);
		recompile.onclick = () => this.compileNow();
		this.n.errButton.onclick = () => {
			this.n.errList.hidden = !this.n.errList.hidden;
			this.n.errButton.setAttribute("aria-pressed", String(!this.n.errList.hidden));
		};
		this.openPdf.onclick = () => {
			if (this.pdfBytes) window.open(URL.createObjectURL(new Blob([this.pdfBytes], { type: "application/pdf" })), "_blank");
		};
		this.n.divider.addEventListener("pointerdown", (event) => {
			event.preventDefault();
			this.n.divider.setPointerCapture(event.pointerId);
			this.n.divider.dataset.drag = "";
			const right = this.n.main.getBoundingClientRect().right - (this.n.panel.hidden ? 0 : this.n.panel.getBoundingClientRect().width);
			const move = (e: PointerEvent) => {
				const width = Math.max(260, Math.min(right - e.clientX, this.n.main.clientWidth - 320));
				this.n.pdfPane.style.setProperty("--pdf-w", `${width}px`);
			};
			const up = () => {
				delete this.n.divider.dataset.drag;
				this.n.divider.removeEventListener("pointermove", move);
				localStorage.setItem("dp-pdf-width", String(Math.round(this.n.pdfPane.getBoundingClientRect().width)));
				void this.drawPages();
			};
			this.n.divider.addEventListener("pointermove", move);
			this.n.divider.addEventListener("pointerup", up, { once: true });
		});
	}

	compileNow(): void {
		if (!this.pdfOpen) return;
		clearTimeout(this.pdfTimer);
		if (this.pdfBusy) {
			this.pdfAgain = true;
			return;
		}
		this.pdfBusy = true;
		this.n.pdfState.dataset.state = "busy";
		this.n.pdfState.textContent = "Typesetting…";
		this.n.pdfBody.toggleAttribute("data-stale", this.pdfDrawn > 0);
		this.n.sync.compile();
	}

	/** Typeset again once typing has paused, and everything typed has reached the file. */
	compileSoon(): void {
		if (!this.pdfOpen) return;
		clearTimeout(this.pdfTimer);
		this.pdfTimer = setTimeout(() => (this.n.sync.settled ? this.compileNow() : this.compileSoon()), 1200);
	}

	showPdf(open: boolean): void {
		this.pdfOpen = open;
		this.n.pdfButton.setAttribute("aria-pressed", String(open));
		this.n.pdfPane.hidden = !open;
		this.n.divider.hidden = !open;
		if (open) {
			if (!this.pdfDrawn) this.n.pdfBody.replaceChildren(el("div", { class: "dp-pdfempty" }, "Typesetting the paper for the first time can take a minute while LaTeX fetches its packages."));
			this.compileNow();
		} else clearTimeout(this.pdfTimer);
	}

	async drawPdf(path: string): Promise<void> {
		if (!this.n.options.file) return;
		const bytes = await this.n.options.file(path);
		this.pdfBytes = bytes;
		await this.drawPages();
	}

	/** The pages, drawn off to the side and swapped in, so the reader keeps their place in the PDF. */
	async drawPages(): Promise<void> {
		if (!this.pdfBytes) return;
		const width = Math.max(200, this.n.pdfBody.clientWidth - 36);
		const into = el("div", { style: "display: contents" });
		const ratio = this.n.pdfBody.scrollHeight > this.n.pdfBody.clientHeight ? this.n.pdfBody.scrollTop / (this.n.pdfBody.scrollHeight - this.n.pdfBody.clientHeight) : 0;
		if (this.n.options.pdf) {
			const shadow = el("div", { style: `position: absolute; visibility: hidden; width: ${width}px` });
			document.body.append(shadow);
			try {
				this.pdfDrawn = await this.n.options.pdf(shadow, this.pdfBytes.slice(0), width);
				into.append(...shadow.childNodes);
			} finally {
				shadow.remove();
			}
		} else {
			const frame = el("iframe", { style: "width: 100%; flex: 1; border: 0; min-height: 600px" });
			frame.src = URL.createObjectURL(new Blob([this.pdfBytes], { type: "application/pdf" }));
			into.append(frame);
			this.pdfDrawn = 1;
		}
		this.n.pdfBody.replaceChildren(into);
		this.n.pdfBody.removeAttribute("data-stale");
		this.n.pdfBody.scrollTop = ratio * Math.max(0, this.n.pdfBody.scrollHeight - this.n.pdfBody.clientHeight);
	}

	lineOffset(line: number): number {
		let at = 0;
		for (let n = 1; n < line; n++) {
			const next = this.n.sync.text.indexOf("\n", at);
			if (next === -1) return this.n.sync.text.length;
			at = next + 1;
		}
		return at;
	}

	showErrors(errors: CompileError[]): void {
		this.n.errButton.hidden = errors.length === 0;
		this.n.errButton.textContent = `${errors.length} ${errors.length === 1 ? "error" : "errors"}`;
		this.n.errList.replaceChildren(
			...errors.map((error) => {
				const row = el("div", { class: "dp-err", title: error.line ? "Go to this line" : "" });
				row.append(el("span", { class: "e-line" }, error.line ? `Line ${error.line}` : "—"), el("span", { class: "e-msg" }, error.message));
				if (error.line) row.onclick = () => this.n.live.goto(this.lineOffset(error.line!));
				return row;
			}),
		);
		if (errors.length === 0) {
			this.n.errList.hidden = true;
			this.n.errButton.setAttribute("aria-pressed", "false");
		}
	}

	compiled(message: Extract<DocServerMessage, { type: "doc.compiled" }>): void {
		this.pdfBusy = false;
		const when = new Date(message.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
		this.n.pdfState.dataset.state = message.ok ? "ok" : "failed";
		this.n.pdfState.replaceChildren();
		if (message.error && !message.pdf) this.n.pdfState.textContent = message.error;
		else if (message.pdf) this.n.pdfState.append(el("b", {}, message.ok ? "Typeset" : "Typeset with errors"), `${when}, ${(message.ms / 1000).toFixed(1)} s`);
		else this.n.pdfState.append(el("b", {}, "Did not typeset"), when);
		this.showErrors(message.errors);
		this.openPdf.disabled = !message.pdf;
		if (message.pdf) {
			this.pdfPath = message.pdf;
			void this.drawPdf(message.pdf).catch(() => (this.n.pdfState.textContent = "The PDF was made but could not be read."));
		} else {
			this.n.pdfBody.removeAttribute("data-stale");
			if (!this.pdfDrawn) this.n.pdfBody.replaceChildren(el("div", { class: "dp-pdfempty" }, message.error ?? "LaTeX stopped before writing a page. The errors above say where."));
			if (message.errors.length) {
				this.n.errList.hidden = false;
				this.n.errButton.setAttribute("aria-pressed", "true");
			}
		}
		if (this.pdfAgain) {
			this.pdfAgain = false;
			this.compileSoon();
		}
	}
	/** Whether the PDF pane is open. */
	get open(): boolean {
		return this.pdfOpen;
	}
}
