import { createSignal, type JSX } from "solid-js";

/** Which sections stay open, for the page's life: a section shut stays shut from one selection to the next. */
const [shut, setShut] = createSignal<ReadonlySet<string>>(new Set(["effects"]));
const toggle = (key: string, open: boolean) =>
	setShut((was) => {
		const next = new Set(was);
		if (open) next.delete(key);
		else next.add(key);
		return next;
	});
/** One section of the panel, which folds. */
export const Section = (p: { key: string; title: string; children: JSX.Element }) => (
	<details class="props-sec" open={!shut().has(p.key)} onToggle={(event) => toggle(p.key, event.currentTarget.open)} data-section={p.key}>
		<summary>{p.title}</summary>
		<div class="props-sec-body">{p.children}</div>
	</details>
);
