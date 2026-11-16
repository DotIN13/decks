import { Refused } from "../../../protocol/index.ts";
import type { Store } from "../../kernel/types.ts";
import type { DocsBatchResult, DocsDocument, DocsListed, DocsRequest, DocsWriteControl } from "./types.ts";

// Signing in to Google as the person, and the Docs and Drive calls this server makes. The OAuth
// client is the person's own (client.json, as Google offers it) and the refresh token is token.json,
// both in a store the server's entry gives: today's <data>/google/, so a sign-in survives an upgrade.

const SCOPES = ["https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive", "openid", "email"];
const DRIVE = "https://www.googleapis.com/auth/drive";
const LOOPBACK = "http://127.0.0.1:8977/";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type ClientFile = { client_id: string; client_secret: string; kind: "web" | "installed" };
type TokenFile = { refresh_token: string; scope?: string; access_token?: string; expires_at?: number; email?: string };
export type SignIn = { connected: boolean; email?: string; client: boolean; paste?: boolean; comments?: boolean };

/** Google's sign-in, kept in a store; fetch and the clock are given, so tests fake the edge. */
export class GoogleSignIn {
	private pending = new Map<string, { redirect: string; at: number }>();

	constructor(
		private readonly store: Store,
		private readonly fetch: Fetch,
		private readonly now: () => number = Date.now,
	) {}

	private async read<T>(key: string): Promise<T | undefined> {
		const bytes = await this.store.get(key);
		try {
			return bytes ? (JSON.parse(decoder.decode(bytes)) as T) : undefined;
		} catch {
			return undefined;
		}
	}

	async client(): Promise<ClientFile | undefined> {
		const raw = await this.read<{ web?: { client_id?: string; client_secret?: string }; installed?: { client_id?: string; client_secret?: string } }>("client.json");
		const kind = raw?.web ? "web" : raw?.installed ? "installed" : undefined;
		const body = kind ? raw![kind]! : undefined;
		return kind && body?.client_id && body.client_secret ? { client_id: body.client_id, client_secret: body.client_secret, kind } : undefined;
	}

	async status(): Promise<SignIn> {
		const client = await this.client();
		const token = await this.read<TokenFile>("token.json");
		const connected = !!client && !!token?.refresh_token;
		return { connected, client: !!client, ...(token?.email && connected ? { email: token.email } : {}), ...(client?.kind === "installed" ? { paste: true } : {}), comments: !!token?.scope?.split(" ").includes(DRIVE) };
	}

	/** Where to send the browser to sign in; origin is this server as the browser reaches it. */
	async signInUrl(origin: string): Promise<string> {
		const client = await this.client();
		if (!client) throw new Refused("unavailable", "No Google client is set up: put your Google Cloud project's OAuth client file in the server's google folder as client.json.", "google.status");
		const redirect = client.kind === "web" ? `${origin}/api/google/callback` : LOOPBACK;
		const state = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
		this.pending.set(state, { redirect, at: this.now() });
		const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", state, include_granted_scopes: "true" });
		return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
	}

	/** Finish a sign-in this server started, from the address Google sent the browser to. */
	async finish(address: string): Promise<SignIn> {
		const url = new URL(address.trim());
		if (url.searchParams.get("error")) throw new Refused("refused", `Google said: ${url.searchParams.get("error")}.`, "google.connect");
		const code = url.searchParams.get("code") ?? undefined;
		const state = url.searchParams.get("state") ?? undefined;
		const started = state ? this.pending.get(state) : undefined;
		if (!code || !started || this.now() - started.at > 15 * 60_000) throw new Refused("refused", "That sign-in was not started here, or took longer than 15 minutes. Start it again.", "google.connect");
		this.pending.delete(state!);
		const client = (await this.client())!;
		const body = await this.token({ code, client_id: client.client_id, client_secret: client.client_secret, redirect_uri: started.redirect, grant_type: "authorization_code" });
		if (!body.refresh_token) throw new Refused("refused", `Google refused the sign-in: ${body.error_description ?? body.error ?? "no refresh token"}.`, "google.connect");
		const email = emailOf(body.id_token);
		await this.save({ refresh_token: body.refresh_token, ...(body.scope ? { scope: body.scope } : {}), ...(body.access_token ? { access_token: body.access_token, expires_at: this.now() + (body.expires_in ?? 3600) * 1000 } : {}), ...(email ? { email } : {}) });
		return this.status();
	}

