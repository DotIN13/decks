import type { Answerer } from "@decks/sdk";
import type { Sessions, Session } from "../sessions/index.ts";
import type { Settings } from "./settings.ts";
import { runtimeList, runtimeOf } from "./registry.ts";
import type { ModelOption, RunKind } from "./types/index.ts";

// The runtime calls the server passes to this harness: which kinds it runs,
// and the settings pages, its own and each agent's.

type Tell = (name: string, payload: unknown) => void;
const PREVIEW = 160;
const modelName = (one: ModelOption): string => `${one.provider}/${one.model}`;

export function runtimeAnswers(sessions: Sessions, settings: Settings, tell: Tell): Record<string, Answerer> {
	const known = (kind: RunKind) => sessions.transcripts.knownModels(kind);
	return {
		"runtime.list": () => runtimeList(known).map((one) => ({ kind: one.kind, available: one.available, ...(one.reason ? { reason: one.reason } : {}), models: one.models.map(modelName) })),
		"runtime.get": (args) => (typeof args.agent === "string" ? agentPage(sessions.require(args.agent), sessions) : { ...settings.get(), kinds: runtimeList(known) }),
		"runtime.update": (args) => {
			if (args.sttModel !== undefined) settings.setSttModel(args.sttModel as string | null);
			tell("runtime.changed", { ids: [], by: "harness", rev: Date.now() });
			return { ...settings.get(), kinds: runtimeList(known) };
		},
	};
}

/** One agent's page: its model, modes, usage, account, commands, queue and open questions. */
export function agentPage(session: Session, sessions: Sessions) {
	const runtime = runtimeOf(session.spec.kind);
	const backend = session.backend;
	const last = session.translator.lastLine();
	const model = backend?.model() ?? session.snapshot().model;
	return {
		agent: session.id,
		kind: session.spec.kind,
		state: session.state,
		...(model ? { model } : {}),
		...(backend?.mode?.() ? { mode: backend.mode() } : {}),
		modes: runtime?.capabilities.modes ?? [],
		models: sessions.transcripts.knownModels(session.spec.kind),
		...(session.usage ? { usage: session.usage } : {}),
		...(session.account ? { account: session.account } : {}),
		commands: backend?.commands() ?? runtime?.commands ?? [],
		...(last ? { lastLine: last.text.slice(0, PREVIEW), lastAt: last.at } : {}),
		...(session.dormant ? { dormant: true } : {}),
		...(session.failure ? { failure: session.failure } : {}),
		queued: session.queues.view(),
		dialogs: session.bridge.outstanding(),
	};
}
