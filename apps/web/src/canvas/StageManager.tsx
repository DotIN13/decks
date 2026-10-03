import { api } from "../connections/connection.ts";
import Lock from "lucide-solid/icons/lock";
import Pencil from "lucide-solid/icons/pencil";
import Trash from "lucide-solid/icons/trash-2";
import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import LayoutDashboard from "lucide-solid/icons/layout-dashboard";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { StageRow } from "@decks/protocol";
import { Icon } from "../ui/icons.tsx";
import { searchStages } from "../state/stages.ts";
import { AgentFace } from "../agents/AgentPill.tsx";

/**
 * The stage manager: every stage in the deck, as cards, in a panel over the canvas.
 *
 * A stage is a folder of work — its boards and its drawing — and until this there was no way for
 * a person to see that more than one existed, let alone move between them. An agent could
 * (`stage.stages`, `stage.open`); the browser was never told.
 *
 * ### Why a panel and not the canvas itself
 *
 * It was drawn as a wall that the canvas zoomed out into, your own stage shrinking into its place
 * among the others. That is the better picture and the worse build: it needs two bespoke
 * transitions, and a transition that has to be perfect to be understood at all is a liability. A
 * panel is a thing this app already has, and it states what is true — you are choosing, and the
 * work you are choosing from is still there behind it.
 *
 * So there is one 120ms fade, in and out, and nothing else. Opening a stage is a *click*: the panel closes and
 * the camera lands on the middle of that stage's work (`camera.middleOf`).
 *
 * ### The layout
 *
 * A heading that says what this is and how many there are, the search, and a button that makes a
 * canvas by naming it in place (it used to be the browser's own `prompt`). Then the canvases, the
 * one you are on first and the rest by when they last changed, since the one you want is almost
 * always one you were just in. A line of keys at the foot.
 *
 * ### The card
 *
 * A picture of the whole canvas, taken by the server once per revision (`/api/stage-thumb`), on the
 * canvas's own ground; an empty canvas says so instead of showing a blank tile. Under it the name
 * with the faces of whoever is on it, and a quieter line with how many boards and when it last
 * changed. Rename and delete float on the picture's corner, shown on hover or focus, so a wall of
 * cards is a wall of pictures rather than of pencils and bins. The canvas you are on wears the
 * accent and says "Current".
 */
/** The panel's fade, in and out: `stages.css` says the same 120ms. */
const FADE_MS = 120;


