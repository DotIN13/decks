import type { AgentMode } from "@decks/protocol";

// How much the agent asks before acting: the modes, which the runtime offers, and which the chip shows.

/** A mode the chip offers: its name, and what it means for the rest of the session. */
export interface ModeEntry {
	mode: AgentMode;
	label: string;
	note: string;
}

/** How much this agent asks before acting, for the rest of the session. */
export const MODES: readonly ModeEntry[] = [
	{ mode: "manual", label: "Ask first", note: "Ask before anything it judges worth asking about." },
	{ mode: "acceptEdits", label: "Edit freely", note: "Stop asking about card edits. Commands still ask." },
	{ mode: "plan", label: "Plan only", note: "Change nothing at all: read, think, and propose a plan to approve." },
	{ mode: "auto", label: "Auto", note: "Stop asking altogether and decide for itself." },
];

/** The modes the runtime offers, in the chip's order. */
export function availableModes(offered: readonly AgentMode[]): ModeEntry[] {
	return MODES.filter((entry) => offered.includes(entry.mode));
}

/** The mode shown on the chip: the agent's own, else the first offered. */
export function currentMode(offered: readonly AgentMode[], mode: AgentMode | undefined): ModeEntry {
	return MODES.find((entry) => entry.mode === mode) ?? availableModes(offered)[0] ?? MODES[0]!;
}

/** Anything but asking first is a standing change, so the chip is tinted for it. */
export const modeTinted = (mode: AgentMode | undefined): boolean => mode !== undefined && mode !== "manual";
