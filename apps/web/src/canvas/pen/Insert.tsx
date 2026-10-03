import { SHAPE_GROUPS, SHAPES } from "@decks/pen";
import Search from "lucide-solid/icons/search";
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { isPhone } from "../../camera/camera.ts";
import { penIcon, penShape, setPenIcon, setPenShape, type InsertPanel } from "../../state/pen-tools.ts";
import { Icon } from "../../ui/icons.tsx";
import { iconsOf, ICON_LIBRARIES, noteRecentIcon, recentIcons, searchIcons } from "./icon-index.ts";
import { iconUrl } from "./icons.ts";

/**
 * The insert panel: the shape library, or the icons — two panels, one for each button in the tool
 * column, each with its own search. No tabs between them and no close button: it closes with a
 * pick, a press anywhere else, Escape, or its button pressed again.
 *
 * Opened from the tool column it sits beside the column, and a pick arms the shape or icon tool:
 * the next click on the canvas makes one, at its own size, and a drag makes one the size dragged.
 * Opened from the canvas menu it sits where the menu was, and a pick is put there at once. Either
 * way the shape or icon picked stays the tool's until another is picked.
 *
 * Shapes are drawn here from the same outlines the canvas draws (`@decks/pen`, `SHAPES`). Icons
 * are the libraries' own SVG files, shown as pictures; their names come from each library's list
 * (`icon-index.ts`).
 */

/** What the icons tab shows for Lucide before anything is typed: the ones a diagram reaches for. */
const LUCIDE_START = [
	"circle-check", "triangle-alert", "info", "star", "heart", "user", "users", "mail", "phone", "calendar", "clock", "map-pin",
	"house", "building-2", "database", "server", "cloud", "cpu", "laptop", "smartphone", "wifi", "lock", "key-round", "shield",
	"settings", "search", "file", "folder", "image", "camera", "music", "video", "chart-column", "chart-pie", "trending-up", "dollar-sign",
	"shopping-cart", "credit-card", "truck", "package", "rocket", "lightbulb", "zap", "flag", "bell", "message-square", "link", "globe",
	"code-xml", "git-branch", "bot", "sparkles", "thumbs-up", "check", "x", "plus", "arrow-right", "refresh-cw", "download", "upload",
];

