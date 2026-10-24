/** Decks' mark as Studio draws it: three boards of unequal size, in a thin line. */
export function DecksLineMark(props: { size?: number }) {
	return (
		<svg width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<rect x="2.5" y="3.5" width="11" height="9.5" rx="2" />
			<rect x="15.5" y="3.5" width="6" height="17" rx="2" />
			<rect x="2.5" y="15.5" width="11" height="5" rx="2" />
		</svg>
	);
}
