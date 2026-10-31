import type { StageTool } from "./tool.ts";

const OLD_NAME = / is an old name, removed on 2026-11-30: use /;

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...names: string[]) => (...args: unknown[]) => Promise<unknown>;

/**
 * For tests: run a snippet against a tool the way an agent's node script does, with every verb it
 * calls going through `StageTool.call` (the path `/api/v1/<verb>` takes), and answer with the text
 * a model would read: the value as JSON, or the error, then the notes the verbs added.
 */
export async function runCode(tool: StageTool, code: string): Promise<{ text: string; isError: boolean; images?: Array<{ data: string; mimeType: string }> }> {
	const notes: string[] = [];
	const images: Array<{ data: string; mimeType: string }> = [];
	const verbs = (path: string[]): unknown =>
		new Proxy(function () {}, {
			get: (_target, key) => (typeof key === "string" && key !== "then" ? verbs([...path, key]) : undefined),
			apply: async (_target, _self, args: unknown[]) => {
				const answer = await tool.call(path.join("."), args);
				// The note an old name carries is checked on its own (`verbs/aliases.test.ts`); the tests
				// written against the old names read the rest as they always did.
				notes.push(...answer.notes.filter((note) => !OLD_NAME.test(note)));
				images.push(...(answer.images ?? []));
				if (!answer.ok) throw new Error(answer.error);
				return answer.value;
			},
		});
	const parts: string[] = [];
	let isError = false;
	try {
		const value = await new AsyncFunction("stage", code)(verbs([]));
		parts.push(value === undefined ? "(done)" : JSON.stringify(value, null, 2));
	} catch (error) {
		isError = true;
		parts.push(`Error: ${error instanceof Error ? error.message : String(error)}`);
	}
	parts.push(...notes);
	return { text: parts.join("\n"), isError, ...(images.length ? { images } : {}) };
}
