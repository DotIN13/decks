/** A pointer position with the time it was seen, for the velocity at release. */
export interface Sample {
	x: number;
	y: number;
	t: number;
}

/** Pixels per millisecond, each axis. */
export interface Velocity {
	vx: number;
	vy: number;
}

/**
 * How fast the pointer was moving when it let go: the displacement over the last `window`
 * milliseconds of samples, and zero when the pointer paused before releasing. A pause is
 * what a person does to *put* something somewhere; a throw is what they do to send it.
 */
export function velocityFrom(samples: readonly Sample[], now: number, window = 100): Velocity {
	const last = samples[samples.length - 1];
	if (!last || now - last.t > window) return { vx: 0, vy: 0 };
	let first = last;
	for (let i = samples.length - 1; i >= 0; i--) {
		const s = samples[i]!;
		if (last.t - s.t > window) break;
		first = s;
	}
	const dt = last.t - first.t;
	if (dt <= 0) return { vx: 0, vy: 0 };
	return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}
