// The side panel's agent lists, with no store and no DOM: the workspace an
// agent dropped on a section moves to, and what an empty list says.

/** A workspace section moves a dropped agent into it; the no-workspace section takes it out. */
export const workspaceOf = (section: { kind: string; label: string }): string | null => (section.kind === "workspace" ? section.label : null);

/** What the new-agent button in a section says. */
export const addWords = (section: { kind: string; label: string }): string => (section.kind === "workspace" ? `Add an agent in ${section.label}` : "Add an agent in no workspace");

/** No agents at all, or none that match the search. */
export function noAgentsWords(count: number, query: string, recent: boolean): string {
	if (count === 0) return recent ? "No agents yet." : "No agents yet. Start one with `+`.";
	return `No agent matches “${query.trim()}”.`;
}
