// The agents' Google Docs tools, gdocs_read and gdocs_edit: their words, and
// the protocol calls they make (google.read, google.edit) with the agent's own token.
import { readFileSync } from "node:fs";
import { clientFor } from "@decks/sdk";
import { gdocsTools } from "../../prompts/paths.ts";
import type { DecksAccess } from "../backend.ts";

export type GdocsTool = { name: string; description: string; parameters: Record<string, string> };
export type GdocsCall = (tool: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>;

/** The tools' words, as every runtime registers them (prompts/gdocs-tools.json). */
export const GDOCS_TOOLS: readonly GdocsTool[] = JSON.parse(readFileSync(gdocsTools(), "utf8")) as GdocsTool[];

/** Which protocol call each tool makes. */
export const GDOCS_CALLS: Readonly<Record<string, string>> = { gdocs_read: "google.read", gdocs_edit: "google.edit" };

/** A tool call made as the agent: the call's answer as the text a model reads, a refusal as an error. */
export function gdocsCaller(decks: Pick<DecksAccess, "url" | "token">): GdocsCall {
	return async (tool, args) => {
		const call = GDOCS_CALLS[tool];
		if (!call) return { text: `No tool ${tool}.`, isError: true };
		try {
			const { value } = await clientFor(decks.url, decks.token).call(call, args);
			return { text: gdocsText(tool, value as { doc: string; title?: string; text: string }), isError: false };
		} catch (error) {
			const refused = error as { message?: string; hint?: string };
			return { text: [refused.message ?? String(error), refused.hint ? `Try ${refused.hint}.` : ""].filter(Boolean).join(" "), isError: true };
		}
	};
}

/** What the model reads: the Doc as markdown under its title, or that the edit landed. */
export function gdocsText(tool: string, value: { doc: string; title?: string; text: string }): string {
	if (tool === "gdocs_read") return `# ${value.title ?? "Untitled"} (Google Doc ${value.doc})\n\n${value.text}`;
	return "Edited the Doc. The person sees the change on its page.";
}
