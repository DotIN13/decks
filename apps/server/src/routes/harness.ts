import { sttReady } from "../stt.ts";
import { STT_MODELS } from "@decks/protocol";
import { asyncRoute, harnessVersion, type RouteDeps } from "./shared.ts";
import type { Router } from "express";

/**
 * This harness's own settings and the front ends, extension and Claude accounts it holds, for another front end's settings page.
 */
export function register(api: Router, { app }: RouteDeps): void {
	/**
	 * This harness's own settings, for another front end's settings page (Studio's harness page):
	 * the machine (deck folder, timezone, version), what its agents run on (runtimes, Claude accounts,
	 * the server's speech model) and who reaches it (the front ends paired, whether a code is asked
	 * for, the Decks extension). What this app's own Settings shows over its socket, read in one call.
	 */
	api.get(
		"/harness",
		asyncRoute(async (req, res) => {
			let accounts: { accounts?: unknown[]; active?: string } = {};
			await app.publishAccounts((frame) => frame.type === "claude.accounts" && (accounts = frame));
			const settings = app.settings.get();
			const you = req.tokenId;
			res.set("cache-control", "no-store").json({
				name: app.deck.name,
				deck: app.deck.path,
				version: harnessVersion(),
				timezone: settings.timezone ?? null,
				machineZone: app.settings.machineZone(),
				sttModel: settings.sttModel ?? STT_MODELS[0]!.id,
				sttModels: STT_MODELS.map((one) => ({ id: one.id, label: one.label ?? one.id })),
				sttKey: sttReady(),
				runtimes: app.runtimes().map((one) => ({ kind: one.kind, label: one.label, available: one.available, ...(one.reason ? { reason: one.reason } : {}), models: one.models?.length ?? 0 })),
				accounts: accounts.accounts ?? [],
				paired: app.tokens.paired().map((one) => ({ ...one, ...(one.id === you ? { you: true } : {}) })),
				requireCode: app.codes.required,
				requireCodeForced: app.codes.forced,
				extension: { status: app.web.status() },
			});
		}),
	);

	/** Change them: `{ timezone, sttModel, requireCode }`, each only when named; the answer is the whole page again. */
	api.post("/harness", (req, res) => {
		const body = (req.body ?? {}) as { timezone?: unknown; sttModel?: unknown; requireCode?: unknown };
		const refused: string[] = [];
		if (body.timezone !== undefined) {
			const outcome = app.setTimezone(typeof body.timezone === "string" ? body.timezone : null);
			if (outcome) refused.push(outcome.error);
		}
		if (body.sttModel !== undefined) {
			const outcome = app.setSttModel(typeof body.sttModel === "string" ? body.sttModel : null);
			if (outcome) refused.push(outcome.error);
		}
		if (typeof body.requireCode === "boolean") {
			if (app.codes.forced && !body.requireCode) refused.push("This harness was started with DECKS_REQUIRE_PAIR_CODE, so a code is always asked for.");
			else app.codes.setRequired(body.requireCode);
		}
		if (refused.length) res.status(400).json({ error: refused.join(" ") });
		else res.json({ ok: true });
	});

	/** Take a paired front end's token back; the one asking may take back its own, and is then unpaired. */
	api.post("/harness/paired/:id/revoke", (req, res) => {
		const id = String(req.params.id);
		if (!app.tokens.paired().some((one) => one.id === id) || !app.tokens.revoke(id)) {
			res.status(404).json({ error: "No front end with that id is paired here." });
			return;
		}
		app.send(app.pairingMessage());
		res.json({ revoked: true });
	});

	/** A fresh code for the Decks extension: the old one stops working. */
	api.post("/harness/extension/code", (_req, res) => {
		res.json({ code: app.web.repair() });
	});

	/** Forget a Claude account this harness signed in to; its own login stays. */
	api.post("/harness/accounts/:id/forget", (req, res) => {
		app.claudeAccounts.forget(String(req.params.id));
		void app.publishAccounts();
		res.json({ forgotten: true });
	});
}