	async signOut(): Promise<SignIn> {
		await this.store.delete("token.json");
		return this.status();
	}

	/** A live access token, renewed a minute before it runs out; a revoked grant signs out. */
	async accessToken(): Promise<string> {
		const client = await this.client();
		const token = await this.read<TokenFile>("token.json");
		if (!client || !token?.refresh_token) throw new Refused("unavailable", "Decks is not signed in to Google.", "google.status");
		if (token.access_token && (token.expires_at ?? 0) > this.now() + 60_000) return token.access_token;
		const body = await this.token({ refresh_token: token.refresh_token, client_id: client.client_id, client_secret: client.client_secret, grant_type: "refresh_token" });
		if (!body.access_token) {
			if (body.error === "invalid_grant") await this.store.delete("token.json");
			throw new Refused("unavailable", `Google would not renew the sign-in (${body.error ?? "no token"}). Sign in again.`, "google.status");
		}
		await this.save({ ...token, access_token: body.access_token, expires_at: this.now() + (body.expires_in ?? 3600) * 1000 });
		return body.access_token;
	}

	private async token(form: Record<string, string>): Promise<{ refresh_token?: string; access_token?: string; expires_in?: number; id_token?: string; scope?: string; error?: string; error_description?: string }> {
		const response = await this.fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
		return (await response.json().catch(() => ({}))) as Awaited<ReturnType<GoogleSignIn["token"]>>;
	}

	private save(token: TokenFile): Promise<void> {
		return this.store.put("token.json", encoder.encode(JSON.stringify(token, null, "\t")));
	}
}

function emailOf(idToken: string | undefined): string | undefined {
	try {
		const part = idToken!.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
		return (JSON.parse(decoder.decode(Uint8Array.from(atob(part), (c) => c.charCodeAt(0)))) as { email?: string }).email;
	} catch {
		return undefined;
	}
}

/** The Docs and Drive calls, signed in as the person. A Google error is unavailable, with its words. */
export class GoogleApi {
	constructor(
		private readonly signIn: GoogleSignIn,
		private readonly fetch: Fetch,
	) {}

	private async call<T>(url: string, init?: { method: string; body: unknown }): Promise<T> {
		const token = await this.signIn.accessToken();
		const response = await this.fetch(url, { method: init?.method ?? "GET", headers: { authorization: `Bearer ${token}`, ...(init ? { "content-type": "application/json" } : {}) }, ...(init ? { body: JSON.stringify(init.body) } : {}) });
		const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
		if (response.status === 400 && /revision/i.test(body.error?.message ?? "")) throw new Refused("conflict", "The Doc changed since it was read.", "google.read");
		if (!response.ok) throw new Refused(response.status === 404 ? "not_found" : "unavailable", body.error?.message ?? `Google answered ${response.status}.`, "google.status");
		return body;
	}

	get(id: string): Promise<DocsDocument> {
		return this.call(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}`);
	}

	batchUpdate(id: string, requests: DocsRequest[], writeControl?: DocsWriteControl): Promise<DocsBatchResult> {
		return this.call(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}:batchUpdate`, { method: "POST", body: { requests, ...(writeControl ? { writeControl } : {}) } });
	}

	/** The person's Docs, by name when a query is given, newest first. */
	async list(query?: string): Promise<DocsListed[]> {
		const name = query?.trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
		const q = `mimeType='application/vnd.google-apps.document' and trashed=false${name ? ` and name contains '${name}'` : ""}`;
		const params = new URLSearchParams({ q, pageSize: "50", orderBy: name ? "modifiedTime desc" : "viewedByMeTime desc", fields: "files(id,name,modifiedTime,owners(displayName,me))", includeItemsFromAllDrives: "true", supportsAllDrives: "true", corpora: "allDrives" });
		const body = await this.call<{ files?: Array<{ id: string; name?: string; modifiedTime?: string; owners?: Array<{ displayName?: string; me?: boolean }> }> }>(`https://www.googleapis.com/drive/v3/files?${params}`);
		return (body.files ?? []).map((file) => {
			const owner = file.owners?.find((one) => !one.me)?.displayName;
			return { id: file.id, title: file.name || "Untitled document", ...(file.modifiedTime ? { modified: file.modifiedTime } : {}), ...(owner && !file.owners?.some((one) => one.me) ? { owner } : {}) };
		});
	}
}
