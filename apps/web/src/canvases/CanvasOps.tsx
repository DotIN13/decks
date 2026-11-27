import { m } from "@decks/i18n";
import X from "lucide-solid/icons/x";
import { For, Match, Show, Switch } from "solid-js";
import { Icon } from "@decks/ui";
import { canHover } from "../lib/media.ts";
import { tokens } from "@decks/canvas/page";

/**
 * Shortcuts: what you can do to the canvas, in one place you can open and close.
 *
 * Called "What you can do on the canvas" in the `⋯` menu and headed "On the canvas" inside,
 * which was a sentence where a name belonged — a menu row should name the thing it opens,
 * and a menu of six rows is not the place to explain one of them. The sentence is still
 * true; it is just what this file's first line is for.
 *
 * The same content spent a while as a line of grey text under the input bar, and then as a
 * tip rotating through the composer's placeholder. Both were wrong in the same way: they
 * put reference material where a person is *working*, so it was either permanently in the
 * way or arriving at a moment nobody asked. Reference belongs behind a button — absent
 * until wanted, complete when opened, and gone again on a click.
 *
 * **Grouped by what you are trying to do**, not by which key does it. Somebody opening this
 * has a goal ("how do I move a thing?") and not a keystroke, so the headings are the goals
 * and the gestures sit under them.
 *
 * Every row is checked against the code that implements it, in `@decks/canvas`: `view/input.ts`
 * and `PEN_TOOL_KEYS` for the camera and the tools, `edit/` for selection and editing,
 * `model/file-drop.ts` for the drop, `items/card-surface.tsx` for a card's own chrome,
 * `ink/CanvasInk.tsx` and `model/comment-text.ts` for reading a card. A cheat sheet
 * that lies is worse than none, so where the two disagree this file is the one that is
 * wrong.
 */
interface Group {
	title: string;
	rows: Array<{ keys: string; what: string }>;
}

/** With a cursor and a keyboard. */
function pointerGroups(): Group[] {
	return [
		{
			title: m.canvases_ops_moving_around(),
			rows: [
				{ keys: m.canvases_ops_two_finger_scroll(), what: m.canvases_ops_pan_the_canvas() },
				{ keys: m.canvases_ops_pinch_wheel(), what: m.canvases_ops_zoom_about_the_pointer() },
				{ keys: m.canvases_ops_space_drag(), what: m.canvases_ops_pan_from_anywhere_including_over() },
				{ keys: "+ · -", what: m.canvases_ops_zoom_about_the_centre() },
				{ keys: "0", what: m.canvases_ops_fit_everything_on_the_canvas() },
				{ keys: "1", what: m.canvases_ops_fit_the_selected_card() },
			],
		},
		{
			title: m.canvases_ops_reading_a_card(),
			rows: [
				{ keys: m.canvases_ops_select_words(), what: m.canvases_ops_comment_on_them_kept_in() },
				{ keys: m.canvases_ops_the_brush(), what: m.canvases_ops_draw_on_the_card_pen() },
				{ keys: "⌘Z · ⇧⌘Z", what: m.canvases_ops_undo_redo_a_stroke_while() },
				{ keys: "⌫", what: m.canvases_ops_delete_the_strokes_the_lasso() },
				{ keys: "Escape", what: m.canvases_ops_put_the_pen_down() },
			],
		},
		{
			title: m.canvases_ops_drawing(),
			rows: [
				{ keys: "V", what: m.canvases_ops_select_drag_and_resize() },
				{ keys: "R · O · F", what: m.canvases_ops_a_rectangle_an_ellipse_a() },
				{ keys: "N · C · T · A", what: m.canvases_ops_a_note_a_card_words() },
				{ keys: m.canvases_ops_drop_a_file_on_a(), what: m.canvases_ops_embed_it_where_it_landed() },
			],
		},
		{
			title: m.canvases_ops_changing_a_component(),
			rows: [
				{ keys: m.canvases_ops_click(), what: m.canvases_ops_select_it() },
				{ keys: m.canvases_ops_double_click(), what: m.canvases_ops_retype_its_words_in_place() },
				{ keys: m.canvases_ops_drag_drag_the_corner(), what: m.canvases_ops_move_it_resize_it() },
				{ keys: "arrows · shift-arrows", what: m.canvases_ops_nudge_nudge_by_ten() },
				{ keys: "⌘D", what: m.canvases_ops_duplicate_it() },
				{ keys: "[ · ]", what: m.canvases_ops_send_behind_bring_in_front() },
				{ keys: "⌫", what: m.canvases_ops_delete_it() },
				{ keys: "⌘Z", what: m.canvases_ops_undo_on_this_card() },
				{ keys: "Escape", what: m.canvases_ops_let_the_selection_go() },
			],
		},
		{
			title: m.canvases_ops_cards_and_the_conversation(),
			rows: [
				{ keys: m.canvases_ops_drag_a_card_s_title(), what: m.canvases_ops_move_the_card() },
				{ keys: m.canvases_ops_the_card_s(), what: m.canvases_ops_take_it_off_the_canvas() },
				{ keys: m.canvases_ops_the_panel_buttons(), what: m.canvases_ops_the_agents_the_cards_they() },
				{ keys: m.canvases_ops_the_grid_button(), what: m.canvases_ops_every_card_in_the_deck() },
				{ keys: m.canvases_ops_the_speech_bubble_button(), what: m.canvases_ops_the_conversation_opened_and_closed() },
				{ keys: m.canvases_ops_click_a_turn_on_the(), what: m.canvases_ops_the_conversation_at_that_turn() },
				{ keys: "/", what: m.canvases_ops_commands_in_the_input_bar() },
				{ keys: m.canvases_ops_name(), what: m.canvases_ops_send_the_line_to_that() },
			],
		},
	];
}

