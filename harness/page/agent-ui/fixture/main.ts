import { mountAgentUi, setToolResultSender, receiveToolResult, type AgentUiMount } from "../index.ts";

// The entry mounted alone, by a fake host that records what the parts hand it; the mount test reads
// window.agentUi.

type Seen = { notices: string[]; sent: Array<{ text: string; comments: string[] }>; asked: string[] };
const seen: Seen = { notices: [], sent: [], asked: [] };
(window as unknown as { agentUi: Seen }).agentUi = seen;

setToolResultSender((item) => {
	seen.asked.push(item);
	setTimeout(() => receiveToolResult(item, "the whole result, ".repeat(40)), 10);
	return true;
});

const mount: AgentUiMount = {
	host: { notice: (level, text) => seen.notices.push(`${level}: ${text}`) },
	stream: {
		shown: true,
		items: [
			{ kind: "user", id: "u1", text: "Draw the plan", at: 1, entryId: "e1" },
			{ kind: "tool", id: "t1", name: "decks", title: "canvas insert", state: "done", result: "inserted…", full: 760 },
			{ kind: "assistant", id: "a1", text: "I drew **the plan**.", at: 2 },
		],
		agentId: "a",
		more: false,
		onEarlier: async () => 0,
		state: "idle",
		name: "Ada",
		agent: "claude",
		onPreview: () => {},
		onRewind: () => {},
		onFork: () => {},
		onRestore: () => {},
	},
	composer: {
		busy: false,
		model: undefined,
		models: [],
		commands: [],
		modes: [],
		mode: undefined,
		onMode: () => {},
		onSend: (text, comments) => seen.sent.push({ text, comments }),
		onAbort: () => {},
		onModel: () => {},
		onThinking: () => {},
		draft: undefined,
		usage: { contextTokens: 50_000, contextWindow: 200_000, cost: 0.1 },
		onUsage: () => {},
		agentId: "a",
		page: "agent:a@plan",
	},
};
mountAgentUi(document.getElementById("root")!, mount);
