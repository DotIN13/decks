import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import X from "lucide-solid/icons/x";
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Popover } from "../ui/Popover.tsx";
import { Icon } from "../ui/icons.tsx";
import { NO_WORKSPACE } from "./canvas-sections.ts";
import { WorkspaceField } from "./NewWorkspace.tsx";

/** The server keeps four of your tags at most (`agents/tags.ts`); past that the field goes away. */
const MAX_TAGS = 4;

/**
 * Everything about one agent that a person may change, in one window: three rows.
 *
 * ### What this replaced
 *
 * Three groups in the settings modal's shape, each a heading, a sentence saying what the
 * group was for, a field, and a rule written under it — 89 words on screen before anything
 * was pressed, for three facts. It read as a form to be studied rather than a thing to be
 * changed. What stands here instead is the settings modal's *row*: the fact on the left, the
 * one control that changes it on the right, and no hairline between rows because three rows
 * do not need dividing.
 *
 * ### A rule is said only when it bites
 *
 * - **The name** is how the bar addresses the agent (`@Sable`), so the deck refuses a name
 *   another agent already answers to. Rather than a sentence saying so, the field turns red
 *   with *Another agent is already called Sable* the moment the typed name is somebody
 *   else's, and Enter does nothing until it is not. The server is still the judge — a name it
 *   refuses comes back as a notice and an `agent.identity` that puts the old one back — but
 *   the window knows every name on the deck, so it can say so first.
 * - **The workspace** is picked from a list rather than typed: every workspace in use, *No
 *   workspace*, and *New workspace…*, which is the one place a name is typed. A second
 *   spelling of a project cannot happen, so the slug rule need not be written here either.
 * - **The tags** are yours alone (`Identity.userTags`), and the agent's own stay on its row in
 *   the panel, where they already were. Chips, and a field under them; the field goes away
 *   at the fourth tag, which is the cap, shown rather than stated.
 *
 * Committed on Enter or on leaving a field, and never on a keystroke, as before: a name is
 * a word the bar has to match, and a half-typed one sent on every key would rename the
 * agent five times on the way to *Sable*.
 */
export function AgentEdit(props: {
	agentId: string;
	/** The agent's name as the deck has it; the field follows this, so a refusal puts it back. */
	name: string;
	/** What you say about it. This is what the tag field edits. */
	userTags: string[];
	workspace?: string;
	/** Every workspace in use, which is the list the picker offers. */
	workspaces: string[];
	/** Whether another agent already answers to this name. Without it, only the server refuses. */
	taken?: (name: string) => boolean;
	/** The agent's face, for the window's header, so the window is visibly about one agent. */
	face?: JSX.Element;
	onRename: (name: string) => void;
	onTags: (tags: string[]) => void;
	onWorkspace: (workspace: string | null) => void;
	onClose: () => void;
}) {
	const [name, setName] = createSignal(props.name);
	const [draft, setDraft] = createSignal("");
	let nameField: HTMLInputElement | undefined;

	/* The field follows the agent rather than owning it: the agent names itself too, and a
	   refused rename comes back as the identity the server kept. */
	createEffect(() => setName(props.name));

	const taken = () => {
		const wanted = name().trim();
		if (wanted === "" || wanted.toLowerCase() === props.name.toLowerCase()) return false;
		return props.taken?.(wanted) ?? false;
	};

	onMount(() => {
		/*
		 * Escape closes it, and **in the capture phase**, which is the one thing here that is
		 * not like the other modals.
		 *
		 * `Settings` and `Usage` are opened by `App` and listed in its Escape handler, which
		 * is what keeps that key from also going Home. This window is opened by a row, three
		 * components deep in a panel, and putting its open/closed state in `App` so that
		 * handler could name it would be lifting state for the sake of a keystroke. Capturing
		 * is the alternative: while this is open it takes Escape *first*, closes, and stops
		 * the event — so the stage behind it neither goes Home nor drops its selection.
		 *
		 * While the workspace list is open, Escape is the list's: it closes itself, and a
		 * second press closes the window.
		 */
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (document.querySelector(".popover.agent-edit-list")) return;
			event.preventDefault();
			event.stopPropagation();
			props.onClose();
		};
		window.addEventListener("keydown", onKey, true);
		onCleanup(() => window.removeEventListener("keydown", onKey, true));
		// The name is what most visits here are for, so the cursor starts in it.
		requestAnimationFrame(() => nameField?.select());
	});

	const commitName = () => {
		const wanted = name().trim();
		if (taken()) return;
		if (!wanted || wanted === props.name) {
			setName(props.name);
			return;
		}
		props.onRename(wanted);
	};

	/*
	 * Split on **commas only**, not on whitespace.
	 *
	 * A tag may contain spaces, which the server turns into hyphens — so `Panel CSS` is one
	 * tag called `panel-css`, and splitting on whitespace made it two. Nothing else is
	 * validated here: the server slugs, dedupes and caps whatever arrives (`agents/tags.ts`),
	 * and two places deciding what a tag may be is how they come to disagree.
	 */
	const add = () => {
		const wanted = draft()
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);
		if (wanted.length === 0) return;
		setDraft("");
		props.onTags([...props.userTags, ...wanted]);
	};

	return (
		/*
		 * Dismissed by a press that *begins* on the backdrop: the press that opened this
		 * produces a `click` at the same coordinates afterwards, and a modal that closes
		 * itself on the way in is worse than one that will not close at all.
		 */
		<div
			class="picker-backdrop"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) props.onClose();
			}}
		>
			<div
				class="panel-float static flex max-h-[86%] w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden p-0"
				role="dialog"
				aria-label={`Edit ${props.name}`}
			>
				<header class="set-head">
					{props.face}
					<span class="set-head-title">{props.name}</span>
					<span class="flex-1" />
					<button class="iconbtn [--control:26px]" type="button" title="Close" aria-label="Close" onClick={props.onClose}>
						<Icon of={X} size={15} />
					</button>
				</header>

				<div class="agent-edit">
					<div class="agent-edit-row">
						<span class="agent-edit-k">Name</span>
						<div class="agent-edit-v">
							<label class="field h-8 flex-none gap-1.5 rounded-md" data-invalid={taken() ? "true" : undefined}>
								<input
									ref={nameField}
									type="text"
									aria-label="Agent name"
									aria-invalid={taken()}
									spellcheck={false}
									class="min-w-0 flex-1 border-0 bg-none text-[12px] text-fg outline-none placeholder:text-faint"
									maxLength={40}
									value={name()}
									onInput={(event) => setName(event.currentTarget.value)}
									onBlur={commitName}
									onKeyDown={(event) => {
										if (event.key !== "Enter") return;
										event.preventDefault();
										commitName();
									}}
								/>
							</label>
							<Show when={taken()}>
								<p class="agent-edit-err" role="alert">
									Another agent is already called {name().trim()}.
								</p>
							</Show>
						</div>
					</div>

					<div class="agent-edit-row">
						<span class="agent-edit-k">Workspace</span>
						<div class="agent-edit-v">
							<WorkspacePick {...(props.workspace ? { value: props.workspace } : {})} workspaces={props.workspaces} onPick={props.onWorkspace} />
						</div>
					</div>

					<div class="agent-edit-row agent-edit-tags">
						<span class="agent-edit-k">Tags</span>
						<div class="agent-edit-v">
							<Show when={props.userTags.length > 0}>
								<div class="tags">
									<For each={props.userTags}>
										{(tag) => (
											<span class="tag" data-mine="true">
												{tag}
												<button
													type="button"
													class="tag-x"
													title={`Remove ${tag}`}
													aria-label={`Remove ${tag}`}
													onClick={() => props.onTags(props.userTags.filter((other) => other !== tag))}
												>
													<Icon of={X} size={9} />
												</button>
											</span>
										)}
									</For>
								</div>
							</Show>
							<Show when={props.userTags.length < MAX_TAGS}>
								<label class="field h-8 flex-none gap-1.5 rounded-md">
									<input
										type="text"
										spellcheck={false}
										class="min-w-0 flex-1 border-0 bg-none text-[12px] text-fg outline-none placeholder:text-faint"
										placeholder="Add a tag"
										aria-label="Add a tag"
										value={draft()}
										onInput={(event) => setDraft(event.currentTarget.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												event.preventDefault();
												add();
											}
											// Backspace on an empty field takes the last one off, which is what
											// every tag field does and what a hand reaches for unprompted.
											if (event.key === "Backspace" && !draft() && props.userTags.length > 0) {
												event.preventDefault();
												props.onTags(props.userTags.slice(0, -1));
											}
										}}
									/>
								</label>
							</Show>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

