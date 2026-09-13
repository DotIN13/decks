/**
 * `AskUserQuestion`, which is a question and not a permission prompt.
 *
 * Claude Code's own tool for asking the user to choose between courses of action. It
 * arrives through `canUseTool` like every other tool, and answering it the way a tool is
 * answered is what made it useless: Decks showed "Claude wants to run AskUserQuestion —
 * allow it?", you clicked yes, and the CLI ran a tool whose answers nobody had supplied,
 * so the turn carried on as if nothing had been asked.
 *
 * **The host is the renderer.** The tool's own input schema says so — `answers` is
 * described as "user answers collected by the permission component" — so the contract is
 * to draw the questions, collect the choices, and hand them back on `updatedInput`. The
 * CLI's implementation then returns them as the tool's result.
 *
 * Separate from `backend.ts` because it is the one part of this with no CLI in it: a shape
 * off the wire, a callback, and the rules about what to do when either is not what it
 * should be. That makes it testable, and the rules are what will rot.
 */

/** What a dialog needs to ask one of them. Mirrors the protocol's `choose` prompt. */
export interface ChooseRequest {
	title: string;
	message?: string;
	options: { label: string; description?: string }[];
	multiple?: boolean;
	other?: boolean;
}

/** One question out of the call, as loosely as it may arrive. */
interface AskedQuestion {
	question?: unknown;
	header?: unknown;
	multiSelect?: unknown;
	options?: unknown;
}

export type ToolDecision =
	| { behavior: "allow"; updatedInput: Record<string, unknown> }
	| { behavior: "deny"; message: string };

/**
 * Ask each question, and hand the answers back on the input.
 *
 * Sequentially, one dialog at a time: the tool allows up to four questions and the deck has
 * one place to put a dialog — above the input bar, where the hands are — and four at once
 * there is a form, not a question. They are usually one anyway.
 */
export async function answerQuestions(
	input: Record<string, unknown>,
	choose: (request: ChooseRequest) => Promise<string | undefined>,
): Promise<ToolDecision> {
	const questions = Array.isArray(input.questions) ? (input.questions as AskedQuestion[]) : [];
	const askable = questions.map(requestFor).filter((request): request is ChooseRequest => request !== undefined);
	/*
	 * Nothing askable: allowed, with no answers.
	 *
	 * A malformed call is the model's mistake, not the user's, and the tool's own result is
	 * where it should learn about it — denying would tell it the *user* refused, which is a
	 * different thing and the one thing it must not conclude from a bad argument.
	 */
	if (askable.length === 0) return { behavior: "allow", updatedInput: input };

	const answers: Record<string, string> = {};
	for (const request of askable) {
		const picked = await choose(request);
		/*
		 * Abandoned, so the whole call is denied rather than half-answered.
		 *
		 * Allowing it with the answers so far would tell the model the unanswered questions
		 * had no answer, which is a different statement from "the user did not want to
		 * answer" — and the model would act on it.
		 */
		if (picked === undefined) return { behavior: "deny", message: "The user closed the question without answering." };
		answers[request.title] = picked;
	}
	return { behavior: "allow", updatedInput: { ...input, answers } };
}

/**
 * One question as a dialog, or nothing if it is not one.
 *
 * A question with no text cannot be asked and a question with fewer than two options is
 * not a choice, so both are dropped rather than shown as an empty card. The rest of the
 * call still goes ahead: three good questions and one malformed one is better answered
 * three times than refused.
 */
function requestFor(raw: AskedQuestion): ChooseRequest | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const title = typeof raw.question === "string" ? raw.question.trim() : "";
	if (!title) return undefined;
	const options = (Array.isArray(raw.options) ? raw.options : [])
		.map((option) => {
			const source = (option ?? {}) as { label?: unknown; description?: unknown };
			const label = typeof source.label === "string" ? source.label.trim() : "";
			if (!label) return undefined;
			const description = typeof source.description === "string" ? source.description.trim() : "";
			return { label, ...(description ? { description } : {}) };
		})
		.filter((option): option is { label: string; description?: string } => option !== undefined);
	if (options.length < 2) return undefined;
	const header = typeof raw.header === "string" ? raw.header.trim() : "";
	return {
		title,
		...(header ? { message: header } : {}),
		options,
		...(raw.multiSelect === true ? { multiple: true } : {}),
		/*
		 * The escape the tool promises and does not carry.
		 *
		 * Its description tells the model "There should be no 'Other' option, that will be
		 * provided automatically" — and automatically means here. A question with four
		 * answers and no way to say "none of those" is a question that traps you.
		 */
		other: true,
	};
}
