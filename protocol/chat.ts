import { any, arr, bool, int, lit, named, nul, num, obj, opt, str, union, type Infer } from "./schema.ts";

export const AgentKind = named("AgentKind", lit("pi", "claude", "opencode", "opencode2", "antigravity", "codex"));
export const AgentMode = named("AgentMode", lit("manual", "acceptEdits", "plan", "auto"));

// What the harness says about a conversation, with today's shapes (moved from
// packages/protocol transcript.ts, chat.ts and usage.ts): the entries, the
// pills in a message, an agent as the chat list draws it, and accounts.

export const MessageMention = named(
	"MessageMention",
	obj({
		type: lit("mention"),
		kind: lit("comment", "card", "item", "file"),
		id: str(),
		name: str(),
		from: lit("you", "canvas"),
		label: opt(str()),
		quote: opt(str()),
		note: opt(str()),
		path: opt(str()),
		items: opt(arr(str())),
		component: opt(str()),
		exact: opt(str("The words the agent received for it.")),
	}),
	"A pill in a message: a comment, a card, a drawn item or a file, as it was put in.",
);
export const MessagePart = named("MessagePart", union(obj({ type: lit("text"), text: str() }), MessageMention), "A message as written: words and pills in order.");

const Level = lit("info", "warn", "error");
export const ChatItem = named(
	"ChatItem",
	union(
		obj({ kind: lit("user"), id: str(), text: str(), at: num(), entryId: opt(str()), parts: opt(arr(MessagePart)) }),
		obj({ kind: lit("assistant"), id: str(), text: str(), at: num(), thinking: opt(str()), streaming: opt(bool()) }),
		obj({ kind: lit("tool"), id: str(), name: str(), title: str(), args: opt(any()), result: opt(str()), full: opt(int()), images: opt(int()), state: lit("running", "done", "error") }),
		obj({ kind: lit("notice"), id: str(), level: Level, text: str(), at: num() }),
	),
	"One entry of a conversation: the person's message, the agent's reply, a tool call, or a notice.",
);

export const AgentState = named("AgentState", lit("idle", "thinking", "streaming", "tool", "waiting"));
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const ThinkingLevel = named("ThinkingLevel", lit(...THINKING_LEVELS));
export const SlashCommand = named(
	"SlashCommand",
	obj({ name: str(), hint: opt(str()), arg: opt(str()), source: opt(lit("deck", "runtime", "skill", "prompt", "extension")), aliases: opt(arr(str())) }),
);
export const ModelOption = named("ModelOption", obj({ provider: str(), model: str(), label: str(), reasoning: bool() }));
export const AgentModel = named("AgentModel", obj({ provider: str(), model: str(), thinking: ThinkingLevel }));
export const AgentUsage = named("AgentUsage", obj({ contextTokens: union(num(), nul), contextWindow: num(), cost: num() }), "Tokens in the context now (null before the first reply), the window, the cost.");
export const Identity = named("Identity", obj({ name: str(), avatar: opt(str()), color: str(), tags: opt(arr(str())), userTags: opt(arr(str())), workspace: opt(str()) }));
export const AgentChat = named(
	"AgentChat",
	obj({
		id: str(),
		name: str(),
		avatar: opt(str()),
		parentId: opt(str()),
		state: AgentState,
		lastLine: opt(str()),
		lastAt: opt(num()),
		unread: int(),
		kind: AgentKind,
		commands: opt(arr(SlashCommand)),
		mode: opt(AgentMode),
		identity: Identity,
		cards: arr(str()),
		inPlay: arr(str()),
		model: opt(AgentModel),
		account: opt(str()),
		usage: opt(AgentUsage),
		dormant: opt(lit(true)),
	}),
	"An agent as the chat list draws it. cards were called boards before.",
);
export const ClaudeAccount = named(
	"ClaudeAccount",
	obj({ id: str(), email: opt(str()), orgName: opt(str()), plan: opt(str()), isDefault: opt(lit(true)), signedIn: bool(), fiveHour: opt(obj({ percent: num(), resetsAt: opt(num()), at: num() })) }),
);

export type AgentKind = Infer<typeof AgentKind>;
export type AgentMode = Infer<typeof AgentMode>;
export type MessageMention = Infer<typeof MessageMention>;
export type MessagePart = Infer<typeof MessagePart>;
export type ChatItem = Infer<typeof ChatItem>;
export type AgentState = Infer<typeof AgentState>;
export type ThinkingLevel = Infer<typeof ThinkingLevel>;
export type SlashCommand = Infer<typeof SlashCommand>;
export type ModelOption = Infer<typeof ModelOption>;
export type AgentModel = Infer<typeof AgentModel>;
export type AgentUsage = Infer<typeof AgentUsage>;
export type Identity = Infer<typeof Identity>;
export type AgentChat = Infer<typeof AgentChat>;
export type ClaudeAccount = Infer<typeof ClaudeAccount>;
