import type { Route, RouteAnswer } from "../../kernel/types.ts";
import type { GoogleSignIn } from "./client.ts";

// The two addresses a browser reaches while signing in, before it has any token: the start, which
// sends it to Google, and the callback Google sends it back to (a Web client's). Pasting the
// address back (a Desktop client's) is the google.connect call.

const page = (status: number, words: string): RouteAnswer => ({ status, type: "text/html", body: `<!doctype html><meta charset="utf-8"><title>Google</title><p style="font: 16px system-ui; margin: 40px">${words.replace(/</g, "&lt;")}</p>` });

export function signInRoutes(signIn: GoogleSignIn): Route[] {
	return [
		{
			method: "GET",
			prefix: "/api/google/signin",
			public: true,
			async answer(_ctx, _path, query) {
				try {
					return { status: 302, type: "text/plain", body: "", headers: { location: await signIn.signInUrl(query.get("origin") ?? "http://127.0.0.1") } };
				} catch (error) {
					return page(503, (error as Error).message);
				}
			},
		},
		{
			method: "GET",
			prefix: "/api/google/callback",
			public: true,
			async answer(_ctx, path, query) {
				try {
					const state = await signIn.finish(`http://decks.local${path}?${query}`);
					return page(200, `Signed in to Google${state.email ? ` as ${state.email}` : ""}. You can close this tab.`);
				} catch (error) {
					return page(400, (error as Error).message);
				}
			},
		},
	];
}
