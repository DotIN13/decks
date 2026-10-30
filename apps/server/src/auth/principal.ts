/**
 * Who is calling the harness: what a token says, and the only thing that says it (`tokens.ts`).
 *
 * Every request to the harness carries a token, and who is calling comes from that token alone. A
 * header that names the person, a board, an app or an agent says nothing about who sent it; nor
 * does reaching the harness from this machine, or from a page on its own address. So identity is
 * one of these, read off a token by `TokenStore.verify`, and attached to the request by the gate
 * (`guard.ts`) as `req.principal`.
 *
 * - `person`: the person, from a Decks tab they opened or a terminal they logged in from.
 * - `site`: another front end the person paired with this harness (Decks Studio, a second Decks), which
 *   acts as the person. `origin` is the site it was given to, when there was one; `studio` marks one
 *   given through Decks Studio's key (`studio/index.ts`), which goes when that key does.
 * - `agent`: one agent, by id: what its shell's `decks` command and its tools carry.
 * - `app`: one app's server, by name, from its app pass (`passes.ts`).
 * - `canvas`: the canvas frame for one canvas, acting as the person on that canvas alone, with their
 *   role there now (`view` reads only): the editor in its sandboxed page, and the cards it runs. From a
 *   canvas pass (`passes.ts`), not a token.
 */
export type Principal =
	| { kind: "person" }
	| { kind: "site"; origin?: string; label: string; studio?: true }
	| { kind: "agent"; id: string }
	| { kind: "app"; name: string }
	| { kind: "canvas"; canvas: string; role: "edit" | "view" };

export type PrincipalKind = Principal["kind"];

/** Whether a caller is the person, in a tab or a terminal, or a front end acting for them. */
export function actsAsPerson(principal: Principal | undefined): principal is Extract<Principal, { kind: "person" | "site" }> {
	return principal?.kind === "person" || principal?.kind === "site";
}

/** A principal in a few words, for a log line or a refusal. */
export function describe(principal: Principal): string {
	switch (principal.kind) {
		case "person":
			return "the person";
		case "site":
			return principal.label || principal.origin || "a paired front end";
		case "agent":
			return `agent ${principal.id}`;
		case "app":
			return `app ${principal.name}`;
		case "canvas":
			return `the canvas frame for ${principal.canvas}`;
	}
}

declare module "express-serve-static-core" {
	interface Request {
		/** Who is calling, from the token the request carried (`auth/guard.ts`); undefined for an open door. */
		principal?: Principal;
		/** The id of that token, for "this browser" on a settings page and for the passes it asks for. */
		tokenId?: string;
	}
}
