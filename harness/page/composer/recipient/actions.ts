import type { AgentKind } from "@decks/protocol";

// What the recipient chip's menu does: the shell's own callbacks, named for its rows.

/** What picking in the chip's menu does: the shell's own callbacks, named for the menu's rows. */
export function menuActions(props: { onPick: (id: string) => void; onNew: (kind: AgentKind) => void; onClose: (id: string) => void; onMore?: () => void }) {
	return { onFocus: props.onPick, onNew: props.onNew, onClose: props.onClose, ...(props.onMore ? { onMore: props.onMore } : {}) };
}