/** With a finger. A phone has no wheel, no space bar and no keys to fit with. */
function touchGroups(): Group[] {
	return [
		{
			title: m.canvases_ops_moving_around(),
			rows: [
				{ keys: m.canvases_ops_drag(), what: m.canvases_ops_pan_the_canvas() },
				{ keys: m.canvases_ops_pinch(), what: m.canvases_ops_zoom_about_the_fingers() },
				{ keys: m.canvases_ops_drag_inside_an_embed(), what: m.canvases_ops_scrolls_the_embed_not_the() },
			],
		},
		{
			title: m.canvases_ops_reading_a_card(),
			rows: [
				{ keys: m.canvases_ops_select_words(), what: m.canvases_ops_comment_on_them_kept_in() },
				{ keys: m.canvases_ops_the_brush(), what: m.canvases_ops_draw_on_the_card_pen() },
				{ keys: m.canvases_ops_a_pencil(), what: m.canvases_ops_draws_with_its_pressure_and() },
				{ keys: m.canvases_ops_two_fingers(), what: m.canvases_ops_always_the_canvas_even_while() },
			],
		},
		{
			title: m.canvases_ops_changing_a_component(),
			rows: [
				{ keys: m.canvases_ops_tap(), what: m.canvases_ops_select_it() },
				{ keys: m.canvases_ops_tap_again(), what: m.canvases_ops_retype_its_words_in_place() },
				{ keys: m.canvases_ops_drag_a_selected_component(), what: m.canvases_ops_move_it() },
				{ keys: m.canvases_ops_the_properties_sheet(), what: m.canvases_ops_kind_tone_order_duplicate_delete() },
			],
		},
		{
			title: m.canvases_ops_drawing(),
			rows: [
				{ keys: m.canvases_ops_pick_a_tool_then_tap(), what: m.canvases_ops_place_a_sticky_card_text() },
				{ keys: m.canvases_ops_from_this_device_in_the(), what: m.canvases_ops_add_a_photo_or_a() },
			],
		},
		{
			title: m.canvases_ops_cards_and_the_conversation(),
			rows: [
				{ keys: m.canvases_ops_drag_a_card_s_title(), what: m.canvases_ops_move_the_card() },
				{ keys: m.canvases_ops_swipe_in_from_the_left(), what: m.canvases_ops_the_cards_and_agents_rail() },
				{ keys: m.canvases_ops_swipe_in_from_the_right(), what: m.canvases_ops_the_conversation() },
				{ keys: m.canvases_ops_swipe_the_conversation_right(), what: m.canvases_ops_put_it_away() },
				{ keys: m.canvases_ops_the_two_title_bar_buttons(), what: m.canvases_ops_the_same_two_panels_either() },
				{ keys: "/", what: m.canvases_ops_commands_in_the_input_bar() },
				{ keys: m.canvases_ops_name(), what: m.canvases_ops_send_the_line_to_that() },
			],
		},
	];
}

