/**
 * The OpenCode 2 adaptor against a real OpenCode 2 and a real model, for what the browser checks
 * cannot reach: a mode that refuses, auto mode, the environment an agent's commands see, the
 * canvas tool through the bridge, isolated mode in and out, skills, and resuming a session after
 * the server has stopped.
 *
 *   cd apps/server && node --import tsx ../../scripts/opencode2-live.mts
 *
 * It spends a few cents on `opencode-go/deepseek-v4.1-flash` (`OPENCODE2_LIVE_MODEL` to change),
 * so it is run by hand when OpenCode 2 or the adaptor changes, never by `npm test`. OpenCode 2
 * runs in a temporary home of its own, with a copy of `~/.config/opencode2`, and is offered the
 * opencode 1 API keys as a real start would be; nothing of the person's OpenCode 2 is touched.
 */
import http from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const S = mkdtempSync(join(tmpdir(), "opencode2-live-"));
const home = join(S, "home");
mkdirSync(join(home, ".config", "opencode2"), { recursive: true });
const ownConfig = join(homedir(), ".config", "opencode2");
if (existsSync(ownConfig)) cpSync(ownConfig, join(home, ".config", "opencode2"), { recursive: true });
process.env.DECKS_OPENCODE2_HOME = home;
process.env.DECKS_OPENCODE2_BIN ??= join(homedir(), ".opencode2", "bin", "opencode2");
const [provider, ...rest] = (process.env.OPENCODE2_LIVE_MODEL ?? "opencode-go/deepseek-v4.1-flash").split("/");
const liveModel = { provider: provider!, model: rest.join("/"), thinking: "low" };
process.env.XDG_CACHE_HOME = "/somewhere/original-cache"; // what an agent's command must see again

const deckDir = join(S, "deck");
const isoDir = join(S, "iso");
for (const dir of [deckDir, isoDir]) {
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
}

const { Translator } = await import("../apps/server/src/agents/translator.ts");
const { StageBridge } = await import("../apps/server/src/stage/bridge.ts");
const { Opencode2Backend } = await import("../apps/server/src/runtimes/opencode2/backend.ts");

