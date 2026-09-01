import { randomUUID } from "node:crypto";
import type { ExtensionUiAnswer, ExtensionUiPrompt } from "@decks/protocol";

/**
 * The app's dialog surface, implemented against a browser (DESIGN §6.8).
 *
 * Two callers, for the same reason. A Pi extension asks by calling `ui.confirm` — that is
 * where permissions live under Pi — and Claude Code asks through `canUseTool`, because the
 * CLI has no terminal of its own in a session like this. Either way the app's obligation is
 * the same: make the question arrive somewhere a human can see it. It is the whole reason
 * `bindExtensions({ mode: "rpc" })` is used rather than leaving extensions with no UI at
 * all, and it is why a Claude agent can be asked to confirm a command instead of stalling.
 *
 * Two rules hold it together. Every pending question resolves exactly once, and a
 * question that is abandoned — timeout, abort, disposal — resolves with the
 * caller's own default rather than rejecting. An extension that can wedge a
 * session by asking something nobody answered is worse than no dialog.
 *
 * The TUI-shaped half of Pi's UI context (component factories, terminal input,
 * themes) has no meaning here and answers emptily. That is why the object is cast
 * on the way in: it is a faithful implementation of the part that can cross a
 * socket, and an honest no-op for the part that cannot.
 */

/**
 * `Omit` over a union collapses it into its common keys — which for a union of
 * dialog shapes is just `method`. This keeps each member intact.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type PromptDraft = DistributiveOmit<ExtensionUiPrompt, "id">;

interface Pending {
	resolve: (value: unknown) => void;
	fallback: unknown;
	/** Kept so a browser that connects later can be shown the question. */
	prompt: ExtensionUiPrompt;
}

interface DialogOptions {
	timeout?: number;
	signal?: AbortSignal;
}

export interface ExtensionUiHooks {
	prompt(prompt: ExtensionUiPrompt): void;
	closePrompt(id: string): void;
	notify(message: string, level: "info" | "warn" | "error"): void;
	status(key: string, text: string | undefined): void;
	working(message: string | undefined): void;
}

export class ExtensionUiBridge {
	private readonly pending = new Map<string, Pending>();

	constructor(private readonly hooks: ExtensionUiHooks) {}

	private askRaw<T>(draft: PromptDraft, fallback: T, options?: DialogOptions): { id: string; done: Promise<T> } {
		const id = randomUUID();
		const prompt = { ...draft, id } as ExtensionUiPrompt;

		const done = new Promise<T>((resolve) => {
			let settled = false;
			const finish = (value: unknown) => {
				if (settled) return;
				settled = true;
				this.pending.delete(id);
				clearTimeout(timer);
				this.hooks.closePrompt(id);
				resolve(value as T);
			};

			this.pending.set(id, { resolve: finish, fallback, prompt });

			const timer = options?.timeout ? setTimeout(() => finish(fallback), options.timeout) : undefined;
			options?.signal?.addEventListener("abort", () => finish(fallback), { once: true });

			this.hooks.prompt(prompt);
		});

		return { id, done };
	}

	private ask<T>(draft: PromptDraft, fallback: T, options?: DialogOptions): Promise<T> {
		return this.askRaw(draft, fallback, options).done;
	}

	/** An answer from the browser. Unknown ids are ignored: the question is gone. */
	answer(answer: ExtensionUiAnswer): void {
		const pending = this.pending.get(answer.id);
		if (!pending) return;
		if ("cancelled" in answer) pending.resolve(pending.fallback);
		else if ("confirmed" in answer) pending.resolve(answer.confirmed);
		else pending.resolve(answer.value);
	}

	/**
	 * A sign-in dialog: the URL to open, and the code the browser gives back.
	 *
	 * Three answers, because a real OAuth flow has three endings. A **string** is the
	 * code the person pasted, which is what the CLI is sitting on stdin waiting for.
	 * **`true`** is the caller closing its own dialog because the credentials landed
	 * without a paste — it keeps the id for exactly that. **`false`** is cancelled, and
	 * it is the fallback too, so an abandoned sign-in denies rather than hangs.
	 */
	login(url: string, message: string, placeholder: string, options?: DialogOptions): { id: string; done: Promise<string | boolean> } {
		return this.askRaw<string | boolean>({ method: "login", title: "Sign in to Claude", message, url, placeholder }, false, options);
	}

	/** A modal of informational figures, dismissed with OK (the value is never used). */
	usage(title: string, rows: { label: string; value: string }[]): Promise<void> {
		return this.ask<void>({ method: "usage", title, rows }, undefined);
	}

	/**
	 * The object handed to `bindExtensions`.
	 *
	 * Cast at the call site, deliberately — see the note at the top of this file.
	 */
	/**
	 * Questions still waiting for an answer.
	 *
	 * Replayed to a browser that connects after one was asked. Without this, reloading the
	 * page while an agent waits loses the only way to unblock it: the prompt was sent once,
	 * to a client that no longer exists, and the agent waits forever.
	 */
	outstanding(): ExtensionUiPrompt[] {
		return [...this.pending.values()].map((entry) => entry.prompt);
	}

	context() {
		return {
			select: (title: string, options: string[], opts?: DialogOptions) =>
				this.ask<string | undefined>({ method: "select", title, options }, undefined, opts),
			confirm: (title: string, message: string, opts?: DialogOptions) =>
				this.ask<boolean>({ method: "confirm", title, message }, false, opts),
			input: (title: string, placeholder?: string, opts?: DialogOptions) =>
				this.ask<string | undefined>({ method: "input", title, placeholder }, undefined, opts),
			editor: (title: string, prefill?: string, opts?: DialogOptions) =>
				this.ask<string | undefined>({ method: "editor", title, prefill }, undefined, opts),

			notify: (message: string, type?: "info" | "warning" | "error") =>
				this.hooks.notify(message, type === "warning" ? "warn" : type === "error" ? "error" : "info"),

			setStatus: (key: string, text: string | undefined) => this.hooks.status(key, text),
			setWorkingMessage: (message?: string) => this.hooks.working(message),
			setTitle: () => {},
			setWorkingVisible: () => {},
			setWorkingIndicator: () => {},
			setHiddenThinkingLabel: () => {},
			setWidget: () => {},
			setFooter: () => {},
			setHeader: () => {},
			setToolsExpanded: () => {},
			getToolsExpanded: () => false,
			setEditorText: () => {},
			getEditorText: () => "",
			pasteToEditor: () => {},
			setEditorComponent: () => {},
			getEditorComponent: () => undefined,
			addAutocompleteProvider: () => () => {},
			onTerminalInput: () => () => {},
			getTheme: () => undefined,
			getAllThemes: () => [],
			setTheme: () => {},
			// `custom()` is a terminal screen driving its own keystrokes. Pi's own RPC
			// mode returns undefined here for the same reason: there is nothing on the
			// other end of a socket that could be one.
			custom: async () => undefined,
		};
	}

	/** Answer everything outstanding with its default, so nothing is left hanging. */
	dispose(): void {
		for (const [, pending] of this.pending) pending.resolve(pending.fallback);
		this.pending.clear();
	}
}
