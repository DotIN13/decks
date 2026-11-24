import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { m } from "@decks/i18n";
import { COARSE } from "../edit/core/touch-rules.ts";
import { setPropsOpen } from "../edit/pen-tools.ts";
import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import { canvasHost, openAppTab, openInTab } from "../base/host.ts";
import { Icon } from "@decks/ui";
import Copy from "lucide-solid/icons/copy";
import ExternalLink from "lucide-solid/icons/external-link";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import Trash from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import MessageSquarePlus from "lucide-solid/icons/message-square-plus";
import Scan from "lucide-solid/icons/scan";
import Shapes from "lucide-solid/icons/shapes";
import LayoutTemplate from "lucide-solid/icons/layout-template";
import Send from "lucide-solid/icons/send";
import Ellipsis from "lucide-solid/icons/ellipsis";
import ImageDown from "lucide-solid/icons/image-down";
import FileDown from "lucide-solid/icons/file-down";
import Link from "lucide-solid/icons/link";
import { createCalloutSide } from "./callout-side.ts";
import type { Page } from "@decks/protocol";
import type { PageCalloutProps } from "./callout-props.ts";
import { createCalloutMenu } from "./callout-menu.ts";


/**
 * The pill's New tab. The host opens the item whole in a tab of its own when it has them (`CanvasHost.openItem`),
 * told what it is, and whether ⌘ or ⌃ was held, which asks for the browser's tab; with no such host it is the
 * browser's tab on the item's own file or page, as it always was.
 */
function newTab(board: Page, browser: boolean): void {
	const host = canvasHost();
	if (board.item === "app" && board.app) return openAppTab(board.app, browser);
	if (host.openItem) return host.openItem({ ...(board.item === "document" ? { kind: "document", target: board.file ?? board.path } : { kind: "card", target: board.path }), ...(browser ? { browser: true } : {}) });
	openInTab(host.fileUrl(board.path));
}

/** What selected ink can be handed to the agent for, first on its pill and in words: a drawing of it, a card of it, or the ink itself to read and act on. */
function InkActions(props: { ink: NonNullable<PageCalloutProps["ink"]> }) {
	return (
		<>
			<button type="button" role="menuitem" class="callout-word" title={m.canvas_pill_ink_drawing_title({ agent: props.ink.agent })} onClick={() => props.ink.onDrawing()}>
				<Icon of={Shapes} size={15} />
				{m.canvas_pill_ink_drawing()}
			</button>
			<button type="button" role="menuitem" class="callout-word" title={m.canvas_pill_ink_card_title({ agent: props.ink.agent })} onClick={() => props.ink.onCard()}>
				<Icon of={LayoutTemplate} size={15} />
				{m.canvas_pill_ink_card()}
			</button>
			<button type="button" role="menuitem" class="callout-word callout-ask" title={m.canvas_pill_ink_send_title({ agent: props.ink.agent })} onClick={() => props.ink.onSend()}>
				<Icon of={Send} size={15} />
				{m.canvas_pill_ink_send({ agent: props.ink.agent })}
			</button>
			<span class="callout-rule" aria-hidden="true" />
		</>
	);
}

/**
 * A board's title bar, now that boards have none: a small pill over the selected board, as a phone
 * shows over selected text, on every device. Selecting a board — a click or a tap on it — shows it:
 * the actions the bar had, with the bar's own icons, on the comment popup's card, so it follows the theme. It sits over the board's top
 * edge or under its bottom one, never on the board, taking the one clear of other boards and items
 * and on the screen, and stays there as the camera moves (hidden while it does).
 *
 * The same pill sits over drawn items — a shape, a card, a frame, or several — with what makes sense
 * for them: zoom to it, comment, duplicate, properties and delete. Without `board`, the board's own
 * actions (a new tab, hide) are not offered. A card's pill is Fit, New tab, Comment, ✕ (hide)
 * and ⋯, a menu of Export as PNG or PDF, Copy path and Delete; drawn items' and a group's end in ⋯ too.
 * An app's has Reload after New tab, its ✕ closes its window, and its ⋯ has no Delete: an app is
 * deleted in the Apps tab.
 */
