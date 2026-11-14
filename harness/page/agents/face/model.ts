import type { Identity } from "../../state/types/index.ts";

// An agent's face, with no store and no DOM: its letter, and the fill behind
// it (none behind a drawn avatar, whose own transparency would show a halo).

export const initialOf = (identity: Identity | undefined, name: string): string => (identity?.name ?? name).slice(0, 1).toUpperCase();

export function faceStyle(identity: Identity | undefined, size = 24, ring = 2): Record<string, string> {
	const fill = identity?.avatar ? "transparent" : (identity?.color ?? "var(--color-accent)");
	return { "--face": `${size}px`, "--ring": `${ring}px`, "--fill": fill };
}
