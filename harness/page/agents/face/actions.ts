// A popover's way to close itself after a pick: its trigger hands over the
// close, and a pick calls it before doing what was picked.

export function createDismiss() {
	const held = { close: undefined as (() => void) | undefined };
	const hold = (api: { open: boolean; toggle: () => void }) => (held.close = () => api.open && api.toggle());
	const pick = (run: () => void) => {
		held.close?.();
		run();
	};
	return { hold, pick };
}