export function PageCallout(props: PageCalloutProps) {
	/* The menu's own width, measured, so it is kept on the screen whole and its arrow still points at the board. */
	const [width, setWidth] = createSignal(0);
	let element: HTMLDivElement | undefined;
	onMount(() => {
		if (!element) return;
		const observer = new ResizeObserver(() => {
			setWidth(element?.offsetWidth ?? 0);
			setTall(element?.offsetHeight || 40);
		});
		observer.observe(element);
		onCleanup(() => observer.disconnect());
	});
	const { setTall, place } = createCalloutSide({
		props,
		width,
		get element() { return element; },
	});
	const stop = (event: Event) => event.stopPropagation();
	const calloutMenu = createCalloutMenu({
		get element() { return element; },
		props,
	});
	const { more, setMore, placeMenu, menuAt, pick } = calloutMenu;
	/** A card's pill, or drawn items' and a group's that can be exported: a ⋯ menu in place of the Delete button. The lasso's has none. */
	const withMenu = () => !!props.board || !!props.onExport;
	const remove = () => props.onDelete;
	return (
		<div
			ref={element}
			class="card-callout"
			role="menu"
			aria-label={props.label}
			data-below={place().below ? "true" : undefined}
			data-hidden={props.hidden ? "true" : undefined}
			style={{ left: `${place().x}px`, top: `${place().y}px`, ...(place().arrow !== undefined ? { "--arrow": `${place().arrow}px` } : {}) }}
			onPointerDown={stop}
			onClick={stop}
		>
			<Show when={props.ink}>{(ink) => <InkActions ink={ink()} />}</Show>
			<button type="button" role="menuitem" class="icon-button" aria-label={props.board ? m.canvas_pill_fit() : m.canvas_pill_zoom_to()} title={props.board ? m.canvas_pill_fit_title() : m.canvas_pill_zoom_to()} onClick={() => props.onOpen()}>
				<Icon of={Scan} size={16} />
			</button>
			<Show when={props.board}>
				{(board) => (
				<a role="menuitem" class="icon-button" aria-label={m.canvas_pill_new_tab()} title={m.canvas_pill_new_tab_title()} href={board().item === "app" && board().app ? "#" : canvasHost().fileUrl(board().path)} target="_blank" rel="noopener" onClick={(event) => { event.preventDefault(); newTab(board(), event.metaKey || event.ctrlKey); }}>
					<Icon of={ExternalLink} size={16} />
				</a>
				)}
			</Show>
			<Show when={props.onReload}>
				<button type="button" role="menuitem" class="icon-button" aria-label={m.canvas_pill_reload()} title={m.canvas_pill_reload_title()} onClick={() => props.onReload?.()}>
					<Icon of={RefreshCw} size={16} />
				</button>
			</Show>
			{/* On a touch screen the properties drawer opens from here, not with every selection (`Properties.tsx`). */}
			<Show when={COARSE && !props.board && !props.ink}>
				<button type="button" role="menuitem" class="icon-button" aria-label={m.canvas_props_panel()} title={m.canvas_props_panel()} onClick={() => setPropsOpen(true)}>
					<Icon of={SlidersHorizontal} size={16} />
				</button>
			</Show>
			<Show when={props.onComment}>
				<button type="button" role="menuitem" class="icon-button" aria-label={m.canvas_pill_comment()} title={props.board ? m.canvas_pill_comment_card() : m.canvas_pill_comment_this()} onClick={() => props.onComment?.()}>
					<Icon of={MessageSquarePlus} size={16} />
				</button>
			</Show>
			<Show when={props.onDuplicate}>
				<button type="button" role="menuitem" class="icon-button" aria-label={m.canvas_pill_duplicate()} title={m.canvas_pill_duplicate()} onClick={() => props.onDuplicate?.()}>
					<Icon of={Copy} size={16} />
				</button>
			</Show>
			<Show
				when={withMenu()}
				fallback={
					<>
						<Show when={props.onDelete}>
							<span class="callout-rule" aria-hidden="true" />
							<button type="button" role="menuitem" class="icon-button callout-danger" aria-label={m.canvas_pill_delete()} title={m.canvas_pill_delete()} onClick={() => props.onDelete?.()}>
								<Icon of={Trash} size={16} />
							</button>
						</Show>
						<Show when={props.onHide}>
							<span class="callout-rule" aria-hidden="true" />
							<button type="button" role="menuitem" class="icon-button" aria-label={m.canvas_pill_hide()} title={props.board?.item === "app" ? m.canvas_pill_hide_app() : m.canvas_pill_hide_title()} onClick={() => props.onHide?.()}>
								<Icon of={X} size={17} />
							</button>
						</Show>
					</>
				}
			>
				{/* A card's pill: Fit, New tab, Comment, ✕ to hide it and ⋯ for the rest; drawn items' and a group's: their actions and ⋯. */}
				<Show when={props.board && props.onHide}>
					<button type="button" role="menuitem" class="icon-button" aria-label={m.canvas_pill_hide()} title={props.board?.item === "app" ? m.canvas_pill_hide_app() : m.canvas_pill_hide_title()} onClick={() => props.onHide?.()}>
						<Icon of={X} size={17} />
					</button>
				</Show>
				<span class="callout-rule" aria-hidden="true" />
				<button ref={(el) => (calloutMenu.moreButton = el)} type="button" role="menuitem" class="icon-button" aria-label={m.canvas_pill_more()} title={m.canvas_pill_more()} aria-haspopup="menu" aria-expanded={more()} data-on={more() ? "true" : undefined} onClick={() => setMore((open) => !open)}>
					<Icon of={Ellipsis} size={17} />
				</button>
				<Show when={more()}>
					<div
						ref={(menu) => requestAnimationFrame(() => placeMenu(menu))}
						class="callout-more"
						role="menu"
						aria-label={props.board ? m.canvas_pill_more_card() : m.canvas_pill_more_actions()}
						style={menuAt() ? { left: `${menuAt()!.left}px` } : { visibility: "hidden", left: "0" }}
					>
						<Show when={props.onRefresh}>
							<button type="button" role="menuitem" class="callout-more-item" aria-label={m.canvas_pill_refresh()} title={m.canvas_pill_refresh_title()} onClick={pick(props.onRefresh)}>
								<Icon of={RefreshCw} size={15} />
								{m.canvas_pill_refresh()}
							</button>
						</Show>
						<Show when={props.onExport}>
							<button type="button" role="menuitem" class="callout-more-item" aria-label={m.canvas_pill_export_png()} onClick={pick(() => props.onExport?.("png"))}>
								<Icon of={ImageDown} size={15} />
								{m.canvas_pill_export_png()}
							</button>
							<button type="button" role="menuitem" class="callout-more-item" aria-label={m.canvas_pill_export_pdf()} onClick={pick(() => props.onExport?.("pdf"))}>
								<Icon of={FileDown} size={15} />
								{m.canvas_pill_export_pdf()}
							</button>
						</Show>
						<Show when={props.onCopyPath}>
							<button type="button" role="menuitem" class="callout-more-item" aria-label={m.canvas_pill_copy_path()} onClick={pick(props.onCopyPath)}>
								<Icon of={Link} size={15} />
								{m.canvas_pill_copy_path()}
							</button>
						</Show>
						<Show when={remove()}>
							<span class="callout-more-rule" aria-hidden="true" />
							<button type="button" role="menuitem" class="callout-more-item callout-more-danger" aria-label={m.canvas_pill_delete()} title={props.board?.item === "document" ? m.canvas_pill_delete_document() : props.board ? m.canvas_pill_delete_card() : m.canvas_pill_delete()} onClick={pick(remove())}>
								<Icon of={Trash} size={15} />
								{m.canvas_pill_delete()}
							</button>
						</Show>
					</div>
				</Show>
			</Show>
		</div>
	);
}
