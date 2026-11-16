import { isCardPath } from "@decks/hub/layout";
import { deleteFile, editFile, findFiles, grepFiles, listFiles, moveFile, readFile, writeFile, type TextEdit } from "../files/deck-files.ts";
import type { Verbs as Stage } from "@decks/sdk";
import type { VerbContext } from "./context.ts";

/**
 * The deck's files as calls, for a caller with no disk (`files/deck-files.ts` is what they do and
 * what they refuse), and a file's address for a card to embed.
 *
 * A write through a call is held to what a write through a canvas call is: a friend's canvas shared
 * to view is not written to. A card's page written this way has its writer for a byline, as one
 * written with `card.create` does.
 */
export function fileVerbs(ctx: VerbContext): Pick<Stage, "file"> {
	const { service, agent } = ctx;
	const root = () => service.deckPath();

	/** A path about to be written: a shared canvas's folder takes it only from someone who may edit that canvas. */
	const mayWrite = (path: unknown) => {
		const shared = typeof path === "string" ? /^(?:\.\/)?shared\/canvases\/([^/]+)\/([^/]+)(?:\/|$)/.exec(path.trim()) : undefined;
		if (shared) ctx.needPens().mayWrite(`shared/${shared[1]}/${shared[2]}`);
	};
	/** The caller wrote this file: a card's page gets them as its writer. */
	const wrote = (path: string) => {
		if (!isCardPath(path)) return;
		try {
			agent.worked?.(path);
		} catch {
			// The deck has not seen a brand-new card yet: its byline comes with decks agent claim, or the next write.
		}
	};

	return {
		file: {
			url: async (file: string) => service.resolve(file),
			list: async (path?: string, options?: { deep?: boolean; limit?: number }) => listFiles(root(), path ?? "", options),
			find: async (pattern: string, options?: { path?: string; limit?: number }) => findFiles(root(), pattern, options),
			read: async (path: string, options?: { from?: number; lines?: number }) => readFile(root(), path, options),
			write: async (path: string, text: string, options?: { rev?: number }) => {
				mayWrite(path);
				const file = writeFile(root(), path, text, options);
				wrote(file.path);
				return file;
			},
			edit: async (path: string, edits: TextEdit[], options?: { rev?: number }) => {
				mayWrite(path);
				const file = editFile(root(), path, edits, options);
				wrote(file.path);
				return file;
			},
			grep: async (pattern: string, options?: { path?: string; glob?: string; limit?: number; ignoreCase?: boolean }) => grepFiles(root(), pattern, options),
			move: async (path: string, to: string) => {
				mayWrite(path);
				mayWrite(to);
				return moveFile(root(), path, to);
			},
			delete: async (path: string) => {
				mayWrite(path);
				return deleteFile(root(), path);
			},
		},
	};
}