export function CanvasOps(props: { onClose: () => void }) {
	const groups = () => (canHover() ? pointerGroups() : touchGroups());

	return (
		<div
			class="picker-backdrop"
			onPointerDown={(event) => {
				// The same rule the file picker documents: a press that *begins* on the
				// backdrop, so a ghost click from the tap that opened this cannot close it.
				if (event.target === event.currentTarget) props.onClose();
			}}
		>
			{/*
				`ops` stays as a class for one reason: the single-column fallback below 560px is a
				media query, and the rest of the sheet is ordinary layout that reads better as
				utilities than as a stylesheet nobody needs to look up.

				Opaque, unlike the panels whose class it borrows: this is two dense columns of
				small text and there is nothing behind it worth reading through it.
			*/}
			<div
				class="panel-float ops-sheet flex max-h-[78%] w-[min(560px,calc(100vw-24px))] static flex-col overflow-hidden bg-bg p-0"
				role="dialog"
				aria-label={m.canvases_ops_shortcuts()}
			>
				<header class="label flex items-center gap-2 border-b border-line py-2 pr-2.5 pl-3">
					<span>{m.canvases_ops_shortcuts()}</span>
					<span class="flex-1" />
					{/* `.icon-button`: `icon-button` is a class the rewrite replaced and nothing defines,
					    so this × was a bare button with no target and no hover. */}
					<button class="icon-button [--control:24px]" type="button" title={m.canvases_close()} aria-label={m.canvases_close()} onClick={props.onClose}>
						<Icon of={X} size={15} />
					</button>
				</header>

				<div class="flex flex-col gap-3.5 overflow-y-auto overscroll-contain px-3 pt-2.5 pb-3">
					<For each={groups()}>
						{(group) => (
							<section>
								<h3 class="mt-0 mb-[5px] text-ui font-semibold text-fg">{group.title}</h3>
								<For each={group.rows}>
									{(row) => (
										<div
											class="row grid grid-cols-[minmax(0,13em)_minmax(0,1fr)] gap-2.5 py-0.5 text-ui leading-[1.5]"
										>
											<span class="flex flex-wrap items-center gap-1">
												<For each={tokens(row.keys)}>
													{(token) => (
														<Switch>
															{/*
																A keycap: bordered, raised a hair off the panel by one
																line of shadow, and never narrower than it is tall — so
																`0` and `⌘D` read as the same family of object rather
																than a square and a rectangle.
															*/}
															<Match when={"cap" in token && token.cap}>
																{(cap) => (
																	<kbd class="inline-grid min-w-[1.7em] place-items-center rounded-[5px] border border-[var(--line-strong)] bg-bg-deep px-1.5 py-px font-mono text-note leading-[1.5] text-fg shadow-[0_1px_0_var(--line-strong)]">
																		{cap()}
																	</kbd>
																)}
															</Match>
															{/* "either of these": the dot is the renderer's, not the data's. */}
															<Match when={"or" in token}>
																<span class="px-px text-faint">·</span>
															</Match>
															<Match when={"word" in token && token.word}>
																{(word) => <span class="text-muted">{word()}</span>}
															</Match>
														</Switch>
													)}
												</For>
											</span>
											<span class="text-muted">{row.what}</span>
										</div>
									)}
								</For>
							</section>
						)}
					</For>
				</div>

				{/* Said once, at the bottom, because it is the rule behind half the rows above:
				    below `LIVE_ZOOM` a card is its picture, except the selected one, whose page works. */}
				<Show when={canHover()}>
					<footer class="border-t border-line px-3 py-[9px] text-note leading-normal text-faint">
						{m.canvases_ops_footer()}
					</footer>
				</Show>
			</div>
		</div>
	);
}
