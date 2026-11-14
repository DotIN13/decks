// The agents' Google Docs tools, for a runtime in this process (Claude, Pi).
// No protocol call reads or edits a Google Doc for an agent yet, so the list is
// empty and the runtimes register none; the words wait in prompts/gdocs-tools.json.

export type GdocsTool = { name: string; description: string; parameters: Record<string, string> };
export type GdocsCall = (tool: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>;

export const GDOCS_TOOLS: readonly GdocsTool[] = [];

export function gdocsCaller(): GdocsCall {
	return async () => ({ text: "Google Docs are not reachable from this harness yet.", isError: true });
}
