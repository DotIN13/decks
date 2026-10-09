import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GoogleError, type DocsApi, type DocsBatchResult, type DocsComment, type DocsDocument, type DocsListed, type DocsRequest, type DocsWriteControl } from "@decks/docs/gdoc";

/**
 * Signing in to Google as the person, and the two Docs API calls a document page makes.
 *
 * The OAuth client is the person's own: a Google Cloud project with the Docs API on, whose client
 * file (the JSON Google offers to download) is put at `<data>/google/client.json`. A "Web
 * application" client sends the browser back to this server; a "Desktop app" client sends it to a
 * loopback address that does not load, and the person pastes that address back into Decks. Either
 * way the refresh token is kept at `<data>/google/token.json`, beside the client, on this machine
 * and nowhere else. Docs is asked for, for the text, and Drive, for the comments Google keeps on the
 * file; the Drive API has to be turned on in the project too.
 */

/** Docs for the text; Drive for comments, which Google keeps on the file rather than in the Doc. */
const SCOPES = ["https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive", "openid", "email"];
const DRIVE = "https://www.googleapis.com/auth/drive";
const LOOPBACK = "http://127.0.0.1:8977/";

interface ClientFile {
	client_id: string;
	client_secret: string;
	kind: "web" | "installed";
}

interface TokenFile {
	refresh_token: string;
	/** The permissions granted, space-separated, as Google answered them. */
	scope?: string;
	access_token?: string;
	expires_at?: number;
	email?: string;
}

export interface GoogleStatus {
	/** "fake" when this server talks to the stand-in, not Google. */
	mode: "google" | "fake";
	/** The client file is in place. */
	client: boolean;
	signedIn: boolean;
	email?: string;
	/** For a Desktop client: the address has to be pasted back. */
	paste?: boolean;
	/** Drive was granted, so comments can be read and written; a sign-in from before it was asked for has not. */
	comments?: boolean;
}

export class GoogleAuth {
	private pending = new Map<string, { redirect: string; at: number }>();

	constructor(readonly dir: string) {}

	private read<T>(name: string): T | undefined {
		try {
			return JSON.parse(readFileSync(join(this.dir, name), "utf8")) as T;
		} catch {
			return undefined;
		}
	}

	client(): ClientFile | undefined {
		const raw = this.read<{ web?: { client_id?: string; client_secret?: string }; installed?: { client_id?: string; client_secret?: string } }>("client.json");
		const kind = raw?.web ? "web" : raw?.installed ? "installed" : undefined;
		const body = kind ? raw![kind]! : undefined;
		return kind && body?.client_id && body.client_secret ? { client_id: body.client_id, client_secret: body.client_secret, kind } : undefined;
	}

	private token(): TokenFile | undefined {
		return this.read<TokenFile>("token.json");
	}

	status(): Omit<GoogleStatus, "mode"> {
		const client = this.client();
		const token = this.token();
		return { client: !!client, signedIn: !!client && !!token?.refresh_token, ...(token?.email ? { email: token.email } : {}), ...(client?.kind === "installed" ? { paste: true } : {}), comments: !!token?.scope?.split(" ").includes(DRIVE) };
	}

	/** Where to send the browser to sign in; `origin` is this server as the browser reaches it. */
	signInUrl(origin: string): string {
		const client = this.client();
		if (!client) throw new Error(`No Google client is set up: put the OAuth client file from your Google Cloud project at ${join(this.dir, "client.json")}.`);
		const redirect = client.kind === "web" ? `${origin}/api/google/callback` : LOOPBACK;
		const state = randomBytes(12).toString("base64url");
		this.pending.set(state, { redirect, at: Date.now() });
		const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", state, include_granted_scopes: "true" });
		return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
	}

