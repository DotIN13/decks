import type { DocServerMessage, GitStatus } from "../index.ts";
import { formatList, m } from "@decks/i18n";
import type { PageContext } from "./context.ts";
import { el, svg } from "./ui.ts";

/**
 * Git, for a file in a repository: a button naming the branch and what is not pushed, and a popover
 * with where it tracks, how far apart they are, and Pull and Push.
 */

export function mountGit(ctx: PageContext): () => void {
	const { sync } = ctx;
	const { gitBox } = ctx.dom;
	const gitButton = el("button", { type: "button", class: "dp-btn", "aria-pressed": "false", "aria-haspopup": "dialog", title: m.docs_git_title() });
	const gitMenu = el("div", { class: "dp-gitmenu", role: "dialog", hidden: "" });
	gitBox.append(gitButton, gitMenu);
	let repo: GitStatus | undefined;
	let gitBusy: "pull" | "push" | undefined;
	let gitSaid: { ok: boolean; message: string } | undefined;

	function drawGit(): void {
		gitBox.hidden = !repo;
		if (!repo) return;
		const name = repo.label ?? "Git";
		gitButton.innerHTML = `${svg("branch")}<span>${gitBusy ? (gitBusy === "pull" ? m.docs_git_pulling() : m.docs_git_pushing()) : name}</span>${repo.ahead && !gitBusy ? `<span class="dp-ahead" title="${m.docs_git_not_pushed()}">↑${repo.ahead}</span>` : ""}`;
		gitButton.title = m.docs_git_button_title({ branch: `${repo.branch}${repo.upstream ? ` ↔ ${repo.upstream}` : ""}` });
		if (gitMenu.hidden) return;
		const where = el("div", { class: "g-where" });
		where.innerHTML = svg("branch");
		where.append(repo.branch, ...(repo.upstream ? [el("span", { style: "font-weight:400;color:var(--b-muted,#666)" }, `↔ ${repo.upstream}`)] : []));
		const parts: string[] = [];
		if (repo.changed) parts.push(m.docs_git_changed({ count: repo.changed }));
		if (repo.ahead) parts.push(m.docs_git_ahead({ count: repo.ahead }));
		if (repo.behind) parts.push(m.docs_git_behind({ count: repo.behind }));
		const state = el("div", { class: "g-state" }, repo.upstream ? (parts.length ? m.docs_git_state({ parts: formatList(parts) }) : m.docs_git_in_step({ name })) : m.docs_git_no_remote());
		const pull = el("button", { type: "button", class: "dp-btn dp-outline" });
		pull.innerHTML = `${svg("pull")}<span>${gitBusy === "pull" ? m.docs_git_pulling() : m.docs_git_pull()}</span>`;
		const push = el("button", { type: "button", class: "dp-btn dp-primary" });
		push.innerHTML = `${svg("push")}<span>${gitBusy === "push" ? m.docs_git_pushing() : m.docs_git_push()}</span>`;
		pull.disabled = push.disabled = !!gitBusy || !repo.upstream;
		pull.title = m.docs_git_pull_title({ name });
		push.title = m.docs_git_push_title({ name });
		pull.onclick = () => runGit("pull");
		push.onclick = () => runGit("push");
		const acts = el("div", { class: "g-acts" });
		acts.append(pull, push);
		const said = el("div", { class: "g-said", "data-ok": String(gitSaid?.ok ?? true) }, gitSaid?.message ?? "");
		said.hidden = !gitSaid;
		const note = el("div", { class: "g-note" }, m.docs_git_note());
		gitMenu.replaceChildren(where, ...(repo.remote ? [el("div", { class: "g-remote", title: repo.remote }, repo.remote)] : []), state, acts, said, note);
	}

	function runGit(action: "pull" | "push"): void {
		if (gitBusy) return;
		gitBusy = action;
		gitSaid = undefined;
		drawGit();
		sync.git(action);
	}

	function repoAnswered(message: Extract<DocServerMessage, { type: "doc.repo" }>): void {
		if (message.action === "status") repo = message.status;
		else {
			gitBusy = undefined;
			if (message.status) repo = message.status;
			gitSaid = { ok: message.ok, message: message.message ?? (message.ok ? m.docs_git_done() : m.docs_git_stopped()) };
			// The PDF follows what the pull brought in.
			if (message.ok) ctx.hooks.compileSoon();
		}
		drawGit();
	}

	const closeGit = () => {
		gitMenu.hidden = true;
		gitButton.setAttribute("aria-pressed", "false");
	};
	gitButton.onclick = () => {
		const open = gitMenu.hidden;
		gitMenu.hidden = !open;
		gitButton.setAttribute("aria-pressed", String(open));
		if (open) {
			if (!gitBusy) sync.git("status");
			drawGit();
		}
	};
	const outside = (event: MouseEvent) => {
		if (!gitBox.contains(event.target as Node)) closeGit();
	};
	document.addEventListener("mousedown", outside);
	ctx.on("doc.repo", (message) => repoAnswered(message));
	return () => document.removeEventListener("mousedown", outside);
}
