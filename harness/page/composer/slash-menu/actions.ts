/** Keep the highlighted row of a menu in view while the arrows move through it. */
export function keepInView(list: HTMLElement | undefined, index: number): void {
	list?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
}
