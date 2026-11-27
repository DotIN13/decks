import ArrowUp from "lucide-solid/icons/arrow-up";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Pencil from "lucide-solid/icons/pencil";
import X from "lucide-solid/icons/x";
import { createSignal, For, Show } from "solid-js";
import { Icon } from "@decks/ui";
import { m } from "@decks/i18n";

/**
 * What you queued with Ctrl+Enter, on top of the composer's box: sent one per turn as each ends.
 *
 * Mounted with the composer and drawn only while something is queued, so whether it is folded
 * outlasts a queue that empties and fills again.
 */
export function QueueCard(props: {
	/** What is queued for this agent, oldest first, and whether Stop is holding it. */
	queued?: { items: Array<{ id: string; text: string }>; held: boolean };
	/** A queued row's buttons: take it off, send it now as a steer, or send a held queue. */
	onQueueAction?: (action: "remove" | "send" | "release", item?: string) => void;
	/** Who the lines go to, for the head. */
	recipientName: string;
	/** A row's pencil: its words go back into the field to be edited (the row is taken off first). */
	onEdit: (text: string) => void;
}) {
	/** The card folded to its head, which then names the next line. */
	const [folded, setFolded] = createSignal(false);
	return (
		<Show when={props.queued?.items.length ? props.queued : undefined}>
			{(queued) => (
				<div class="composer-queue" role="list" aria-label={m.composer_queue_label()} data-folded={folded() ? "true" : undefined}>
					<div class="composer-queue-head">
						<button type="button" class="v3-icon composer-queue-fold" aria-expanded={!folded()} title={folded() ? m.composer_queue_show() : m.composer_queue_fold()} aria-label={folded() ? m.composer_queue_show() : m.composer_queue_fold()} onClick={() => setFolded(!folded())}>
							<Icon of={folded() ? ChevronRight : ChevronDown} size={14} />
						</button>
						<span class="composer-queue-title">{m.composer_queue_title({ count: queued().items.length, name: props.recipientName })}</span>
						<span class="composer-queue-note truncate">{queued().held ? m.composer_queue_held() : folded() ? m.composer_queue_next({ text: queued().items[0]?.text ?? "" }) : m.composer_queue_one_per_turn()}</span>
						<span class="flex-1" />
						<button
							type="button"
							class="composer-queue-release"
							title={queued().held ? m.composer_queue_release_held() : m.composer_queue_release_all()}
							onClick={() => {
								if (queued().held) return props.onQueueAction?.("release");
								for (const item of queued().items) props.onQueueAction?.("send", item.id);
							}}
						>
							{m.composer_queue_send_all()}
						</button>
					</div>
					{/* Folded by its height, so the rows slide shut rather than vanish (`styles/v3.css`). */}
					<div class="composer-queue-body" aria-hidden={folded()}>
						<div>
							<For each={queued().items}>
								{(item, index) => (
									<div class="composer-queue-row" role="listitem" data-item={item.id}>
										<span class="composer-queue-n">{index() + 1}</span>
										<span class="composer-queue-text" title={item.text}>
											{item.text}
										</span>
										<button
											type="button"
											class="icon-button"
											aria-label={m.composer_queue_edit()}
											title={m.composer_queue_edit_title()}
											onClick={() => {
												props.onQueueAction?.("remove", item.id);
												props.onEdit(item.text);
											}}
										>
											<Icon of={Pencil} size={14} />
										</button>
										<button type="button" class="icon-button" aria-label={m.composer_queue_send_now()} title={m.composer_queue_send_now_title()} onClick={() => props.onQueueAction?.("send", item.id)}>
											<Icon of={ArrowUp} size={14} />
										</button>
										<button type="button" class="icon-button" aria-label={m.composer_queue_remove()} title={m.composer_queue_remove()} onClick={() => props.onQueueAction?.("remove", item.id)}>
											<Icon of={X} size={14} />
										</button>
									</div>
								)}
							</For>
						</div>
					</div>
				</div>
			)}
		</Show>
	);
}
