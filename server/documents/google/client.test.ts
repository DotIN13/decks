import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../../kernel/store.ts";
import { googleFor } from "./docs.ts";
import type { Fetch } from "./client.ts";

// The Google client at a faked HTTP edge: the token endpoint, and Docs and Drive over plain
// paragraphs. The store holds client.json and token.json as today's <data>/google/ folder does.

const enc = new TextEncoder();
type Call = { url: string; method: string; body?: unknown; auth?: string };

function fakeGoogle(paragraphs: string[]) {
	const state = { text: paragraphs.map((p) => `${p}\n`).join(""), revision: 1, calls: [] as Call[], refresh: "r1" };
	const doc = () => {
		let at = 1;
		const content: unknown[] = [{ startIndex: 0, endIndex: 1, sectionBreak: {} }];
		for (const line of state.text.split(/(?<=\n)/)) {
			if (!line) continue;
			content.push({ startIndex: at, endIndex: at + line.length, paragraph: { elements: [{ startIndex: at, endIndex: at + line.length, textRun: { content: line, textStyle: {} } }], paragraphStyle: { namedStyleType: "NORMAL_TEXT" } } });
			at += line.length;
		}
		return { documentId: "doc1", title: "Field notes", revisionId: `rev${state.revision}`, body: { content } };
	};
	const answer = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
	const fetch: Fetch = async (url, init = {}) => {
		const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : undefined;
		state.calls.push({ url, method: init.method ?? "GET", body, ...(init.headers?.authorization ? { auth: init.headers.authorization } : {}) });
		if (url.startsWith("https://oauth2.googleapis.com/token")) {
			if (body.grant_type === "authorization_code") return answer(200, { refresh_token: state.refresh, access_token: "a1", expires_in: 3600, scope: "https://www.googleapis.com/auth/drive", id_token: `x.${btoa(JSON.stringify({ email: "ann@example.com" }))}.y` });
			if (body.refresh_token !== state.refresh) return answer(400, { error: "invalid_grant" });
			return answer(200, { access_token: "a2", expires_in: 3600 });
		}
		if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return answer(200, { files: [{ id: "doc1", name: "Field notes", modifiedTime: "2026-11-15T10:00:00Z", owners: [{ me: true }] }] });
		if (url.endsWith(":batchUpdate")) {
			if (body.writeControl?.requiredRevisionId !== `rev${state.revision}`) return answer(400, { error: { message: "The required revision does not match." } });
			for (const r of body.requests as Array<Record<string, any>>) {
				if (r.insertText) state.text = state.text.slice(0, r.insertText.location.index - 1) + r.insertText.text + state.text.slice(r.insertText.location.index - 1);
				if (r.deleteContentRange) state.text = state.text.slice(0, r.deleteContentRange.range.startIndex - 1) + state.text.slice(r.deleteContentRange.range.endIndex - 1);
			}
			state.revision++;
			return answer(200, { writeControl: { requiredRevisionId: `rev${state.revision}` } });
		}
		if (url.startsWith("https://docs.googleapis.com/v1/documents/doc1")) return answer(200, doc());
		return answer(404, { error: { message: "not found" } });
	};
	return { state, fetch };
}

const signedOut = () => new MemoryStore();
async function signedIn(access = { access_token: "a1", expires_at: Date.now() + 3_600_000 }) {
	const store = new MemoryStore();
	await store.put("client.json", enc.encode(JSON.stringify({ web: { client_id: "c", client_secret: "s" } })));
	await store.put("token.json", enc.encode(JSON.stringify({ refresh_token: "r1", email: "ann@example.com", ...access })));
	return store;
}

test("a sign-in kept in today's token.json stays signed in; none set up is not connected", async () => {
	const { fetch } = fakeGoogle(["x"]);
	assert.deepEqual(await googleFor(await signedIn(), fetch).google.status(), { connected: true, email: "ann@example.com" });
	assert.deepEqual(await googleFor(signedOut(), fetch).google.status(), { connected: false });
	await assert.rejects(googleFor(signedOut(), fetch).docs.read("doc1"), { code: "unavailable" });
});

test("signing in: the address Google sends back is traded for a token, kept in token.json", async () => {
	const { fetch } = fakeGoogle(["x"]);
	const store = await signedIn();
	await store.delete("token.json");
	const g = googleFor(store, fetch);
	const to = new URL(await g.signIn.signInUrl("http://127.0.0.1:4640"));
	assert.equal(to.searchParams.get("redirect_uri"), "http://127.0.0.1:4640/api/google/callback");
	const back = `http://127.0.0.1:4640/api/google/callback?code=abc&state=${to.searchParams.get("state")}`;
	assert.deepEqual(await g.google.connect(back), { connected: true, email: "ann@example.com" });
	assert.match(new TextDecoder().decode(await store.get("token.json")), /"refresh_token": "r1"/);
	await assert.rejects(g.google.connect(back), { code: "refused" });
	assert.deepEqual(await g.google.disconnect(), { connected: false });
});

test("an expired access token is renewed; a revoked grant signs out", async () => {
	const { fetch, state } = fakeGoogle(["Hello"]);
	const store = await signedIn({ access_token: "old", expires_at: 0 });
	const g = googleFor(store, fetch);
	await g.docs.read("doc1");
	assert.equal(state.calls.find((c) => c.url.includes("docs.googleapis"))?.auth, "Bearer a2");
	state.refresh = "other";
	await store.put("token.json", enc.encode(JSON.stringify({ refresh_token: "r1", access_token: "old", expires_at: 0 })));
	await assert.rejects(g.docs.read("doc1"), { code: "unavailable" });
	assert.equal(await store.get("token.json"), undefined);
});

test("the mirror's text is index-aligned, and its splices reach the Doc as Docs requests", async () => {
	const { fetch, state } = fakeGoogle(["Hello world", "Second"]);
	const g = googleFor(await signedIn(), fetch);
	const read = await g.docs.read("doc1");
	assert.equal(read.text, "Hello world\nSecond\n");
	const at = read.text.indexOf("world");
	const wrote = await g.docs.write("doc1", [{ at, before: "world", text: "there" }], read.revision);
	assert.equal(state.text, "Hello there\nSecond\n");
	assert.equal(wrote.revision, "rev2");
	await assert.rejects(g.docs.write("doc1", [], read.revision), { code: "conflict" });
	assert.deepEqual(await g.docs.list("field"), [{ id: "doc1", title: "Field notes", url: "https://docs.google.com/document/d/doc1/edit", modified: Date.parse("2026-11-15T10:00:00Z") }]);
});

test("agents read the Doc as markdown and edit it by markdown", async () => {
	const { fetch, state } = fakeGoogle(["Hello world", "Second"]);
	const g = googleFor(await signedIn(), fetch);
	const md = await g.docs.markdown("doc1");
	assert.equal(md.title, "Field notes");
	assert.match(md.text, /Hello world\n\nSecond/);
	await g.docs.writeMarkdown("doc1", md.text.replace("Second", "Second line"), md.revision);
	assert.equal(state.text, "Hello world\nSecond line\n");
});
