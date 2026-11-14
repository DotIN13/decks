/**
 * Every working ring on the page breathes in step.
 *
 * A CSS animation starts when its element gets the state, so two agents that began working a
 * second apart pulse a second apart, and a row, its pill and its chip in the top bar each start
 * whenever they were drawn. Pinning each `ring-pulse` to the start of the document's timeline puts
 * them all on one clock: same period, same phase, wherever the face is.
 */
export function syncRings(): () => void {
	const pin = (event: AnimationEvent) => {
		if (event.animationName !== "ring-pulse") return;
		const target = event.target as Element | null;
		for (const animation of target?.getAnimations?.() ?? []) {
			if ((animation as CSSAnimation).animationName === "ring-pulse") animation.startTime = 0;
		}
	};
	document.addEventListener("animationstart", pin, true);
	return () => document.removeEventListener("animationstart", pin, true);
}
