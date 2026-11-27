import type { Registry } from "../agents/registry.ts";
import type { Apps } from "../apps/service.ts";
import type { AppTrust } from "../auth/app-trust.ts";
import type { CardService } from "../cards/service.ts";
import type { Cameras } from "../deck/cameras.ts";
import type { Deck } from "../deck/loader.ts";
import type { CanvasService } from "../canvas/service.ts";

/**
 * What the calls need of the harness to find who is calling and run a call for them: the agents,
 * the canvases, the deck, its cards and apps, and what the person has let an app do. Handed in by
 * whoever starts the harness, which has all of it; nothing here names that object, so the calls
 * depend on the parts below them and on nothing above.
 */
export interface CallsHost {
	deck: Deck;
	readonly agents: Registry;
	readonly canvas: CanvasService;
	readonly cards: CardService;
	readonly cameras: Cameras;
	readonly apps: Apps;
	/** The apps the person lets call for good, and the ones let until the harness restarts. */
	readonly appTrust: AppTrust;
	readonly appsAllowedOnce: Set<string>;
	readonly port: number;
	/** The files a canvas's document items name, by the name each item uses, as the document service keys them. */
	documentsOn(canvas: string): Map<string, string>;
}
