/**
 * The gallery: every board, as a picture, shelved by workspace.
 *
 * The server's picture of each board (`BoardPicture`), the title on a plain tile where there
 * is not one yet — the tile is the placeholder the picture replaces, so the grid never
 * jumps when a photograph lands. Pressing a card previews the live board over the
 * dashboard; it does not move the camera, because looking is not the same as going.
 *
 * The chips and the field narrow the same list, so "changed, matching *plan*" is one
 * gesture and not two lists to reconcile.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { BoardPicture } from "./BoardPicture.tsx";
import { fileName, filterCards, type GalleryCard, type GalleryFilter, type GalleryGroup } from "./dispatch-view.ts";

export interface GalleryProps {
	groups: GalleryGroup[];
	onPreview: (path: string) => void;
	/** The "by" chip: open that agent's conversation. */
	onOpenAgent: (id: string) => void;
	/** The "from a task" chip: show that task on the Tasks tab. */
	onOpenTask: (id: string) => void;
}

const FILTERS: { id: GalleryFilter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "changed", label: "Changed" },
	{ id: "from-tasks", label: "From tasks" },
];

export function Gallery(props: GalleryProps) {
	const [filter, setFilter] = createSignal<GalleryFilter>("all");
	const [query, setQuery] = createSignal("");
	// Shelves the person has toggled, by name; anything not here keeps its default fold.
	const [folded, setFolded] = createSignal<Record<string, boolean>>({});
	const isFolded = (group: GalleryGroup) => folded()[group.name] ?? group.collapsed;
	const toggle = (group: GalleryGroup) => setFolded((was) => ({ ...was, [group.name]: !isFolded(group) }));

	/*
	 * The paths that started being news since the last build, for the one pulse on the spine.
	 *
	 * Deliberately not a per-card effect: every card is a new object on every store change (the
	 * groups are derived), so `<For>` re-creates the components and a card can never observe its
	 * own `changed` going from false to true. Watched here, where the previous set can be kept.
	 *
	 * The first build is not an arrival — a dashboard opened on a shelf of marks is not a shelf of
	 * marks arriving — so it only fills the set.
	 */
	const [arrived, setArrived] = createSignal<ReadonlySet<string>>(new Set());
	let wasNews: Set<string> | undefined;
	createEffect(() => {
		const now = new Set(props.groups.flatMap((group) => group.cards).filter((card) => card.changed).map((card) => card.board.path));
		const before = wasNews;
		wasNews = now;
		if (!before) return;
		const fresh = new Set([...now].filter((path) => !before.has(path)));
		if (fresh.size === 0) return;
		setArrived(fresh);
		const timer = setTimeout(() => setArrived(new Set()), 1000);
		onCleanup(() => clearTimeout(timer));
	});

	const every = createMemo(() => props.groups.flatMap((group) => group.cards));
	const count = (id: GalleryFilter) => filterCards(every(), id, "").length;

	return (
		<div class="dispatch-gallery">
			<div class="dispatch-gallery-bar">
				<div class="dispatch-filters" role="group" aria-label="Filter boards">
					<For each={FILTERS}>
						{(one) => (
							<button type="button" class="chipbtn" data-on={filter() === one.id} onClick={() => setFilter(one.id)}>
								{one.label}
								<span class="sub">{count(one.id)}</span>
							</button>
						)}
					</For>
				</div>
				<label class="field dispatch-search">
					<input
						type="search"
						spellcheck={false}
						placeholder="Search boards"
						value={query()}
						onInput={(event) => setQuery(event.currentTarget.value)}
					/>
				</label>
			</div>
			<Show when={props.groups.length > 0} fallback={<p class="dispatch-empty">No boards yet.</p>}>
				<For each={props.groups}>
					{(group) => {
						const cards = createMemo(() => filterCards(group.cards, filter(), query()));
						// A shelf that a filter has emptied is not shown as an empty shelf:
						// the person asked for "changed", and a heading with nothing under it
						// is not an answer. A shelf with no filter on still shows, so a new
						// workspace with agents and no boards is visibly a shelf.
						const narrowed = () => filter() !== "all" || query().trim() !== "";
						return (
							<Show when={!narrowed() || cards().length > 0}>
								<section class="dispatch-shelf" data-folded={isFolded(group)}>
									<button type="button" class="dispatch-shelf-head" aria-expanded={!isFolded(group)} onClick={() => toggle(group)}>
										<span class="dispatch-shelf-name">{group.name}</span>
								<span class="dispatch-shelf-meta">
									<span class="dispatch-shelf-changed" data-any={group.changed > 0}>
										{group.changed} changed
									</span>
									<Show when={group.agents.length > 0}>
										{" · "}
										{group.agents.join(", ")}
									</Show>
								</span>
										<span class="flex-1" />
										<span class="dispatch-n">{cards().length}</span>
									</button>
									<Show when={!isFolded(group)}>
										<Show when={cards().length > 0} fallback={<p class="dispatch-empty">Nothing here yet.</p>}>
											<div class="dispatch-grid">
												<For each={cards()}>{(card) => <Card card={card} arrived={arrived().has(card.board.path)} onPreview={props.onPreview} onOpenAgent={props.onOpenAgent} onOpenTask={props.onOpenTask} />}</For>
											</div>
										</Show>
										<Show when={group.more > 0 && !narrowed()}>
											<p class="dispatch-more">{group.more} more</p>
										</Show>
									</Show>
								</section>
							</Show>
						);
					}}
				</For>
			</Show>
		</div>
	);
}

