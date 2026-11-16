/** One Decks call's answer, as the SDK's `call` gives it. */
export interface McpCallAnswer {
	value: unknown;
	notes: string[];
	images?: Array<{ data: string; mimeType: string }>;
}

export interface McpHost {
	/** The table, as `verbs.json` has it. */
	verbs: unknown[];
	/** One Decks call, as this session's caller. */
	call(name: string, args: unknown[]): Promise<McpCallAnswer>;
	/** Which calls are tools of their own: unset, the everyday ones; "all"; or groups and names. */
	tools?: string;
	/** The client said who it is: join the canvas, and answer a line for the brief. */
	joined?(client: { name?: string; title?: string; version?: string } | undefined): Promise<string | undefined>;
	/** What the client is told at connect, in place of Decks's own brief. */
	brief?: string;
	/** Add what waits for the caller to a tool's answer. */
	news?: boolean;
	skills?(): Array<{ name: string; description: string; text: string }>;
}

export interface McpSession {
	tools: Array<{ name: string }>;
	/** One JSON-RPC message's answer, or undefined for a notification. */
	handle(message: unknown): Promise<Record<string, unknown> | undefined>;
}

export const VERSION: string;
export const BRIEF: string;
export const EVERYDAY: Set<string>;
export function toolName(verb: { name: string }): string;
export function toolsFor(verbs: unknown[], wanted?: string): Array<{ name: string }>;
export function installedSkills(dir?: string): Array<{ name: string; description: string; text: string }>;
export function createMcp(host: McpHost): McpSession;
