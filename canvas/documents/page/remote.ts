import type { DocRemoteStatus, DocServerMessage, GitStatus } from "../model.ts";
import type { DocSync } from "../client.ts";
import type { DocPageOptions } from "../page.ts";
import { el, svg } from "./parts.ts";

/** Where a document page's file lives besides the deck: its git repository, pulled and pushed, and the Google Doc it mirrors, with signing in. */

export type RemoteNeeds = {
	sync: DocSync;
	options: DocPageOptions;
	gitBox: HTMLElement;
	gitMenu: HTMLElement;
	googleBox: HTMLElement;
	googleMenu: HTMLElement;
	gitButton: HTMLButtonElement;
	googleButton: HTMLButtonElement;
	pdf: { readonly open: boolean; compileSoon(): void };
	drawComments: () => void;
	view: () => string;
};

export class Remotes {
	repo: GitStatus | undefined;
	gitBusy: "pull" | "push" | undefined;
	gitSaid: { ok: boolean; message: string } | undefined;
	remoteStatus: DocRemoteStatus | undefined;
	pasteSaid = "";

	constructor(private readonly n: RemoteNeeds) {
		// Git: its menu opens on the button and closes on a press anywhere else.
		const closeGit = () => {
			this.n.gitMenu.hidden = true;
			this.n.gitButton.setAttribute("aria-pressed", "false");
		};
		this.n.gitButton.onclick = () => {
			const open = this.n.gitMenu.hidden;
			this.n.gitMenu.hidden = !open;
			this.n.gitButton.setAttribute("aria-pressed", String(open));
			if (open) {
				if (!this.gitBusy) this.n.sync.git("status");
				this.drawGit();
			}
		};
		document.addEventListener("mousedown", (event) => {
			if (!this.n.gitBox.contains(event.target as Node)) closeGit();
		});
		// Google: the menu that links the file to a Doc, opened and closed the same way.
		this.n.googleButton.onclick = () => {
			const opening = this.n.googleMenu.hidden;
			this.n.googleMenu.hidden = !opening;
			this.n.googleButton.setAttribute("aria-pressed", String(opening));
			this.drawGoogle();
		};
		document.addEventListener("mousedown", (event) => {
			if (!this.n.googleBox.contains(event.target as Node)) {
				this.n.googleMenu.hidden = true;
				this.n.googleButton.setAttribute("aria-pressed", "false");
			}
		});
	}

	drawGit(): void {
		this.n.gitBox.hidden = !this.repo;
		if (!this.repo) return;
		const name = this.repo.label ?? "Git";
		this.n.gitButton.innerHTML = `${svg("branch")}<span>${this.gitBusy ? (this.gitBusy === "pull" ? "Pulling…" : "Pushing…") : name}</span>${this.repo.ahead && !this.gitBusy ? `<span class="dp-ahead" title="Commits not pushed yet">↑${this.repo.ahead}</span>` : ""}`;
		this.n.gitButton.title = `${this.repo.branch}${this.repo.upstream ? ` ↔ ${this.repo.upstream}` : ""}: pull and push`;
		if (this.n.gitMenu.hidden) return;
		const where = el("div", { class: "g-where" });
		where.innerHTML = svg("branch");
		where.append(this.repo.branch, ...(this.repo.upstream ? [el("span", { style: "font-weight:400;color:var(--b-muted,#666)" }, `↔ ${this.repo.upstream}`)] : []));
		const parts: string[] = [];
		if (this.repo.changed) parts.push(`${this.repo.changed} file${this.repo.changed === 1 ? "" : "s"} edited since the last commit`);
		if (this.repo.ahead) parts.push(`${this.repo.ahead} commit${this.repo.ahead === 1 ? "" : "s"} to push`);
		if (this.repo.behind) parts.push(`${this.repo.behind} to pull`);
		const state = el("div", { class: "g-state" }, this.repo.upstream ? (parts.length ? `${parts.join(", ")}.` : `In step with ${name} as of the last pull.`) : "This branch has no remote branch to pull from or push to.");
		const pull = el("button", { type: "button", class: "dp-btn dp-outline" });
		pull.innerHTML = `${svg("pull")}<span>${this.gitBusy === "pull" ? "Pulling…" : "Pull"}</span>`;
		const push = el("button", { type: "button", class: "dp-btn dp-primary" });
		push.innerHTML = `${svg("push")}<span>${this.gitBusy === "push" ? "Pushing…" : "Push"}</span>`;
		pull.disabled = push.disabled = !!this.gitBusy || !this.repo.upstream;
		pull.title = `Commit what is edited here, and merge in what changed on ${name}`;
		push.title = `Pull, then send the commits made here to ${name}`;
		pull.onclick = () => this.runGit("pull");
		push.onclick = () => this.runGit("push");
		const acts = el("div", { class: "g-acts" });
		acts.append(pull, push);
		const said = el("div", { class: "g-said", "data-ok": String(this.gitSaid?.ok ?? true) }, this.gitSaid?.message ?? "");
		said.hidden = !this.gitSaid;
		const note = el("div", { class: "g-note" }, `Edits here are committed as "Edited in Decks" before each pull. What a pull brings in is highlighted as a change.`);
		this.n.gitMenu.replaceChildren(where, ...(this.repo.remote ? [el("div", { class: "g-remote", title: this.repo.remote }, this.repo.remote)] : []), state, acts, said, note);
	}