export function StageManager(props: {
	stages: StageRow[];
	/** The stage the conversation on screen is on, so its card is marked. */
	here: string | undefined;
	open: boolean;
	onClose: () => void;
	/** Put the agent you are talking to on this stage. */
	onPick: (name: string) => void;
	/** Make a stage from a name, and open it. */
	onNew: (title: string) => void;
	scheme: "light" | "dark";
	/** The agent is isolated: only isolated stages are offered, since those are all it may open. */
	isolated?: boolean;
	/** Rename a stage; the server makes the name folder-safe and refuses one that is taken. */
	onRename: (name: string, to: string) => void;
	/** Delete a stage, with its drawing and any boards kept in its own folder. */
	onDelete: (name: string) => void;
}) {
	const [query, setQuery] = createSignal("");
	let field: HTMLInputElement | undefined;

	/* Opening is where the query is cleared and the field takes the keyboard: a manager that
	   opened on last week's search would be a manager that lies about how many stages there are. */
	createEffect(() => {
		if (!props.open) return;
		setQuery("");
		queueMicrotask(() => field?.focus());
	});

	/*
	 * Mounted is not the same as open: the panel fades out as it fades in, so it stays in the
	 * page until its opacity has reached 0. `shown` goes a frame after mounting, so the fade in
	 * has an opacity of 0 to start from.
	 *
	 * The unmount is on a timer, not on `transitionend`. A close that lands before the fade in
	 * has moved cancels the transition rather than finishing it, no `transitionend` comes, and
	 * the panel stayed in the page, invisible, with the keyboard still in its field.
	 */
	const [mounted, setMounted] = createSignal(false);
	const [shown, setShown] = createSignal(false);
	createEffect(() => {
		if (props.open) {
			setMounted(true);
			requestAnimationFrame(() =>
				requestAnimationFrame(() => {
					// Closed again before it ever showed: there is no fade to wait for.
					if (props.open) {
						setShown(true);
						// Again, now the field is certainly in the page: the microtask above can run
						// before the panel has mounted, and then Escape has nowhere to go.
						field?.focus();
					} else setMounted(false);
				}),
			);
		} else {
			setShown(false);
			const gone = setTimeout(() => !props.open && setMounted(false), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : FADE_MS + 40);
			onCleanup(() => clearTimeout(gone));
		}
	});

	/* Escape closes it wherever the keyboard is, not only from the field: a tap on a card's gap
	   on a phone, or a click on the count, takes focus out of the field. */
	createEffect(() => {
		if (!props.open) return;
		const escape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			event.preventDefault();
			props.onClose();
		};
		document.addEventListener("keydown", escape);
		onCleanup(() => document.removeEventListener("keydown", escape));
	});

	/* Isolated, the isolated stages are the whole list: the server refuses the rest anyway. */
	const offered = createMemo(() => (props.isolated ? props.stages.filter((stage) => stage.isolated) : props.stages));
	const rows = createMemo(() => searchStages(offered(), query()));
	const found = createMemo(() => rows().filter((one) => one.hit).length);
	const searching = () => query().trim() !== "";

	const open = (name: string) => {
		props.onPick(name);
		props.onClose();
	};

	/* The canvas you are on first, then the rest by when they last changed: the one you want is
	   almost always one you were just in. A search leaves only what matches (`searchStages`). */
	const ordered = createMemo(() => {
		const list = rows().filter((one) => one.hit);
		const at = (one: StageRow) => (one.name === props.here ? Number.POSITIVE_INFINITY : (one.changedAt ?? 0));
		return list.sort((a, b) => at(b.stage) - at(a.stage) || a.stage.title.localeCompare(b.stage.title));
	});

	/* A new canvas is named in place, in the heading: the browser's own prompt was the one piece of
	   this app that looked like a different app. */
	const [naming, setNaming] = createSignal(false);
	let nameField: HTMLInputElement | undefined;
	createEffect(() => {
		if (!props.open) setNaming(false);
	});
	const create = () => {
		const title = nameField?.value.trim() ?? "";
		if (!title) return;
		setNaming(false);
		props.onNew(title);
		props.onClose();
	};

	return (
		<Show when={mounted()}>
			{/*
				The scrim is what makes this a panel rather than a menu: the canvas is still there,
				quieter. A press on it closes, which is the other half of Escape.
			*/}
			<div
				class="stage-manager"
				role="dialog"
				aria-label="Canvases"
				data-open={shown() ? "true" : undefined}
				onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}
			>
				<div class="stage-box">
					<div class="stage-head">
						<div class="stage-title-row">
							<h2 class="stage-title">
								Canvases
								<span class="stage-count tabular-nums">{searching() ? `${found()} of ${offered().length}` : offered().length}</span>
							</h2>
							<Show
								when={naming()}
								fallback={
									<button type="button" class="stage-new" onClick={() => setNaming(true)}>
										<Icon of={Plus} size={14} />
										New canvas
									</button>
								}
							>
								<form
									class="stage-new-form"
									onSubmit={(event) => {
										event.preventDefault();
										create();
									}}
								>
									<input
										ref={(element) => {
											nameField = element;
											queueMicrotask(() => element.focus());
										}}
										class="stage-new-field"
										placeholder="Name the new canvas"
										spellcheck={false}
										onKeyDown={(event) => {
											if (event.key !== "Escape") return;
											event.preventDefault();
											event.stopPropagation();
											setNaming(false);
											field?.focus();
										}}
									/>
									<button type="submit" class="stage-new">Create</button>
									<button type="button" class="stage-icon" aria-label="Cancel" onClick={() => setNaming(false)}>
										<Icon of={X} size={14} />
									</button>
								</form>
							</Show>
						</div>
						<label class="stage-search">
							<Icon of={Search} class="flex-none text-faint" size={15} />
							<input
								ref={field}
								type="text"
								spellcheck={false}
								placeholder={`Search ${offered().length} ${props.isolated ? "isolated " : ""}canvas${offered().length === 1 ? "" : "es"}`}
								title="Matches a canvas's name, the words on its boards and notes, and who is on it"
								value={query()}
								onInput={(event) => setQuery(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										event.preventDefault();
										if (query()) setQuery("");
										else props.onClose();
										return;
									}
									// The commonest search is two letters and the one answer: Enter opens it.
									if (event.key !== "Enter") return;
									const first = ordered().find((one) => one.hit);
									if (first) open(first.stage.name);
								}}
							/>
							<Show when={searching() && found() > 0}>
								<kbd class="stage-kbd">↵</kbd>
							</Show>
						</label>
					</div>

					<div class="stage-wall">
						<For each={ordered()}>
							{(row) => (
								<StageCard
									row={row}
									here={props.here}
									searching={searching()}
									scheme={props.scheme}
									onOpen={open}
									onRename={props.onRename}
									onDelete={props.onDelete}
								/>
							)}
						</For>
						<Show when={searching() && found() === 0}>
							<p class="stage-none">No canvas matches “{query().trim()}”.</p>
						</Show>
					</div>

					<div class="stage-keys" aria-hidden="true">
						<span><kbd class="stage-kbd">↵</kbd> open the first match</span>
						<span><kbd class="stage-kbd">esc</kbd> close</span>
					</div>
				</div>
			</div>
		</Show>
	);
}

