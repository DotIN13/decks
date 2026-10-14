/**
 * @decks/sdk — control Decks from a program that is not an agent: an app, an MCP server, a script.
 *
 * Everything goes through one door, Decks' stage code endpoint, so a program gets the same `stage`
 * an agent has (`runtime/stage.d.ts`) without Decks growing a second API to keep in step:
 *
 *     import { connect } from "@decks/sdk";
 *     const decks = connect();                       // from DECKS_STAGE_URL and DECKS_STAGE_TOKEN
 *     const boards = await decks.stage.boards();     // any stage verb, typed
 *     await decks.stage.send("Labeler", { task: "Label doc-7" });
 *     const n = await decks.run("return (await stage.agents()).length");   // or code of your own
 *
 * A call on `decks.stage` becomes a few lines of stage code with its arguments written in as JSON,
 * so it works against both doors Decks has: an app's (`/api/apps/<name>/stage`, a bearer token) and
 * an out-of-process runtime's (`/api/stage/eval`, a bearer token and a session id). Arguments and
 * results must be JSON: a stage verb that takes a function cannot be called this way.
 *
 * One file, no dependencies, the same in Node 18+ and a browser. Decks serves it to app pages at
 * `../../api/sdk/decks.mjs`, and tells a server app where it is on disk in `DECKS_SDK`.
 */

/** Something Decks said went wrong: the code threw, timed out, or the person said no. */
export class DecksError extends Error {
	constructor(message, details = {}) {
		super(message);
		this.name = "DecksError";
		this.status = details.status;
		this.logs = details.logs ?? [];
		this.timedOut = !!details.timedOut;
	}
}

const env = (name) => (typeof process !== "undefined" && process.env ? process.env[name] : undefined);

/**
 * In an app's page, the door is beside the app: `/app/<name>/…` → `/api/apps/<name>/stage`, keeping
 * whatever prefix the page is under (a second server's `/c/<id>/`).
 */
function pageDoor() {
	if (typeof location === "undefined") return undefined;
	const match = /^(.*?)\/app\/([a-z0-9][a-z0-9-]*)(?:\/|$)/.exec(location.pathname);
	return match ? `${location.origin}${match[1]}/api/apps/${match[2]}/stage` : undefined;
}

/**
 * A connection to Decks.
 *
 * @param {object} [options]
 * @param {string} [options.url]  The stage code endpoint. Default: `DECKS_STAGE_URL`, or in an app's page the app's own.
 * @param {string} [options.token]  Its bearer token. Default: `DECKS_STAGE_TOKEN`. A page needs none.
 * @param {string} [options.sessionID]  For `/api/stage/eval`, the runtime session the code acts for.
 * @param {typeof fetch} [options.fetch]  A fetch to use instead of the global one.
 */
export function connect(options = {}) {
	const url = options.url ?? env("DECKS_STAGE_URL") ?? pageDoor();
	const token = options.token ?? env("DECKS_STAGE_TOKEN");
	const sessionID = options.sessionID ?? env("DECKS_SESSION_ID");
	const doFetch = options.fetch ?? globalThis.fetch;
	if (!url) throw new DecksError("No Decks to talk to: pass { url, token }, or run inside Decks, which sets DECKS_STAGE_URL and DECKS_STAGE_TOKEN.");
	if (typeof doFetch !== "function") throw new DecksError("This runtime has no fetch; pass one as { fetch }.");

	/** Run stage code: the body of an async function with `stage` (and, at an app's door, `event`) in scope. */
	async function run(code, value) {
		const headers = { "content-type": "application/json" };
		if (token) headers.authorization = `Bearer ${token}`;
		let response;
		try {
			response = await doFetch(url, { method: "POST", headers, body: JSON.stringify({ code, ...(value !== undefined ? { value } : {}), ...(sessionID ? { sessionID } : {}) }) });
		} catch (error) {
			throw new DecksError(`Could not reach Decks at ${url}: ${error.message}`);
		}
		const answer = await response.json().catch(() => ({ error: `Decks answered ${response.status} without a result` }));
		if (!response.ok || answer.error || answer.ok === false) throw new DecksError(answer.error || `Decks answered ${response.status}`, { status: response.status, logs: answer.logs, timedOut: answer.timedOut });
		return answer.value;
	}

	/** A stage verb by its path, `["pen", "read"]`, as code that calls it with these arguments. */
	function call(path, args) {
		const owner = path.slice(0, -1).map((key) => `[${JSON.stringify(key)}]`).join("");
		const verb = JSON.stringify(path[path.length - 1]);
		// Trailing undefineds are left off rather than sent as nulls, so an optional argument stays absent.
		const given = [...args]; while (given.length && given[given.length - 1] === undefined) given.pop();
		const json = JSON.stringify(given);
		return run(`const owner = stage${owner};\nif (typeof owner?.[${verb}] !== "function") throw new Error("stage.${path.join(".")} is not a stage verb");\nreturn await owner[${verb}](...${json});`);
	}

	/** `decks.stage.apps.list()` and the rest: any path of property names, called. */
	const verbs = (path) =>
		new Proxy(function () {}, {
			get: (_target, key) => (typeof key === "string" && key !== "then" ? verbs([...path, key]) : undefined),
			apply: (_target, _self, args) => {
				if (!path.length) throw new DecksError("Call a verb, as in decks.stage.boards().");
				return call(path, args);
			},
		});

	return {
		url,
		run,
		stage: verbs([]),
		/** Hand work to an agent by name, or make it first with `{ name, kind }`; returns at once. */
		send: (to, work) => call(["send"], [to, typeof work === "string" ? { task: work } : work]),
		/** Who is on this deck: every agent, or one project's with `{ workspace }`. */
		agents: (filter) => call(["agents"], filter ? [{ filter }] : []),
		/**
		 * Hand work to the agent with this name, making it from the spec first when there is none:
		 * `sendTo({ name: "Labeler", kind: "claude" }, { task })`. Answers with where it was queued and
		 * whether the agent was made.
		 */
		sendTo: (agent, work) =>
			run(
				`const spec = ${JSON.stringify(agent)}, work = ${JSON.stringify(typeof work === "string" ? { task: work } : work)};\nconst have = (await stage.agents()).some((a) => a.name === spec.name);\nconst sent = await stage.send(have ? spec.name : spec, work);\nreturn { ...sent, name: spec.name, made: !have };`,
			),
	};
}

/** A connection from the environment, made on first use. */
let shared;
export const decks = new Proxy({}, { get: (_target, key) => (shared ??= connect())[key] });