	runGit(action: "pull" | "push"): void {
		if (this.gitBusy) return;
		this.gitBusy = action;
		this.gitSaid = undefined;
		this.drawGit();
		this.n.sync.git(action);
	}

	repoAnswered(message: Extract<DocServerMessage, { type: "doc.repo" }>): void {
		if (message.action === "status") this.repo = message.status;
		else {
			this.gitBusy = undefined;
			if (message.status) this.repo = message.status;
			this.gitSaid = { ok: message.ok, message: message.message ?? (message.ok ? "Done." : "git stopped.") };
			// The PDF follows what the pull brought in.
			if (message.ok && this.n.pdf.open) this.n.pdf.compileSoon();
		}
		this.drawGit();
	}

	/** Signing in to Google: a button, and for a Desktop client the box to paste the address back into. */
	signInParts(): HTMLElement[] {
		if (!this.n.options.api) return [];
		const parts: HTMLElement[] = [];
		const signIn = el("button", { type: "button", class: "dp-btn dp-primary" }, "Sign in with Google");
		signIn.style.justifyContent = "center";
		signIn.onclick = () => window.open(`${this.n.options.api}/google/signin?origin=${encodeURIComponent(location.origin)}`, "_blank", "noopener");
		parts.push(signIn);
		if (this.remoteStatus?.paste !== false) {
			const form = el("form", { class: "g-paste" });
			const input = el("input", { type: "url", placeholder: "Paste the address Google sent you to", "aria-label": "Address after signing in" });
			const done = el("button", { type: "submit", class: "dp-btn dp-outline" }, "Done");
			form.append(input, done);
			form.onsubmit = (event) => {
				event.preventDefault();
				void fetch(`${this.n.options.api}/google/code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: input.value }) })
					.then((r) => r.json() as Promise<{ ok: boolean; email?: string; message?: string }>)
					.then((answer) => {
						this.pasteSaid = answer.ok ? `Signed in as ${answer.email}.` : (answer.message ?? "That did not work.");
						this.drawGoogle();
						if (this.n.view() === "comments") this.n.drawComments();
					});
			};
			parts.push(form);
		}
		if (this.pasteSaid) parts.push(el("div", { class: "g-note" }, this.pasteSaid));
		return parts;
	}

	drawGoogle(): void {
		const remote = this.n.sync.remote;
		this.n.googleBox.hidden = !remote;
		if (!remote) return;
		const state = this.remoteStatus?.state ?? "syncing";
		const words = { synced: "Google Docs", syncing: "Syncing…", signin: "Sign in", error: "Not in step" }[state];
		this.n.googleButton.innerHTML = `${svg(state === "signin" || state === "error" ? "cloudoff" : "cloud")}<span>${words}</span><span class="dp-dot" data-state="${state}"></span>`;
		if (this.n.googleMenu.hidden) return;
		const head = el("div", { class: "g-where" });
		head.innerHTML = svg("cloud");
		head.append(remote.title);
		const open = el("a", { class: "g-open", href: remote.url, target: "_blank", rel: "noopener" }, "Open in Google Docs");
		open.insertAdjacentHTML("beforeend", svg("external"));
		const when = this.remoteStatus?.at ? new Date(this.remoteStatus.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
		const line =
			state === "synced" ? `In step with the Doc${when ? ` since ${when}` : ""}. Edits here reach Google in about two seconds; others' edits arrive highlighted.`
			: state === "syncing" ? "Sending your edits to Google…"
			: (this.remoteStatus?.message ?? "");
		const said = el("div", { class: "g-said", "data-ok": String(state === "synced" || state === "syncing") }, line);
		const parts: HTMLElement[] = [head, open, said];
		if (state === "signin" && this.n.options.api) parts.push(...this.signInParts());
		const who = this.remoteStatus?.mode === "fake" ? "A stand-in for Google on this server: no Google account is connected." : this.remoteStatus?.email ? `Signed in to Google as ${this.remoteStatus.email}.` : "";
		if (who) parts.push(el("div", { class: "g-note" }, who));
		this.n.googleMenu.replaceChildren(...parts);
	}
	/** What the server last said of the Google Doc's sync. */
	get status(): DocRemoteStatus | undefined {
		return this.remoteStatus;
	}

	set status(next: DocRemoteStatus | undefined) {
		this.remoteStatus = next;
	}
}
