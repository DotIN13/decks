/**
 * The few icons the chrome needs, inline.
 *
 * Inline rather than a sprite or a dependency: there are three of them, they inherit
 * `currentColor` so they follow the theme without being told about it, and an icon font
 * would be a network round trip for the first paint of the title bar.
 */

/**
 * The mark: boards of unequal size laid out on a canvas.
 *
 * Deliberately not a grid of equal squares — a deck is an arrangement somebody chose,
 * and the asymmetry is the only thing that says so at 17px.
 */
export function DecksMark() {
	return (
		<svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor" aria-hidden="true">
			<rect x="1" y="2" width="7.5" height="6.5" rx="1.5" />
			<rect x="10" y="2" width="5" height="12" rx="1.5" opacity="0.5" />
			<rect x="1" y="10" width="7.5" height="4" rx="1.5" opacity="0.72" />
		</svg>
	);
}

export function SunIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			width="17"
			height="17"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="4.25" />
			<path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.1 5.1l1.4 1.4M17.5 17.5l1.4 1.4M18.9 5.1l-1.4 1.4M6.5 17.5l-1.4 1.4" />
		</svg>
	);
}

export function MoonIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			width="17"
			height="17"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
		</svg>
	);
}
