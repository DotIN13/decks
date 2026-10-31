/**
 * The verbs removed with boards (2026-10-30), each with the call that does its work now. Used only
 * to word the refusal of an old name: none of them is a call, and nothing here runs one.
 */
const RENAMED: ReadonlyMap<string, string> = new Map([
	["board.list", "decks.card.list"],
	["board.create", "decks.card.create"],
	["board.get", "decks.card.get"],
	["board.canvases", "decks.card.canvases"],
	["board.url", "decks.card.url"],
	["newBoard", "decks.card.create, then decks.canvas.insert"],
	["fit", "decks.canvas.fit"],
	["resize", "decks.canvas.update(card, { size })"],
	["report", "decks.agent.claim"],
	["reload", "decks.view.reload({ card })"],
	["boards", "decks.canvas.read, or decks.card.list"],
	["show", 'decks.canvas.insert({ type: "card", card }) to place it, then decks.view.focus'],
	["hide", "decks.canvas.delete"],
	["move", "decks.canvas.move(card, { at })"],
	["cursor", "decks.view.cursor"],
	["camera", "decks.view.camera to read, decks.view.move to move"],
	["viewport", "decks.view.viewport"],
	["screenshot", "decks.canvas.screenshot"],
	["stages", "decks.canvas.list"],
	["open", "decks.agent.update({ canvas }), then decks.view.goto"],
	["newStage", "decks.canvas.create, then decks.agent.update({ canvas })"],
	["title", "decks.canvas.rename, or decks.here() to read"],
	["pen.read", "decks.canvas.read (a frame file: decks.canvas.read({ frame }))"],
	["pen.edit", "decks.canvas.batch, or the single calls (insert, update, replace, delete, move, copy, variables)"],
	["pen.create", "decks.frame.create"],
	["pen.save", "decks.canvas.save"],
	["pen.file", "decks.canvas.file"],
	["me", "decks.agent.me to read, decks.agent.update to change"],
	["agents", "decks.agent.list"],
	["send", "decks.agent.queue (decks.agent.create makes the agent first)"],
	["queue", "decks.agent.inbox"],
	["url", "decks.card.url"],
	["resolve", "decks.file.url"],
	["apps.board", "decks.apps.item"],
]);

/** What to say to a call by an old name: that it is gone, and what to call instead. Undefined for any other name. */
export function renamedVerb(name: string): string | undefined {
	const now = RENAMED.get(name);
	return now === undefined ? undefined : `${name} was an old name and has been removed: use ${now}.`;
}