	/** The code Google sent back, for the sign-in this server started; a pasted address works too. */
	async finish(input: { code?: string; state?: string; url?: string }): Promise<string> {
		let { code, state } = input;
		if (input.url) {
			const url = new URL(input.url.trim());
			code = url.searchParams.get("code") ?? undefined;
			state = url.searchParams.get("state") ?? undefined;
			const error = url.searchParams.get("error");
			if (error) throw new Error(`Google said: ${error}.`);
		}
		const started = state ? this.pending.get(state) : undefined;
		if (!code || !started || Date.now() - started.at > 15 * 60_000) throw new Error("That sign-in was not started here, or took longer than 15 minutes. Start it again.");
		this.pending.delete(state!);
		const client = this.client()!;
		const response = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ code, client_id: client.client_id, client_secret: client.client_secret, redirect_uri: started.redirect, grant_type: "authorization_code" }),
		});
		const body = (await response.json()) as { refresh_token?: string; access_token?: string; expires_in?: number; id_token?: string; scope?: string; error_description?: string; error?: string };
		if (!response.ok || !body.refresh_token) throw new Error(`Google refused the sign-in: ${body.error_description ?? body.error ?? response.status}.`);
		const email = emailOf(body.id_token);
		this.save({ refresh_token: body.refresh_token, ...(body.scope ? { scope: body.scope } : {}), ...(body.access_token ? { access_token: body.access_token, expires_at: Date.now() + (body.expires_in ?? 3600) * 1000 } : {}), ...(email ? { email } : {}) });
		return email ?? "your Google account";
	}

	signOut(): void {
		rmSync(join(this.dir, "token.json"), { force: true });
	}

	private save(token: TokenFile): void {
		mkdirSync(this.dir, { recursive: true });
		writeFileSync(join(this.dir, "token.json"), JSON.stringify(token, null, "\t"), { mode: 0o600 });
	}

	/** A live access token, refreshed when it is about to run out. */
	async accessToken(): Promise<string> {
		const client = this.client();
		const token = this.token();
		if (!client || !token?.refresh_token) throw new GoogleError(401, "Decks is not signed in to Google.");
		if (token.access_token && (token.expires_at ?? 0) > Date.now() + 60_000) return token.access_token;
		const response = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ refresh_token: token.refresh_token, client_id: client.client_id, client_secret: client.client_secret, grant_type: "refresh_token" }),
		});
		const body = (await response.json()) as { access_token?: string; expires_in?: number; error?: string };
		if (!response.ok || !body.access_token) {
			// A revoked or expired grant: signed out, so the page offers to sign in again.
			if (body.error === "invalid_grant") this.signOut();
			throw new GoogleError(401, `Google would not renew the sign-in (${body.error ?? response.status}). Sign in again.`);
		}
		this.save({ ...token, access_token: body.access_token, expires_at: Date.now() + (body.expires_in ?? 3600) * 1000 });
		return body.access_token;
	}
}

function emailOf(idToken: string | undefined): string | undefined {
	try {
		const payload = JSON.parse(Buffer.from(idToken!.split(".")[1]!, "base64url").toString("utf8")) as { email?: string };
		return payload.email;
	} catch {
		return undefined;
	}
}

/** The Docs API itself, signed in as the person. */
export class GoogleDocsApi implements DocsApi {
	constructor(private readonly auth: GoogleAuth) {}

	private async call<T>(path: string, init?: { method: string; body: unknown }): Promise<T> {
		const token = await this.auth.accessToken();
		const response = await fetch(`https://docs.googleapis.com/v1/documents/${path}`, {
			method: init?.method ?? "GET",
			headers: { authorization: `Bearer ${token}`, ...(init ? { "content-type": "application/json" } : {}) },
			...(init ? { body: JSON.stringify(init.body) } : {}),
		});
		const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
		if (!response.ok) throw new GoogleError(response.status, body.error?.message ?? `Google answered ${response.status}.`);
		return body;
	}

	get(id: string): Promise<DocsDocument> {
		return this.call<DocsDocument>(encodeURIComponent(id));
	}

