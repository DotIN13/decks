import { createSignal } from "solid-js";

/**
 * A yes-or-no question the app asks the person, drawn once by `ui/ConfirmDialog.tsx`.
 *
 * One at a time: a second question waits for the first to be answered, so two uploads over the
 * size line dropped together are asked about one after the other rather than stacked.
 */
export interface Question {
	title: string;
	body: string;
	yes: string;
	no: string;
	answer: (yes: boolean) => void;
}

const [question, setQuestion] = createSignal<Question | undefined>();
export { question };

let queue: Promise<unknown> = Promise.resolve();

export function ask(q: Omit<Question, "answer">): Promise<boolean> {
	const turn = queue.then(
		() =>
			new Promise<boolean>((resolve) =>
				setQuestion({
					...q,
					answer: (yes) => {
						setQuestion(undefined);
						resolve(yes);
					},
				}),
			),
	);
	queue = turn;
	return turn;
}