export function Insert(props: { open: InsertPanel; onPick: (tool: "shape" | "icon") => void; onClose: () => void }) {
	const [query, setQuery] = createSignal("");
	const [library, setLibrary] = createSignal(penIcon().library);
	let panel: HTMLDivElement | undefined;

	// Another panel, another search. The field is not focused: a panel opened to pick from is not a
	// request to type, and a focused field would take the keys the canvas's shortcuts use.
	createEffect(() => {
		props.open.tab;
		setQuery("");
	});

	const shapes = createMemo(() => {
		const q = query().trim().toLowerCase();
		return SHAPE_GROUPS.map((group) => ({ group, list: SHAPES.filter((shape) => shape.group === group && (!q || shape.name.toLowerCase().includes(q))) })).filter((one) => one.list.length > 0);
	});

	const [icons] = createResource(
		() => (props.open.tab === "icons" ? library() : undefined),
		(id) => iconsOf(id),
	);
	const found = createMemo(() => {
		const list = icons() ?? [];
		const q = query().trim();
		if (q) return searchIcons(list, q);
		if (library() === "lucide") {
			const names = new Set(list.map((one) => one.name));
			return LUCIDE_START.filter((name) => names.size === 0 || names.has(name)).map((name) => ({ name, tags: [] }));
		}
		return list.slice(0, 84);
	});
	const recent = createMemo(() => (query().trim() ? [] : recentIcons().filter((one) => one.library === library()).slice(0, 14)));

	const pickShape = (name: string) => {
		setPenShape(name);
		props.onPick("shape");
	};
	const pickIcon = (name: string) => {
		const pick = { library: library(), name };
		setPenIcon(pick);
		noteRecentIcon(pick);
		props.onPick("icon");
	};

	/*
	 * Where it sits: beside the tool column, or where the canvas menu was opened, kept on screen. On a
	 * phone it is a sheet along the bottom, as the properties panel is.
	 */
	const [place, setPlace] = createSignal<{ left: number; top: number }>({ left: 64, top: 80 });
	const position = () => {
		const width = 288;
		const height = panel?.offsetHeight ?? 460;
		if (props.open.client) {
			const left = Math.max(8, Math.min(props.open.client.x - 20, window.innerWidth - width - 8));
			const top = Math.max(8, Math.min(props.open.client.y + 12, window.innerHeight - height - 8));
			return setPlace({ left, top });
		}
		const tools = document.querySelector(".pen-tools")?.getBoundingClientRect();
		const left = tools ? tools.right + 8 : 64;
		const top = Math.max(8, Math.min(tools ? tools.top : 80, window.innerHeight - height - 8));
		setPlace({ left, top });
	};
	onMount(() => {
		position();
		requestAnimationFrame(position);
		window.addEventListener("resize", position);
		const away = (event: PointerEvent) => {
			const target = event.target as Element | null;
			if (panel?.contains(target) || target?.closest?.("[data-insert-button]")) return;
			props.onClose();
		};
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") props.onClose();
		};
		window.addEventListener("pointerdown", away, true);
		window.addEventListener("keydown", key);
		onCleanup(() => {
			window.removeEventListener("resize", position);
			window.removeEventListener("pointerdown", away, true);
			window.removeEventListener("keydown", key);
		});
	});

	return (
		<div
			ref={panel}
			class="panel-float float insert-panel"
			data-sheet={isPhone() ? "true" : undefined}
			role="dialog"
			aria-label={props.open.tab === "shapes" ? "Shapes" : "Icons"}
			style={isPhone() ? undefined : { left: `${place().left}px`, top: `${place().top}px` }}
		>
			<label class="field insert-search">
				<Icon of={Search} size={13} class="flex-none text-faint" />
				<input
					type="text"
					autocomplete="off"
					spellcheck={false}
					placeholder={props.open.tab === "shapes" ? "Search shapes" : "Search icons"}
					value={query()}
					onInput={(event) => setQuery(event.currentTarget.value)}
					data-insert-search
				/>
			</label>
			<Show when={props.open.tab === "icons"}>
				<div class="insert-libs" role="group" aria-label="Library">
					<For each={ICON_LIBRARIES}>
						{(lib) => (
							<button type="button" class="chip-button" data-on={library() === lib.id ? "soft" : undefined} aria-pressed={library() === lib.id} onClick={() => setLibrary(lib.id)}>
								{lib.label}
							</button>
						)}
					</For>
				</div>
			</Show>
			<div class="insert-body">
				<Show
					when={props.open.tab === "shapes"}
					fallback={
						<>
							<Show when={recent().length > 0}>
								<p class="insert-group">Used lately</p>
								<div class="insert-grid icons">
									<For each={recent()}>{(one) => <IconCell library={one.library} name={one.name} picked={penIcon().library === one.library && penIcon().name === one.name} onPick={pickIcon} />}</For>
								</div>
							</Show>
							<Show
								when={!icons.error}
								fallback={<p class="insert-note">The icon list could not be fetched. Icons come from the internet; already drawn ones stay drawn.</p>}
							>
								<Show when={!icons.loading} fallback={<p class="insert-note">Fetching the list of icons…</p>}>
									<p class="insert-group">{query().trim() ? `${found().length === 120 ? "120+" : found().length} found` : recent().length ? "More" : "Icons"}</p>
									<div class="insert-grid icons">
										<For each={found()}>{(one) => <IconCell library={library()} name={one.name} picked={penIcon().library === library() && penIcon().name === one.name} onPick={pickIcon} />}</For>
									</div>
									<Show when={query().trim() && found().length === 0}>
										<p class="insert-note">No icon is called that.</p>
									</Show>
								</Show>
							</Show>
						</>
					}
				>
					<For each={shapes()}>
						{(section) => (
							<>
								<p class="insert-group">{section.group}</p>
								<div class="insert-grid">
									<For each={section.list}>
										{(shape) => (
											<button type="button" class="insert-cell" data-shape={shape.name} data-on={penShape() === shape.name ? "true" : undefined} title={shape.name} aria-label={shape.name} onClick={() => pickShape(shape.name)}>
												<svg viewBox="-4 -4 108 108" preserveAspectRatio="none" aria-hidden="true">
													<path d={shape.geometry} fill-rule={shape.fillRule ?? "nonzero"} data-line={shape.line ? "true" : undefined} />
												</svg>
											</button>
										)}
									</For>
								</div>
							</>
						)}
					</For>
					<Show when={shapes().length === 0}>
						<p class="insert-note">No shape is called that.</p>
					</Show>
				</Show>
			</div>
			<p class="insert-note">{props.open.replace ? "Pick one to put in the selected icon's place." : props.open.at ? "Pick one to put it where you double-clicked." : "Pick one, then click or drag on the canvas."}</p>
		</div>
	);
}

function IconCell(props: { library: string; name: string; picked: boolean; onPick: (name: string) => void }) {
	const src = () => iconUrl(props.library, props.name, 400);
	return (
		<button type="button" class="insert-cell" data-icon={props.name} data-on={props.picked ? "true" : undefined} title={props.name} aria-label={props.name} onClick={() => props.onPick(props.name)}>
			<Show when={src()}>{(url) => <img src={url()} alt="" loading="lazy" decoding="async" draggable={false} />}</Show>
		</button>
	);
}
