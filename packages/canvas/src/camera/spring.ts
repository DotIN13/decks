/**
 * The motion iOS uses for a view arriving: a critically damped spring.
 *
 * A spring with no bounce, the "smooth" one: it leaves fast and settles slowly, with no point where
 * it stops dead, which is what an ease-in-out cannot do (it starts slowly, so a press feels late).
 * `response` is the spring's period in seconds, as SwiftUI names it; its distance is
 * `1 − (1 + ωt)·e^(−ωt)` with `ω = 2π / response`. Run for `ms` and divided by where it has got to
 * by then, so it lands exactly on 1 instead of creeping the last fraction of a pixel.
 */
export function springCurve(ms: number, response = SPRING_RESPONSE): (t: number) => number {
	const omega = (2 * Math.PI) / response;
	const at = (seconds: number) => 1 - (1 + omega * seconds) * Math.exp(-omega * seconds);
	const end = at(ms / 1000);
	return (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : at((t * ms) / 1000) / end);
}

/**
 * The pace of an app opening from its icon on iOS: a spring with a period of 0.38s, at rest half a
 * second later. Closing is the swipe up, a little quicker. (0.42s and 560ms read as slow; 0.32s
 * and 420ms as too fast.)
 */
export const SPRING_RESPONSE = 0.38;
export const SPRING_MS = 500;
export const SPRING_BACK_RESPONSE = 0.32;
export const SPRING_BACK_MS = 410;

/** The same curve as a CSS `linear()` easing, for the Web Animations API and transitions. */
export function springEasing(ms: number, response = SPRING_RESPONSE, points = 32): string {
	const curve = springCurve(ms, response);
	const stops: string[] = [];
	for (let i = 0; i <= points; i++) stops.push(curve(i / points).toFixed(4));
	return `linear(${stops.join(", ")})`;
}
