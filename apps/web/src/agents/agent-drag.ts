/**
 * Dragging an agent from one workspace heading to another, in the panel's Agents tab.
 *
 * The workspace was already both writers' field — the agent writes it with `stage.me({ workspace })`
 * and you with the row's edit window — so this adds no state and no message: a drop is the same
 * call the window makes, with the heading it landed under as the value. What it adds is the
 * gesture, which is the one a list of things filed under headings invites.
 *
 * Native HTML5 drag and drop, not the pointer machinery the canvas uses, because this is a list
 * of DOM rows and the browser already draws the ghost, the cursor and the drop effect for one.
 *
 * The id travels in a **type of our own**. A drop target may not read a drag's data until the
 * drop itself — `dragover` is only told the *types* — so the type is what says "this is one of
 * ours, and it is allowed here", and the id inside it is read once, at the end.
 */

/** The flavour an agent row puts on the drag. Lower case: the browser lower-cases every type. */
export const AGENT_MIME = "application/x-decks-agent";

/** Whether a drag in flight is an agent row of ours — answerable during `dragover`, unlike its data. */
export function carriesAgent(data: DataTransfer | null | undefined): boolean {
	return Boolean(data && Array.from(data.types).includes(AGENT_MIME));
}

/** The agent's id at the end of the drag, or nothing when the drop was something else. */
export function draggedAgent(data: DataTransfer | null | undefined): string | undefined {
	if (!carriesAgent(data)) return undefined;
	const id = data!.getData(AGENT_MIME).trim();
	return id || undefined;
}

/**
 * Put an agent on a drag, and a plain-text name beside it.
 *
 * The name is there so the drag means something outside this list: dropped in the composer or in
 * another app it reads as the agent's name rather than as an id nobody can use.
 */
export function carryAgent(data: DataTransfer | null | undefined, id: string, name: string): void {
	if (!data) return;
	data.setData(AGENT_MIME, id);
	data.setData("text/plain", name);
	data.effectAllowed = "move";
}
