import X from "lucide-solid/icons/x";
import { createEffect, createSignal, createUniqueId, For, onCleanup, onMount, Show } from "solid-js";
import { Icon } from "../ui/icons.tsx";

/**
 * Everything about one agent that a person may change, in one window.
 *
 * ### What this replaced
 *
 * A 228px popover hanging off a pen in the row's action column, holding a workspace field
 * and a tag field. It was the right two fields in the wrong container: a popover is for a
 * choice you make and dismiss, and this is a small form — three fields, each with a rule
 * about what it accepts, and one of them (the name) could not be in there at all because
 * there was no room to say why a name was refused. It also could not be opened from
 * anywhere else, so the name in the pill and the name in the panel were edited by two
 * different gestures in two different places.
 *
 * So it is the app's modal instead, the shape `Settings` and `Usage` already are:
 * `.picker-backdrop` over everything, a `.set-head` naming the subject, groups on a
 * recessed ground. Nothing new to learn, and room for each field to say its own rule.
 *
 * ### The three fields are three different kinds of fact
 *
 * - **The name** is the agent's own, and yours to change: it is how the bar addresses it
 *   (`@Sable`), so the deck refuses a name another agent already answers to. The refusal
 *   comes back as a notice and an `agent.identity` that puts the old name back in the field.
 * - **The workspace** is a location, one value, and either of you may write it — the agent
 *   through `stage.canvas(name)` and you through here.
 * - **The tags** are two lists that never write to each other: what the agent says it is
 *   doing, which is read-only here, and what *you* say about it, which is what this edits.
 *
 * Committed on Enter or on leaving a field, and never on a keystroke: a workspace is a word
 * other agents have to say, and `polit`, `politi`, `political-llm` typed into a live field
 * would be three workspaces, two of them abandoned.
 */
export function AgentEdit(props: {
	agentId: string;
	/** The agent's name as the deck has it; the field follows this, so a refusal puts it back. */
	name: string;
	/** What the agent says it is doing. Read-only: it is the agent's sentence, not yours. */
	tags: string[];
	/** What you say about it. This is what the tag field edits. */
	userTags: string[];
	workspace?: string;
	/** Every workspace in use, as suggestions — the one thing that stops a second spelling. */
	workspaces: string[];
	onRename: (name: string) => void;
	onTags: (tags: string[]) => void;
	onWorkspace: (workspace: string | null) => void;
	onClose: () => void;
}) {
	const [name, setName] = createSignal(props.name);
	const [room, setRoom] = createSignal(props.workspace ?? "");
	const [draft, setDraft] = createSignal("");
	const listId = createUniqueId();
	let nameField: HTMLInputElement | undefined;

	/*
	 * The fields follow the agent rather than owning it.
	 *
	 * Both of these have two writers — the agent names itself and declares its workspace,
	 * you do the same from here — so a field that only held what you last typed would sit
	 * there disagreeing with the row it was opened from. It is also how a refused rename
	 * puts the old name back: the server replies with the identity it kept.
	 */
	createEffect(() => setName(props.name));
	createEffect(() => setRoom(props.workspace ?? ""));

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
		 * On `window` rather than the card, for the reason `Settings` gives: a handler on a
		 * div only fires while focus is inside it, and nothing here holds focus once a chip's
		 * × has been pressed.
		 */
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
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
		if (!wanted || wanted === props.name) {
			setName(props.name);
			return;
		}
		props.onRename(wanted);
	};

	const commitRoom = () => {
		const wanted = room().trim();
		if (wanted === (props.workspace ?? "")) return;
		props.onWorkspace(wanted || null);
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
				class="panel-float static flex max-h-[86%] w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden p-0"
				role="dialog"
				aria-label={`Edit ${props.name}`}
			>
				<header class="set-head">
					<span class="set-head-title">{props.name}</span>
					<span class="flex-1" />
					<button class="iconbtn [--control:26px]" type="button" title="Close" aria-label="Close" onClick={props.onClose}>
						<Icon of={X} size={15} />
					</button>
				</header>

				<div class="set-body">
					<section class="set-group">
						<header>
							<span class="set-title">Name</span>
							<span class="set-note">how you address it from the bar</span>
						</header>
						<div class="agent-edit-pad">
							<label class="field h-8 flex-none gap-1.5 rounded-md">
								<input
									ref={nameField}
									type="text"
									aria-label="Agent name"
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
							<p class="nt m-0">⏎ to rename. Two agents cannot share a name; the deck says so and keeps the old one.</p>
						</div>
					</section>

					<section class="set-group">
						<header>
							<span class="set-title">Workspace</span>
							<span class="set-note">the project it is on, which the panel groups by</span>
						</header>
						<div class="agent-edit-pad">
							<label class="field h-8 flex-none gap-1.5 rounded-md">
								<input
									type="text"
									aria-label="Workspace"
									spellcheck={false}
									class="min-w-0 flex-1 border-0 bg-none text-[12px] text-fg outline-none placeholder:text-faint"
									placeholder="No workspace"
									list={listId}
									value={room()}
									onInput={(event) => setRoom(event.currentTarget.value)}
									onBlur={commitRoom}
									onKeyDown={(event) => {
										if (event.key !== "Enter") return;
										event.preventDefault();
										commitRoom();
									}}
								/>
							</label>
							<datalist id={listId}>
								<For each={props.workspaces}>{(workspace) => <option value={workspace} />}</For>
							</datalist>
							<p class="nt m-0">Slugged and cut at 24 characters. ⏎ to move it; empty leaves the workspace.</p>
						</div>
					</section>

					<section class="set-group">
						<header>
							<span class="set-title">Tags</span>
							<span class="set-note">yours to write; the agent's are shown, not edited</span>
						</header>
						<div class="agent-edit-pad">
							<Show when={props.tags.length > 0}>
								<div class="tags">
									<For each={props.tags}>{(tag) => <span class="tag">{tag}</span>}</For>
								</div>
								<p class="nt m-0">What it says it is doing. It rewrites these itself, so they are not yours to keep.</p>
							</Show>

							<Show
								when={props.userTags.length > 0}
								fallback={<p class="nt m-0">None of yours yet. These are yours alone: the agent cannot see or overwrite them.</p>}
							>
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

							<label class="field h-8 flex-none gap-1.5 rounded-md">
								<input
									type="text"
									spellcheck={false}
									class="min-w-0 flex-1 border-0 bg-none text-[12px] text-fg outline-none placeholder:text-faint"
									placeholder="Add a tag…"
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
							<p class="nt m-0">Four at most, lowercased and hyphenated. ⏎ to add.</p>
						</div>
					</section>
				</div>
			</div>
		</div>
	);
}