// The canvas: a stand-in for Decks' /api/stage/eval, routed through the real bridge.
const bridge = new StageBridge();
const tool = { name: "stage_eval", guidelines: [], webShared: () => false, run: async (code: string) => ({ text: `stage ran: ${code}`, isError: false }) };
const server = http.createServer(async (req, res) => {
	let body = "";
	for await (const chunk of req) body += chunk;
	const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
	const { code, sessionID } = JSON.parse(body || "{}");
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(await bridge.run(token, code, sessionID)));
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
const port = (server.address() as { port: number }).port;

const notices: string[] = [];
let ended: (() => void) | undefined;
function contextFor(translator: InstanceType<typeof Translator>, extra: Record<string, unknown> = {}) {
	return {
		cwd: deckDir,
		deck: { path: deckDir, name: "live", boards: [], roots: { roots: [] } },
		translator,
		bridge: { context: () => ({}) },
		tool,
		stageAgent: { id: "agent-live", inPlay: () => [] },
		port,
		stageBridge: bridge,
		model: liveModel,
		mode: "manual",
		notice: (level: string, text: string) => notices.push(`${level}: ${text}`),
		turnEnded: () => ended?.(),
		...extra,
	} as never;
}

const results: Array<[string, boolean, string]> = [];
const check = (name: string, ok: boolean, detail = "") => {
	results.push([name, ok, detail]);
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
async function turn(backend: InstanceType<typeof Opencode2Backend>, text: string, ms = 120000) {
	const done = new Promise<void>((ok) => (ended = ok));
	await backend.prompt(text);
	await Promise.race([done, new Promise((ok) => setTimeout(ok, ms))]);
}
const toolResults = (t: InstanceType<typeof Translator>) =>
	t.history().filter((item: any) => item.kind === "tool").map((item: any) => `${item.name}:${item.state}:${String(item.result ?? "").slice(0, 300)} <= ${JSON.stringify(item.args ?? {}).slice(0, 200)}`);

const t1 = new Translator("agent-live", () => {}, deckDir);
const a = await Opencode2Backend.create(contextFor(t1));
check("the session opened", Boolean(a.sessionRef()), a.sessionRef());

// 1. manual mode: the shell is refused, and said.
await turn(a, "Use your shell tool to run exactly: echo hi > made-by-shell.txt . If it is refused, just say refused.");
check("manual mode refuses the shell", !existsSync(join(deckDir, "made-by-shell.txt")), "file not made");
check("…and says so", notices.some((n) => /Refused to/.test(n)), notices.filter((n) => /Refused/.test(n)).join(" | ").slice(0, 160));

// 2. auto mode: the same command runs.
await a.setMode("auto" as never);
await turn(a, "Now run it again with your shell tool: echo hi > made-by-shell.txt");
check("auto mode lets the shell run", existsSync(join(deckDir, "made-by-shell.txt")));

// 3. an agent's command sees the original environment, and no server password.
await turn(a, "Run with your shell tool: echo CACHE=$XDG_CACHE_HOME DATA=$XDG_DATA_HOME PW=${OPENCODE_PASSWORD:-unset} CFG=${OPENCODE_CONFIG_DIR:-unset} . Reply with the output only.");
const envLine = toolResults(t1).filter((line) => /CACHE=/.test(line)).at(-1) ?? "";
check("XDG_CACHE_HOME is the original one", /CACHE=\/somewhere\/original-cache/.test(envLine), envLine);
check("XDG_DATA_HOME is not OpenCode 2's", !/opencode2/.test(envLine.split("DATA=")[1]?.split(" ")[0] ?? ""), envLine);
check("the server password is not there", /PW=unset/.test(envLine) || (!/PW=/.test(envLine.split(" <= ")[0]) && !/OPENCODE_PASSWORD/.test(envLine.split(" <= ")[1] ?? "")), envLine);
check("OpenCode 2's config folder setting is not there", /CFG=unset/.test(envLine), envLine);

// 4. the canvas tool reaches Decks through the bridge.
await turn(a, "Call the stage_eval tool once with code: return 41 + 1");
check("the canvas tool ran through Decks", toolResults(t1).some((line) => /^stage_eval:done:stage ran: return 41 \+ 1/.test(line)), toolResults(t1).filter((l) => l.startsWith("stage_eval")).join(" | "));

// 5. isolated mode: work lands in the isolated folder, not the deck.
await a.setIsolation({ dir: isoDir, deck: deckDir, data: deckDir } as never);
await turn(a, "Use your shell tool to run: pwd > where.txt");
check("isolated mode runs in its own folder", existsSync(join(isoDir, "where.txt")) && !existsSync(join(deckDir, "where.txt")), existsSync(join(isoDir, "where.txt")) ? readFileSync(join(isoDir, "where.txt"), "utf8").trim() : "no file in iso");
await a.setIsolation(undefined);
await turn(a, "Use your shell tool to run: pwd > back.txt");
check("…and leaving it moves the chat back to the deck", existsSync(join(deckDir, "back.txt")));

// 6. skills: Decks' and the person's own.
const skills = ((await (a as any).client.skill.list({ location: { directory: deckDir } })) as any).data?.map((s: any) => s.name ?? s.id) ?? [];
check("Decks' skills are there", skills.includes("board-authoring"), skills.slice(0, 20).join(","));
// The person's own skills, when their OpenCode 2 config names any.
if (existsSync(join(ownConfig, "opencode.jsonc")) || existsSync(join(ownConfig, "opencode.json"))) check("…and the person's own config still loads", skills.length > 4, `${skills.length} skills`);

// 7. resume: a new backend on the same session carries on.
const ref = a.sessionRef()!;
a.dispose();
const t2 = new Translator("agent-live", () => {}, deckDir);
notices.length = 0;
const b = await Opencode2Backend.create(contextFor(t2, { resumeRef: ref, mode: "auto" }));
check("a resumed chat keeps its session", b.sessionRef() === ref, `${b.sessionRef()} vs ${ref}`);
await turn(b, "In one word: what was the name of the first file you made with the shell in this conversation?");
const reply = t2.history().filter((item: any) => item.kind === "assistant").map((item: any) => item.text).join(" ");
check("…and remembers the conversation", /made-by-shell/.test(reply), reply.slice(0, 120));
b.dispose();

server.close();
rmSync(S, { recursive: true, force: true });
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
setTimeout(() => process.exit(failed ? 1 : 0), 500);