	batchUpdate(id: string, requests: DocsRequest[], writeControl?: DocsWriteControl): Promise<DocsBatchResult> {
		return this.call<DocsBatchResult>(`${encodeURIComponent(id)}:batchUpdate`, { method: "POST", body: { requests, ...(writeControl ? { writeControl } : {}) } });
	}

	private async drive<T>(path: string, init?: { method: string; body: unknown }): Promise<T> {
		const token = await this.auth.accessToken();
		const response = await fetch(`https://www.googleapis.com/drive/v3/files${path.startsWith("?") ? "" : "/"}${path}`, {
			method: init?.method ?? "GET",
			headers: { authorization: `Bearer ${token}`, ...(init ? { "content-type": "application/json" } : {}) },
			...(init ? { body: JSON.stringify(init.body) } : {}),
		});
		const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
		if (!response.ok) throw new GoogleError(response.status, body.error?.message ?? `Google Drive answered ${response.status}.`);
		return body;
	}

	async list(query?: string): Promise<DocsListed[]> {
		// Drive's query language quotes with single quotes, and a backslash escapes one.
		const name = query?.trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
		const q = `mimeType='application/vnd.google-apps.document' and trashed=false${name ? ` and name contains '${name}'` : ""}`;
		const params = new URLSearchParams({ q, pageSize: "50", orderBy: name ? "modifiedTime desc" : "viewedByMeTime desc", fields: "files(id,name,modifiedTime,owners(displayName,me))", includeItemsFromAllDrives: "true", supportsAllDrives: "true", corpora: "allDrives" });
		const body = await this.drive<{ files?: Array<{ id: string; name?: string; modifiedTime?: string; owners?: Array<{ displayName?: string; me?: boolean }> }> }>(`?${params}`);
		return (body.files ?? []).map((file) => {
			const owner = file.owners?.find((one) => !one.me)?.displayName;
			return { id: file.id, title: file.name || "Untitled document", ...(file.modifiedTime ? { modified: file.modifiedTime } : {}), ...(owner && !file.owners?.some((one) => one.me) ? { owner } : {}) };
		});
	}

	async comments(id: string): Promise<DocsComment[]> {
		const fields = "comments(id,content,author(displayName,photoLink,me),createdTime,resolved,quotedFileContent,replies(id,content,author(displayName,photoLink,me),createdTime,action)),nextPageToken";
		const out: DocsComment[] = [];
		let page: string | undefined;
		do {
			const body = await this.drive<{ comments?: DocsComment[]; nextPageToken?: string }>(`${encodeURIComponent(id)}/comments?pageSize=100&fields=${encodeURIComponent(fields)}${page ? `&pageToken=${page}` : ""}`);
			out.push(...(body.comments ?? []));
			page = body.nextPageToken;
		} while (page && out.length < 1000);
		return out.filter((c) => !c.resolved);
	}

	async comment(id: string, content: string, quote: string): Promise<void> {
		await this.drive(`${encodeURIComponent(id)}/comments?fields=id`, { method: "POST", body: { content, ...(quote ? { quotedFileContent: { mimeType: "text/plain", value: quote } } : {}) } });
	}

	async reply(id: string, commentId: string, content: string, action?: "resolve" | "reopen"): Promise<void> {
		await this.drive(`${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}/replies?fields=id`, { method: "POST", body: { content: content || (action === "resolve" ? "Resolved" : ""), ...(action ? { action } : {}) } });
	}
}

/** The Doc's id from anything a person might paste: its address, or the id alone. */
export function docIdOf(input: string): string | undefined {
	const text = input.trim();
	const fromUrl = /\/document\/(?:u\/\d+\/)?d\/([\w-]{10,})/.exec(text)?.[1];
	if (fromUrl) return fromUrl;
	return /^[\w-]{10,}$/.test(text) ? text : undefined;
}

export const googleDir = (dataDir: string) => join(dataDir, "google");
export const fakeMode = (dataDir: string) => process.env.DECKS_GOOGLE === "fake" || existsSync(join(googleDir(dataDir), "fake", ".on"));
