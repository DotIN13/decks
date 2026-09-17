/**
 * The code a board asks to run, read out of the board's own file.
 *
 * Deliberately regex rather than a parser, for the reason `deck/meta.ts` gives: this runs
 * when somebody presses something on a board, over a file an agent wrote, and the two
 * things it wants are a script tag and an attribute. Nothing here executes; the server
 * decides whether to run the words at all (`stage/eval.ts` plus the trust store).
 *
 * The shape, in a board file:
 *
 *     <button data-id="promote" data-eval="pick">Promote round 20</button>
 *     <script type="text/decks-eval" data-for="pick">
 *       await stage.send("Kestrel", { task: `Promote ${event.value}`, boards: [event.board] });
 *     </script>
 *
 * A component's `data-eval` names the script; the script says which id it is for. Both
 * attribute orders are read, and both spellings of a quote, because a board is written by
 * an agent as often as by a person and normalising quotes is what an editor does.
 *
 * **A trigger with no script is kept, not dropped.** `triggers()` reports every
 * `data-eval` on a component whether or not a script answers it, because "this board
 * declares a button that can never do anything" is a sentence the trust surface and the
 * browser check both want to be able to say.
 *
 * The one thing a regex cannot do is read a script tag that a board has hidden inside a
 * string, and that is deliberate: the same text in an attribute would be markup to a
 * browser, so refusing to see it here keeps this reader and the browser agreeing.
 */

/** The script type a board carries its code in. Not JavaScript, so a browser never runs it. */
export const BOARD_EVAL_TYPE = "text/decks-eval";

export interface EvalBinding {
	/** The id a component names with `data-eval`. */
	id: string;
	/** The script's body, exactly as the file has it. */
	code: string;
}

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const TYPE = /<script\b[^>]*\btype\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/i;
const TRIGGER = /<[^>]*\bdata-eval\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;

/** One attribute's value out of a tag's attributes, or undefined when it is not there. */
function attr(attributes: string, name: string): string | undefined {
	const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attributes);
	return match?.[1] ?? match?.[2];
}

/**
 * Every script block a board carries, in the order the file has them.
 *
 * An id named twice keeps both here and the first wins in `codeFor`, which is the browser's
 * own rule for `querySelector` and therefore the one a board author will expect.
 */
export function bindings(html: string): EvalBinding[] {
	const found: EvalBinding[] = [];
	SCRIPT.lastIndex = 0;
	for (let tag = SCRIPT.exec(html); tag; tag = SCRIPT.exec(html)) {
		const attributes = tag[1] ?? "";
		const type = TYPE.exec(`<script${attributes}>`);
		const named = (type?.[1] ?? type?.[2] ?? "").trim().toLowerCase();
		if (named !== BOARD_EVAL_TYPE) continue;
		const id = attr(attributes, "data-for")?.trim();
		if (!id) continue;
		found.push({ id, code: tag[2] ?? "" });
	}
	return found;
}

/** The code one component's `data-eval` names, or undefined when no script answers it. */
export function codeFor(html: string, id: string): string | undefined {
	return bindings(html).find((binding) => binding.id === id)?.code;
}

/**
 * The ids every component on a board asks to run, in reading order and without repeats.
 *
 * Read from the components rather than from the scripts: the question this answers is
 * "what can be pressed on this board", and a script nobody names is not pressable.
 */
export function triggers(html: string): string[] {
	const ids: string[] = [];
	TRIGGER.lastIndex = 0;
	for (let tag = TRIGGER.exec(html); tag; tag = TRIGGER.exec(html)) {
		const id = (tag[1] ?? tag[2] ?? "").trim();
		if (id && !ids.includes(id)) ids.push(id);
	}
	return ids;
}
