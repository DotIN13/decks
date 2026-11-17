import { createMemo, Show, type JSX } from "solid-js";
import type { Parts } from "../app/parts.ts";
import { kindOf } from "./kinds.ts";
import { front } from "./tabs.ts";

/**
 * What fills the window: the tab in front, as its kind shows it.
 *
 * Made anew when the kind in front changes, not when the tab does: two tabs of one kind share what
 * the kind made (`TabKind.view`).
 */
export function TabView(props: { parts: Parts }): JSX.Element {
	const kind = createMemo(() => kindOf(front().kind));
	return (
		<Show when={kind()} keyed>
			{(shown) => shown.view(front, props.parts)}
		</Show>
	);
}