/** When a canvas last changed, as a short phrase: "just now", "5 min ago", "yesterday", "12 Sep". */
function since(at: number | undefined, now = Date.now()): string | undefined {
	if (!at) return undefined;
	const minutes = Math.floor((now - at) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	const days = Math.floor(hours / 24);
	if (days === 1) return "yesterday";
	if (days < 7) return `${days} days ago`;
	return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * One stage in the manager: its picture, which opens it, and a line with its name, who is on it,
 * and two quiet controls — rename, which edits the name where it is drawn, and delete, which asks
 * once in its own place before it does anything.
 */
function StageCard(props: {
	row: { stage: StageRow; hit: boolean };
	here: string | undefined;
	searching: boolean;
	scheme: "light" | "dark";
	onOpen: (name: string) => void;
	onRename: (name: string, to: string) => void;
	onDelete: (name: string) => void;
}) {
	const [editing, setEditing] = createSignal(false);
	const [confirming, setConfirming] = createSignal(false);
	const stage = () => props.row.stage;
	let input: HTMLInputElement | undefined;
	/* An edit ends once: taking the field away can blur it, and that blur must not rename again. */
	let settled = true;
	const startEditing = () => {
		settled = false;
		setEditing(true);
	};
	const commit = () => {
		if (settled) return;
		settled = true;
		const to = input?.value.trim() ?? "";
		setEditing(false);
		// The name only: the folder is the stage's id and stays (`StagePens.setTitle`).
		if (to && to !== stage().title) props.onRename(stage().name, to);
	};
	const cancel = () => {
		settled = true;
		setEditing(false);
	};

	const here = () => stage().name === props.here;
	const boards = () => stage().boards;
	const meta = () => [boards() === 0 ? "Empty" : `${boards()} board${boards() === 1 ? "" : "s"}`, since(stage().changedAt)].filter(Boolean).join(" · ");
	const [broken, setBroken] = createSignal(false);

	return (
		<div
			class="stage-card"
			data-name={stage().name}
			data-here={here() ? "true" : undefined}
			title={`${stage().title}: ${meta()}${here() ? ", you are here" : stage().agents.length === 0 ? ", nobody on it" : ""}`}
			onClick={() => !editing() && props.onOpen(stage().name)}
			onPointerLeave={() => setConfirming(false)}
		>
			{/*
				The picture is the canvas as the server drew it, cached by the drawing's revision — so an
				unchanged canvas is never redrawn, and a changed one cannot show yesterday. An empty canvas,
				or one with no picture to be had, says what it is rather than showing a blank tile.
			*/}
			<button type="button" class="stage-open" aria-label={`Open ${stage().title}`}>
				<Show
					when={boards() > 0 && !broken()}
					fallback={
						<span class="stage-empty">
							<Icon of={LayoutDashboard} size={22} />
							<span>{boards() > 0 ? "No picture yet" : "Empty canvas"}</span>
						</span>
					}
				>
					<img
						class="stage-shot"
						src={api(`/stage-thumb/${encodeURIComponent(stage().name)}?v=${stage().rev}&scheme=${props.scheme}`)}
						alt=""
						loading="lazy"
						onError={() => setBroken(true)}
						onLoad={(event) => event.currentTarget.setAttribute("data-loaded", "")}
					/>
				</Show>
				<Show when={here()}>
					<span class="stage-current">Current</span>
				</Show>
				{/* Copied back from an isolated stage when isolation ended: on the picture's corner, at a glance. */}
				<Show when={stage().fromIsolation}>
					<span class="stage-badge" title="Copied back from an isolated canvas when isolation ended">
						<Icon of={Lock} size={11} />
						Isolated
					</span>
				</Show>
			</button>
			<span class="stage-acts" data-confirming={confirming() ? "true" : undefined} onClick={(event) => event.stopPropagation()}>
				<Show
					when={confirming()}
					fallback={
						<>
							<button type="button" class="stage-icon" title="Rename" aria-label={`Rename ${stage().title}`} onClick={startEditing}>
								<Icon of={Pencil} size={13} />
							</button>
							<button type="button" class="stage-icon" title="Delete" aria-label={`Delete ${stage().title}`} onClick={() => setConfirming(true)}>
								<Icon of={Trash} size={13} />
							</button>
						</>
					}
				>
					<button type="button" class="stage-icon" aria-label="Keep it" onClick={() => setConfirming(false)}>
						<Icon of={X} size={13} />
					</button>
					<button
						type="button"
						class="stage-confirm"
						title="Deletes the canvas, its drawing and any boards kept in its own folder. The deck's own boards stay."
						onClick={() => {
							setConfirming(false);
							props.onDelete(stage().name);
						}}
					>
						Delete canvas
					</button>
				</Show>
			</span>
			<span class="stage-foot">
				<span class="stage-name-row">
					<Show when={editing()} fallback={<span class="row-label">{stage().title}</span>}>
						<input
							ref={(element) => {
								input = element;
								queueMicrotask(() => {
									element.focus();
									element.select();
								});
							}}
							class="stage-rename"
							value={stage().title}
							spellcheck={false}
							aria-label={`New name for ${stage().title}`}
							onClick={(event) => event.stopPropagation()}
							onKeyDown={(event) => {
								// Handled here, so Escape cancels the rename rather than closing the manager.
								if (event.key === "Enter") {
									event.preventDefault();
									commit();
								} else if (event.key === "Escape") {
									event.preventDefault();
									event.stopPropagation();
									cancel();
								}
							}}
							onBlur={commit}
						/>
					</Show>
					<span class="stage-faces">
						<For each={stage().agents}>
							{(agent) => <AgentFace chat={{ id: agent.id, name: agent.name, kind: "claude", state: "idle" } as never} identity={{ name: agent.name, color: agent.color }} size={18} ring={0} />}
						</For>
					</span>
				</span>
				<span class="stage-meta">{meta()}</span>
			</span>
		</div>
	);

}
