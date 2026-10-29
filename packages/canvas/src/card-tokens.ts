/**
 * A card's own token, for its buttons, in a page that holds the canvas itself (the Decks app without
 * the canvas frame): a card is drawn in this page, so its `card.decks` calls are made here, as that
 * card (`CanvasHost.cardCall`). In the canvas frame the frame answers them instead (`frame/card-calls.ts`).
 *
 * A card's token says "this card" and nothing more: the harness asks the person once before it may
 * use the stage, and it may call nothing else (`server/src/auth/guard.ts`). The host asks the harness
 * for it (`mint`, which is `POST /api/tokens { kind: "board", path, stage }` with the person's token),
 * and it is kept per card and canvas until it is due for renewal.
 */

/** How a host asks the harness for a card's token: undefined (or a throw) when this card can have none here. */
export type MintCardToken = (path: string, stage?: string) => Promise<string | undefined>;

export interface CardTokens {
	/** The card's token on this canvas, made once and kept until it is due for renewal. */
	token(path: string, stage?: string): Promise<string | undefined>;
	/** Forget every token kept. */
	dispose(): void;
}

/**
 * How long a token is kept before a new one is made. The harness forgets a card's token twelve hours
 * after its last use (`BOARD_IDLE_MS`), so six is well inside that.
 */
const SIX_HOURS = 6 * 3_600_000;

export function createCardTokens(options: { mint: MintCardToken; renewMs?: number; now?: () => number }): CardTokens {
	const renewMs = options.renewMs ?? SIX_HOURS;
	const now = options.now ?? Date.now;
	const kept = new Map<string, { token: Promise<string | undefined>; until: number }>();
	return {
		token: (path, stage) => {
			const key = `${stage ?? ""}\n${path}`;
			const held = kept.get(key);
			if (held && held.until > now()) return held.token;
			const made = options.mint(path, stage).catch(() => undefined);
			kept.set(key, { token: made, until: now() + renewMs });
			// A refusal is not kept: the person may allow it on the next press.
			void made.then((got) => !got && kept.delete(key));
			return made;
		},
		dispose: () => kept.clear(),
	};
}
