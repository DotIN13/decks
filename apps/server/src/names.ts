/**
 * The name a thing is given when nobody has named it: `Agent 1`, `Agent 2`.
 *
 * Two problems, one answer. A deck used to fill with chats all called `Agent` — six of them
 * on this machine — and a *name* is how an agent is addressed: `@name` from the bar, and
 * `stage.send(name)`. Two sharing a name is an ambiguity the app has to resolve by guessing.
 *
 * So a default name is the kind and **the first free number**, counting from one. Not a
 * random tail and not a running total: the number is small enough to say out loud, and it is
 * the lowest one nothing else is using, so a deck of three agents has `Agent 1`, `Agent 2`,
 * `Agent 3` however many have come and gone. Closing the second one and making another gives
 * `Agent 2` back, which is what a person counting the rows in front of them expects — a counter
 * that only ever climbed would say `Agent 9` to somebody who can see three.
 *
 * Nothing about this stops a person or an agent naming something properly. It is the name a
 * thing wears until it has earned one, and it is unique from the moment it exists.
 */

/**
 * `base` plus the lowest number nothing else is using.
 *
 * `taken` is asked about every candidate, so the caller decides what "in use" means — an
 * agent's name matches however it is capitalised.
 */
export function numberedName(base: string, taken: (name: string) => boolean): string {
	const stem = base.trim() || "Agent";
	for (let n = 1; ; n += 1) {
		const name = `${stem} ${n}`;
		if (!taken(name)) return name;
	}
}
