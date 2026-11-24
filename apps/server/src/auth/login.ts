/**
 * Logging in with the password (`password.ts`): the doors a browser and a terminal use, and the
 * one question the rest of the server asks, whether a request comes from a logged-in browser.
 *
 * - `GET /api/login/state`: whether a password is set, and whether this browser is logged in.
 * - `POST /api/login/password { password }`: the login, which sets the cookie.
 * - `POST /api/logout`: this browser's login taken back.
 * - `POST /api/login/everywhere`: every login, tab and terminal of the person's taken back.
 * - `POST /api/password { password, current? }`: set or change it; set on this Mac by
 *   `decks password set`, changed from Settings with the current one.
 * - `POST /api/login/device`, `GET /api/login/device`, `POST /api/login/device/approve` and
 *   `POST /api/login/device/poll`: a terminal elsewhere let in from a logged-in browser.
 *
 * A request that a cookie authorises is taken only from this site's own pages (`fromAnotherSite`),
 * so another site cannot press these doors with the person's cookie.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import { join } from "node:path";
import { CLI_TOKEN_LABEL } from "./cli-token.ts";
import { bearerOf, fromAnotherSite } from "./guard.ts";
import { callerOf, type DeviceLogins, LOGIN_IDLE_MS, LOGIN_LABEL, loginCookie, loginCookieOf, type LoginThrottle, overHttps, passwordMaySend, PASSWORD_MIN, type PasswordStore } from "./password.ts";
import { actsAsPerson } from "./principal.ts";
import type { TokenStore } from "./tokens.ts";

/** What logging in needs of the harness. */
export interface LoginHost {
	readonly tokens: TokenStore;
	readonly password: PasswordStore;
	/** Whether the password login is on (`DECKS_PASSWORD_LOGIN`, `password.ts`). */
	readonly passwordLogin: boolean;
	readonly throttle: LoginThrottle;
	readonly deviceLogins: DeviceLogins;
	readonly deck: { readonly name: string };
	readonly cliTokenId: string | undefined;
}

/** What the person's tokens are called that signing out everywhere leaves: this Mac's own file and Studio's sync. */
const KEPT_EVERYWHERE = new Set([CLI_TOKEN_LABEL, "Studio sync"]);

/** Whether this request comes from a browser logged in with the password: its cookie is a person token this harness gave. */
export function loggedIn(app: Pick<LoginHost, "tokens">, req: Pick<Request, "headers">): boolean {
	const cookie = loginCookieOf(req.headers);
	if (!cookie) return false;
	const seen = app.tokens.verify(cookie);
	return seen.ok && seen.principal.kind === "person";
}

/** Whether the page and what it serves need a login: the password login is on (`DECKS_PASSWORD_LOGIN`), set or not yet. */
export function locked(app: Pick<LoginHost, "passwordLogin">): boolean {
	return app.passwordLogin;
}

const secure = (req: Request) => overHttps(req.secure, req.headers);

/**
 * Every browser signed in, but the ones in `keep`: its login and the tabs it opened. What a new
 * password does, so a browser that knew the old one is out; terminals and this machine's own token
 * stay, since they never knew it. Answers how many went.
 */
function signOutBrowsers(app: Pick<LoginHost, "tokens">, keep: ReadonlySet<string | undefined>): number {
	return app.tokens.revokeWhere((principal, row) => principal.kind === "person" && (row.label === LOGIN_LABEL || row.label === "Decks tab") && !keep.has(row.id));
}

/** What the log says about who did something: the address, as the proxy says when trusted. */
const who = (req: Request) => callerOf(req.socket.remoteAddress, req.headers);