/**
 * One board on a shelf. Its own component so `picture` is read per card, not per shelf.
 *
 * A group rather than one button: the picture and the name open the preview, and two of the
 * chips are controls of their own ("by Kestrel" opens Kestrel, "from a task" shows the task),
 * and a button cannot hold a button.
 *
 * The mark is carried by four things, because one of them is not enough on a shelf of thirty
 * tiles: the accent spine on the picture, its accent frame and ring, the chip under the name,
 * and one pulse when the mark arrives while somebody is looking at the dashboard. `arrived`
 * comes from the gallery, which is the only place that can tell arriving from already there.
 */
function Card(props: { card: GalleryCard; arrived: boolean; onPreview: (path: string) => void; onOpenAgent: (id: string) => void; onOpenTask: (id: string) => void }) {
	return (
		<div class="dispatch-card" role="group" aria-label={props.card.board.title} data-changed={props.card.changed} data-arrived={props.arrived}>
			<button type="button" class="dispatch-card-open" onClick={() => props.onPreview(props.card.board.path)}>
				<span class="dispatch-card-pic">
					<BoardPicture
						board={props.card.board}
						waiting={<span class="dispatch-card-tile">{props.card.board.title}</span>}
						fallback={<span class="dispatch-card-tile">{props.card.board.title}</span>}
					/>
				</span>
				<span class="dispatch-card-name">{fileName(props.card.board.path)}</span>
			</button>
			<span class="dispatch-card-chips">
				<Show when={props.card.writtenBy}>
					<Show when={props.card.writerId} fallback={<span class="dispatch-chip" data-s={chipState(props.card)}>{chipText(props.card)}</span>}>
						{(id) => (
							<button type="button" class="dispatch-chip" data-s={chipState(props.card)} data-link title={`Open ${props.card.writtenBy}'s conversation`} onClick={() => props.onOpenAgent(id())}>
								{chipText(props.card)}
							</button>
						)}
					</Show>
				</Show>
				{/* A board with no byline still has news: a script or an outside editor wrote it. */}
				<Show when={props.card.changed && !props.card.writtenBy}>
					<span class="dispatch-chip" data-s="changed">changed {props.card.changedAgo}</span>
				</Show>
				<Show when={props.card.fromTask}>
					{(task) => (
						<button type="button" class="dispatch-chip" data-link title={task().text.split("\n")[0]} onClick={() => props.onOpenTask(task().id)}>
							from a task
						</button>
					)}
				</Show>
			</span>
		</div>
	);
}

/**
 * What the writer's chip says: "changed 45m · by Kestrel" when the board is news, "by Kestrel"
 * when it is not. One chip carries both facts, because a shelf has no room for a second one.
 */
function chipText(card: GalleryCard): string {
	if (!card.changed) return `by ${card.writtenBy}`;
	return `changed ${card.changedAgo} · by ${card.writtenBy}`;
}

/** The chip's state, which is what the stylesheet colours it by. `changed` leads when it is news. */
function chipState(card: GalleryCard): string {
	return card.changed ? "changed" : "plain";
}
