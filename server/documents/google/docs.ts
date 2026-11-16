import { Refused } from "../../../protocol/index.ts";
import type { Store } from "../../kernel/types.ts";
import type { GoogleAccount, GoogleDocs } from "../google.ts";

import { applyAll, type Splice } from "../splice.ts";
import { GoogleApi, GoogleSignIn, type Fetch } from "./client.ts";
import { signInRoutes } from "./routes.ts";
import type { Route } from "../../kernel/types.ts";
import { docToMarkdown } from "./markdown.ts";
import { plan } from "./plan.ts";
import { docUnits, segmentEnds, unitRequests } from "./units.ts";
import type { DocsRequest } from "./types.ts";

// The documents feature's Google parts made from one store: the sign-in, and the Docs API as the
// mirror's index-aligned text and as agents' markdown. The one maker the server's entry calls.

export type Google = { google: GoogleAccount; docs: GoogleDocs; signIn: GoogleSignIn; routes: Route[] };

/** Google for documents: its sign-in kept in store (today's <data>/google/), fetch faked in tests. */
export function googleFor(store: Store, fetch: Fetch = globalThis.fetch as unknown as Fetch): Google {
	const signIn = new GoogleSignIn(store, fetch);
	const api = new GoogleApi(signIn, fetch);
	const account: GoogleAccount = {
		status: async () => brief(await signIn.status()),
		connect: async (url) => brief(await signIn.finish(url)),
		disconnect: async () => brief(await signIn.signOut()),
	};
	const docs: GoogleDocs = {
		async read(id) {
			const doc = await api.get(id);
			return { text: docUnits(doc), revision: doc.revisionId ?? "" };
		},
		async write(id, splices: Splice[], revision) {
			const doc = await api.get(id);
			if ((doc.revisionId ?? "") !== revision) throw new Refused("conflict", "The Doc changed since it was read.", "google.read");
			const from = docUnits(doc);
			const to = applyAll(from, splices);
			if (to === undefined) throw new Refused("conflict", "Those edits do not fit the Doc as it is now.", "google.read");
			const { requests } = unitRequests(from, to, segmentEnds(doc));
			if (requests.length) await api.batchUpdate(id, requests, { requiredRevisionId: revision });
			return { revision: (await api.get(id)).revisionId ?? "" };
		},
		list: async (query) => (await api.list(query)).map((one) => ({ id: one.id, title: one.title, url: `https://docs.google.com/document/d/${one.id}/edit`, ...(one.modified ? { modified: Date.parse(one.modified) } : {}) })),
		title: async (id) => (await api.get(id)).title ?? "Untitled document",
		async markdown(id) {
			const doc = await api.get(id);
			return { text: docToMarkdown(doc), revision: doc.revisionId ?? "", ...(doc.title ? { title: doc.title } : {}) };
		},
		document: (id) => api.get(id),
		async style(id, requests) {
			if (requests.length) await api.batchUpdate(id, requests as DocsRequest[]);
		},
		comments: async (id) => (await api.comments(id)).map((c) => ({ ...c, ...(typeof (c.quotedFileContent as { value?: string } | undefined)?.value === "string" ? { quote: (c.quotedFileContent as { value: string }).value } : {}) })),
		comment: (id, action, fields) => api.comment(id, action, fields),
		async writeMarkdown(id, markdown, revision) {
			const doc = await api.get(id);
			if ((doc.revisionId ?? "") !== revision) throw new Refused("conflict", "The Doc changed since it was read.", "google.read");
			const requests = plan(doc, markdown);
			if (requests.length) await api.batchUpdate(id, requests, { requiredRevisionId: revision });
		},
	};
	return { google: account, docs, signIn, routes: signInRoutes(signIn) };
}

const brief = (state: { connected: boolean; email?: string }) => ({ connected: state.connected, ...(state.email ? { email: state.email } : {}) });