/**
 * The workspace, as a list to pick from: a field-shaped button showing the current one, and
 * under it every workspace in use, *No workspace*, and *New workspace…*, which turns the
 * list into the shared name field. The same list the canvas menu's *Move to* shows, so the
 * two places a thing is filed under a project look alike.
 */
function WorkspacePick(props: { value?: string; workspaces: string[]; onPick: (workspace: string | null) => void }) {
	const [making, setMaking] = createSignal(false);
	const [wanted, setWanted] = createSignal("");
	let dismiss: (() => void) | undefined;
	const create = () => {
		const name = wanted().trim();
		if (!name) return;
		props.onPick(name);
		dismiss?.();
	};
	return (
		<Popover
			placement="bottom-start"
			class="agent-edit-list w-[266px]"
			label="Workspace"
			onOpenChange={() => {
				setMaking(false);
				setWanted("");
			}}
			trigger={(api) => {
				dismiss = () => {
					if (api.open) api.toggle();
				};
				return (
					<button
						ref={api.ref}
						type="button"
						class="field agent-edit-pick rounded-md"
						aria-haspopup="listbox"
						aria-expanded={api.open}
						aria-label="Workspace"
						onClick={api.toggle}
					>
						<span class="agent-edit-pick-v" data-none={props.value ? undefined : "true"}>
							{props.value ?? NO_WORKSPACE}
						</span>
						<Icon of={ChevronDown} size={13} />
					</button>
				);
			}}
		>
			<Show when={!making()} fallback={<WorkspaceField value={wanted()} onInput={setWanted} onCreate={create} autofocus />}>
				<For each={[...props.workspaces, ""]}>
					{(workspace) => {
						const current = () => (props.value ?? "") === workspace;
						return (
							<button
								type="button"
								data-row
								data-flat="true"
								data-current={current()}
								role="option"
								aria-selected={current()}
								onClick={() => {
									if (!current()) props.onPick(workspace || null);
								}}
							>
								<span class="lb flex-1">{workspace || NO_WORKSPACE}</span>
								<Show when={current()}>
									<Icon of={Check} size={11} class="text-accent" />
								</Show>
							</button>
						);
					}}
				</For>
				<button type="button" data-row data-flat="true" role="menuitem" aria-expanded={false} class="canvas-menu-new" onClick={() => setMaking(true)}>
					<span class="lb flex-1">New workspace…</span>
				</button>
			</Show>
		</Popover>
	);
}
