import type { Stage } from "./stage.d.ts";

export type * from "./stage.d.ts";

/** Something Decks said went wrong: the code threw, timed out, or the person said no. */
export declare class DecksError extends Error {
	/** The HTTP status Decks answered with, when it answered. */
	status?: number;
	/** What the code `console.log`ged before it failed. */
	logs: string[];
	/** The run was cut off at Decks' 20-second limit. */
	timedOut: boolean;
}

export interface ConnectOptions {
	/** The stage code endpoint. Default: `DECKS_STAGE_URL`, or in an app's page the app's own. */
	url?: string;
	/** Its bearer token. Default: `DECKS_STAGE_TOKEN`. A page on Decks' own origin needs none. */
	token?: string;
	/** For `/api/stage/eval`: the runtime session the code acts for. Default: `DECKS_SESSION_ID`. */
	sessionID?: string;
	/** A fetch to use instead of the global one. */
	fetch?: typeof fetch;
}

export type AgentSpec = Exclude<Parameters<Stage["send"]>[0], string>;
export type Work = Parameters<Stage["send"]>[1];

export interface Decks {
	/** The endpoint this connection talks to. */
	readonly url: string;
	/**
	 * Run stage code: the body of an async function with `stage` in scope, and at an app's door
	 * `event` too, whose `value` is what you pass here. Answers with what the code returns.
	 */
	run<T = unknown>(code: string, value?: unknown): Promise<T>;
	/** Every stage verb an agent has, called over the wire. Arguments and results are JSON. */
	readonly stage: Stage;
	/** Hand work to an agent by name, or make it first with `{ name, kind }`; returns at once. */
	send(to: string | AgentSpec, work: Work | string): ReturnType<Stage["send"]>;
	/** Who is on this deck: every agent, or one project's. */
	agents(filter?: { workspace?: string }): ReturnType<Stage["agents"]>;
	/** Hand work to the agent with this name, making it from the spec first when there is none. */
	sendTo(agent: AgentSpec, work: Work | string): Promise<{ queued: true; position: number; name: string; made: boolean; agent?: string }>;
}

/** A connection to Decks; with nothing passed, the one Decks set up for this process or page. */
export declare function connect(options?: ConnectOptions): Decks;

/** A connection from the environment, made on first use. */
export declare const decks: Decks;
