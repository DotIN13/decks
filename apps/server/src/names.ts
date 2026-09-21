/**
 * The name a thing is given when nobody has named it: `Agent 1`, `Agent 2`, `Canvas 3`.
 *
 * Two problems, one answer. A deck used to fill with chats all called `Agent` — six of them
 * on this machine — and a *name* is how these things are addressed: an agent is reached by
 * `@name` from the bar, a canvas is joined by name from `stage.canvas("…")`. Two of anything
 * sharing a name is an ambiguity the app has to resolve by guessing.
 *
 * So a default name is the kind and **the first free number**, counting from one. Not a
 * random tail and not a running total: the number is small enough to say out loud, and it is
 * the lowest one nothing else is using, so a deck of three canvases has `Canvas 1`,
 * `Canvas 2`, `Canvas 3` however many have come and gone. Deleting the second one and making
 * another gives `Canvas 2` back, which is what a person counting the rooms in front of them
 * expects — a counter that only ever climbed would say `Canvas 9` to somebody who can see
 * three.
 *
 * Nothing about this stops a person or an agent naming something properly. It is the name a
 * thing wears until it has earned one, and it is unique from the moment it exists.
 */

/**
 * `base` plus the lowest number nothing else is using.
 *
 * `taken` is asked about every candidate, so the caller decides what "in use" means — a
 * canvas matches by slug, an agent by its name however it is capitalised.
 */
export function numberedName(base: string, taken: (name: string) => boolean): string {
	const stem = base.trim() || "Agent";
	for (let n = 1; ; n += 1) {
		const name = `${stem} ${n}`;
		if (!taken(name)) return name;
	}
}