export function loginRoutes(app: LoginHost): express.Router {
	const api = express.Router();

	api.get("/login/state", (req, res) => {
		res.set("cache-control", "no-store").json({ enabled: app.passwordLogin, password: app.password.isSet, loggedIn: app.passwordLogin && loggedIn(app, req) });
	});

	api.post("/login/password", (req, res) => {
		if (fromAnotherSite(req.headers)) return void res.status(403).json({ error: "Log in from this Decks's own page." });
		if (!app.passwordLogin) return void res.status(404).json({ error: "This Decks does not use a password login. Start it with DECKS_PASSWORD_LOGIN=1 to turn it on." });
		if (!app.password.isSet) return void res.status(409).json({ error: "No password is set yet. Set one on the server with decks password set." });
		if (!passwordMaySend(req.socket.remoteAddress, req.secure, req.headers)) return void res.status(403).json({ error: "This Decks is reached over plain HTTP, where a password could be read on the way. Serve it over HTTPS (behind Caddy) to log in from here." });
		const from = callerOf(req.socket.remoteAddress, req.headers);
		const wait = app.throttle.wait(from);
		if (wait > 0) return void res.status(429).set("retry-after", String(wait)).json({ error: "Too many wrong tries. Wait, then try again.", retryAfter: wait });
		const password = String(((req.body ?? {}) as { password?: unknown }).password ?? "");
		if (!app.password.check(password)) {
			app.throttle.wrong(from);
			console.warn(`[decks] a wrong password from ${from}`);
			const after = app.throttle.wait(from);
			return void res.status(after > 0 ? 429 : 403).json({ error: "That is not the password.", ...(after > 0 ? { retryAfter: after } : {}) });
		}
		app.throttle.right(from);
		const { token } = app.tokens.issue({ kind: "person" }, { label: LOGIN_LABEL, idle: LOGIN_IDLE_MS });
		console.warn(`[decks] a browser logged in with the password from ${from}`);
		res.setHeader("Set-Cookie", loginCookie(token, secure(req)));
		res.set("cache-control", "no-store").json({ ok: true });
	});

	api.post("/logout", (req, res) => {
		if (fromAnotherSite(req.headers)) return void res.status(403).json({ error: "Log out from this Decks's own page." });
		const cookie = loginCookieOf(req.headers);
		const id = cookie ? app.tokens.idOf(cookie) : undefined;
		if (id && app.tokens.revoke(id)) console.warn(`[decks] a browser logged out from ${who(req)}`);
		res.setHeader("Set-Cookie", loginCookie(undefined, secure(req)));
		res.json({ ok: true });
	});

	api.post("/login/everywhere", (req, res) => {
		if (req.principal?.kind !== "person" && !(app.passwordLogin && loggedIn(app, req))) return void res.status(403).json({ error: "Only the person signs everyone out." });
		const revoked = app.tokens.revokeWhere((principal, row) => principal.kind === "person" && !KEPT_EVERYWHERE.has(row.label ?? ""));
		console.warn(`[decks] every browser and terminal signed out (${revoked}), asked from ${who(req)}`);
		res.setHeader("Set-Cookie", loginCookie(undefined, secure(req)));
		res.json({ revoked });
	});

	/**
	 * Set or change the password. On this Mac, `decks password set` proves itself with the token the
	 * harness keeps for its own user (`cli-token.ts`) and needs no current password, and may take it
	 * away (`password: null`). Anyone else is the person changing it from Settings, with the current one.
	 */
	api.post("/password", (req, res) => {
		const body = (req.body ?? {}) as { password?: unknown; current?: unknown };
		const onThisMac = req.tokenId !== undefined && req.tokenId === app.cliTokenId;
		if (!onThisMac) {
			if (req.principal?.kind !== "person") return void res.status(403).json({ error: "Only the person changes the password." });
			if (!app.password.isSet) return void res.status(403).json({ error: "Set the first password on this Decks's Mac, with decks password set." });
			const from = callerOf(req.socket.remoteAddress, req.headers);
			if (app.throttle.wait(from) > 0) return void res.status(429).json({ error: "Too many wrong tries. Wait, then try again." });
			if (!app.password.check(String(body.current ?? ""))) {
				app.throttle.wrong(from);
				return void res.status(403).json({ error: "The current password is not right." });
			}
		}
		if (body.password === null) {
			if (!onThisMac) return void res.status(403).json({ error: "The password is taken away only on this Decks's Mac, with decks password remove." });
			app.password.set(null);
			const out = signOutBrowsers(app, new Set());
			console.warn(`[decks] the password was taken away on this machine; ${out} browser session(s) signed out`);
			return void res.json({ password: false });
		}
		const password = String(body.password ?? "");
		if (password.length < PASSWORD_MIN) return void res.status(400).json({ error: `A password needs at least ${PASSWORD_MIN} characters.` });
		app.password.set(password);
		// A browser that knew the old password is signed out; the one changing it from Settings stays in.
		const keep = onThisMac ? new Set<string>() : new Set([req.tokenId, app.tokens.idOf(loginCookieOf(req.headers))]);
		const out = signOutBrowsers(app, keep);
		console.warn(`[decks] the password was ${onThisMac ? "set on this machine" : `changed from Settings, from ${who(req)}`}; ${out} other browser session(s) signed out`);
		res.json({ password: true, signedOut: out });
	});

	// --- a terminal let in from a browser ------------------------------------------------------

	api.post("/login/device", (req, res) => {
		try {
			const label = String(((req.body ?? {}) as { label?: unknown }).label ?? "decks login");
			const started = app.deviceLogins.start(label === CLI_TOKEN_LABEL ? "decks login" : label);
			res.set("cache-control", "no-store").json({ ...started, url: `/login?approve=${started.code}` });
		} catch (error) {
			res.status(429).json({ error: (error as Error).message });
		}
	});

	api.get("/login/device", (req, res) => {
		const found = app.deviceLogins.find(String(req.query.code ?? ""));
		if (!found) return void res.status(404).json({ error: "That code is wrong or has run out. Run decks login again." });
		res.set("cache-control", "no-store").json(found);
	});

	api.post("/login/device/approve", (req, res) => {
		if (fromAnotherSite(req.headers)) return void res.status(403).json({ error: "Approve from this Decks's own page." });
		if (!(app.passwordLogin && loggedIn(app, req)) && !actsAsPerson(req.principal)) return void res.status(401).json({ error: "Log in first, then approve." });
		const code = String(((req.body ?? {}) as { code?: unknown }).code ?? "");
		const done = app.deviceLogins.approve(code, () => app.tokens.issue({ kind: "person" }, { label: app.deviceLogins.find(code)?.label ?? "decks login", terminal: true }).token);
		if (!done) return void res.status(404).json({ error: "That code is wrong or has run out. Run decks login again." });
		console.warn(`[decks] the terminal "${done.label}" was let in by a browser at ${who(req)}`);
		res.json(done);
	});

	api.post("/login/device/poll", (req, res) => {
		const answer = app.deviceLogins.poll(String(((req.body ?? {}) as { id?: unknown }).id ?? ""));
		if (!answer) return void res.status(410).json({ error: "This login has run out. Run decks login again." });
		res.set("cache-control", "no-store").json("token" in answer ? { token: answer.token, name: app.deck.name } : answer);
	});

	return api;
}

/** With a password set, a forwarded port (`/node/…`, `/rnode/…`) answers only a logged-in browser, or a caller with a token. */
export function lockForwards(app: Pick<LoginHost, "tokens" | "passwordLogin">) {
	return (req: Request, res: Response, next: NextFunction): void => {
		if (locked(app) && /^\/r?node\//.test(req.path) && !loggedIn(app, req) && !app.tokens.verify(bearerOf(req.headers)).ok) {
			res.status(401).type("text").send("This Decks is locked with a password. Log in at /login first.");
			return;
		}
		next();
	};
}

/** The login page (`web/src/pages/login.tsx`): open to anyone and holding nothing but the form; a browser already logged in goes on to where it was going. */
export function loginPage(app: Pick<LoginHost, "tokens" | "passwordLogin">, webDist: string) {
	return (req: Request, res: Response, next: NextFunction): void => {
		if (locked(app) && loggedIn(app, req) && !req.query.approve) {
			const to = String(req.query.next ?? "/");
			return void res.redirect(302, to.startsWith("/") && !to.startsWith("//") ? to : "/");
		}
		res.setHeader("Cache-Control", "no-store");
		res.sendFile(join(webDist, "login.html"), (error) => error && next());
	};
}
