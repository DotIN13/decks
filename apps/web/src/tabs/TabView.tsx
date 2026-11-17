import { createComputed, createSignal, For, type JSX } from "solid-js";
import type { Parts } from "../app/parts.ts";
import { kindOf } from "./kinds.ts";
import { front } from "./tabs.ts";

/**
 * What fills the window: the tab in front, as its kind shows it.
 *
 * Each kind's view is made the first time a tab of that kind is in front, and kept: it is told which
 * tab of its kind is in front now, or none, and what it does while none is, is the kind's to say
 * (`TabKind.view`).
 */
export function TabView(props: { parts: Parts }): JSX.Element {
	const [used, setUsed] = createSignal<string[]>([]);
	createComputed(() => {
		const kind = front().kind;
		if (!used().includes(kind)) setUsed([...used(), kind]);
	});
	return <For each={used()}>{(name) => kindOf(name)?.view(() => (front().kind === name ? front() : undefined), props.parts)}</For>;
}
