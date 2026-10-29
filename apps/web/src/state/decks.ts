import { connect, DecksError, type Decks } from "@decks/sdk";
import { apiBase } from "../connections/connection.ts";
import { authHeaders } from "../lib/session.ts";
import { notice } from "./notices.ts";
import { send } from "./socket.ts";

/**
 * The person's clicks on the canvas, as verbs: the same `POST /api/v1/<verb>` an agent's `decks`
 * command and an app's SDK call (`packages/sdk`), sent with this tab's person token (`lib/session.ts`),
 * which is what makes them the person's. The canvas and the agent they act on go as parameters.
 *
 * Whose stage a click acts on is read when it is sent: the canvas on screen and the conversation
 * the person is in, which App names once (`setPersonStage`). Through the relay to another server
 * the prefix comes along (`apiBase`), as for every other request this page makes.
 *
 * A refusal is said as a notice, which is what the person saw when these went over the socket;
 * the caller hears `undefined` and can put back what it drew ahead of the answer.
 */
let onScreen: () => string | undefined = () => undefined;
let talkingTo: () => string | undefined = () => undefined;
export function setPersonStage(stage: () => string | undefined, agent: () => string | undefined): void {
	onScreen = stage;
	talkingTo = agent;
}

/** The canvas on screen, for the token this page asks for a card on it (`app/canvas-host.ts`). */
export function stageOnScreen(): string | undefined {
	return onScreen();
}

/** The address the SDK reaches this harness at, from this tab: its own server, or the connection it is on. */
export function deckAddress(): string {
	return `${location.origin}${apiBase().replace(/\/api$/, "")}`;
}

let client: Decks | undefined;
let clientBase: string | undefined;
function decks(): Decks {
	const base = `${location.origin}${apiBase().replace(/\/api$/, "")}`;
	if (!client || clientBase !== base) {
		client = connect({ url: base, stage: () => onScreen(), agent: () => talkingTo(), notes: () => {}, headers: authHeaders() });
		clientBase = base;
	}
	return client;
}

/** Call one verb as the person; a refusal is a notice and an `undefined`. */
export async function act<T = unknown>(verb: string, args: unknown[], agent?: string): Promise<T | undefined> {
	try {
		// A click about one conversation (moving it to a stage) names it and no canvas: the agent wins.
		const connection = agent ? connect({ url: decks().address, agent, notes: () => {}, headers: authHeaders() }) : decks();
		return (await connection.call(verb, args)).value as T;
	} catch (error) {
		notice("warn", error instanceof DecksError || error instanceof Error ? error.message : String(error));
		return undefined;
	}
}

/**
 * The person's edit to the drawing on screen, sent. `edit` names it: the server sends the name back
 * with the revision that has it (`made`), which is how the canvas, showing the edit already, knows when
 * the drawing it is sent has it (`canvas/src/drawing.ts`). Refused, the drawing is asked for again, so
 * an edit the canvas drew ahead of the answer goes away; the answer says whether it was made.
 */
export async function sendDrawingEdit(agentId: string, ops: unknown[], edit?: string): Promise<boolean> {
	let done: unknown;
	try {
		const connection = edit ? connect({ url: decks().address, stage: () => onScreen(), agent: () => talkingTo(), notes: () => {}, headers: { ...authHeaders(), "x-decks-edit": edit } }) : decks();
		done = (await connection.call("canvas.batch", [ops])).value;
	} catch (error) {
		notice("warn", error instanceof DecksError || error instanceof Error ? error.message : String(error));
		done = undefined;
	}
	if (done === undefined) send({ type: "stage.pen.get", agentId });
	return done !== undefined;
}

/**
 * The canvas on screen takes the person's edits itself (`setDrawingEditor`): it shows each at once and
 * sends it. Anything else that edits the drawing (a file dropped, a pen file placed, the ink bar's
 * delete) goes through it too, so it shows at once as well; with no canvas, it is sent as it is.
 */
let drawingEditor: { agentId: () => string | undefined; edit(ops: unknown[]): void } | undefined;
export function setDrawingEditor(editor: typeof drawingEditor): void {
	drawingEditor = editor;
}

/** The person's edit to the drawing of the chat `agentId`: through the canvas when it shows that drawing, else sent. */
export async function editDrawing(agentId: string, ops: unknown[]): Promise<void> {
	if (drawingEditor && drawingEditor.agentId() === agentId) {
		drawingEditor.edit(ops);
		return;
	}
	await sendDrawingEdit(agentId, ops);
}
