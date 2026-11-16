// What the context dial's usage row does.

/** The usage row: close the dial's menu, then open the whole reading. */
export function openUsage(dismiss: (() => void) | undefined, onUsage: () => void): void {
	dismiss?.();
	onUsage();
}
