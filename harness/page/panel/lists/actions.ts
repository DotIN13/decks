import { carriesAgent, draggedAgent } from "../../agents/agent-drag.ts";

// Dropping an agent on a section of the Agents list: the section lights while
// one is over it, and the drop moves the agent to its workspace.

export function dropOn(section: { id: string }, workspace: string | null, over: { set: (fn: (was: string | undefined) => string | undefined) => void }, move: ((id: string, workspace: string | null) => void) | undefined) {
	return {
		onDragOver: (event: DragEvent) => {
			if (!move || !carriesAgent(event.dataTransfer)) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
			over.set(() => section.id);
		},
		onDragLeave: (event: DragEvent) => {
			const to = event.relatedTarget as Node | null;
			if (!to || (event.currentTarget as Node).contains(to)) return;
			over.set((was) => (was === section.id ? undefined : was));
		},
		onDrop: (event: DragEvent) => {
			const id = draggedAgent(event.dataTransfer);
			over.set(() => undefined);
			if (!id) return;
			event.preventDefault();
			move?.(id, workspace);
		},
	};
}
