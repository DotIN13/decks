#!/usr/bin/env node
// A fake model for the harness's checks: an OpenAI-compatible endpoint that
// follows one instruction with the agent's real bash tool and the new decks
// command, and otherwise answers briefly. Pi is the real agent.
//   FAKE_MODEL_PORT (4671) FAKE_MODEL_LOG (a file for every request)
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_MODEL_PORT ?? 4671);
const log = (line) => process.env.FAKE_MODEL_LOG && appendFileSync(process.env.FAKE_MODEL_LOG, `${line}\n`);
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).map((p) => p.text ?? "").join("\n"));
const call = (name, args) => ({ id: `call_${Math.random().toString(36).slice(2, 10)}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const PATH_OF = `node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s).path))'`;

/** "Make a card titled 'X' with the decks command": create it, place it, say its path. */
export function decide(messages, tools) {
	const names = new Set((tools ?? []).map((t) => t.function?.name));
	const lastUser = [...messages].reverse().find((m) => m.role === "user");
	const since = messages.slice(messages.lastIndexOf(lastUser) + 1);
	const results = since.filter((m) => m.role === "tool").map(textOf);
	const asked = /make a card titled '([^']+)' with the decks command/i.exec(textOf(lastUser));
	if (asked && names.has("bash")) {
		if (results.length === 0) return { tool_calls: [call("bash", { command: `p=$(decks card create --title '${asked[1]}' | ${PATH_OF}) && decks item insert --type card --card "$p" >/dev/null && echo "$p"` })] };
		return { text: `Made ${results[0].trim().split("\n").pop()}.` };
	}
	return { text: "Understood." };
}

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

function answer(req, res, body) {
	if (req.url?.endsWith("/models")) return res.end(JSON.stringify({ object: "list", data: [{ id: "fake-1", object: "model" }] }));
	const request = JSON.parse(body || "{}");
	const said = decide(request.messages ?? [], request.tools);
	log(`${new Date().toISOString()} ${JSON.stringify(said).slice(0, 400)}`);
	const base = { id: `chatcmpl-${Date.now()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "fake-1" };
	const usage = { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 };
	res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
	sse(res, { ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
	if (said.tool_calls) {
		said.tool_calls.forEach((tc, index) => sse(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index, ...tc }] }, finish_reason: null }] }));
		sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage });
	} else {
		sse(res, { ...base, choices: [{ index: 0, delta: { content: said.text }, finish_reason: null }] });
		sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage });
	}
	res.end("data: [DONE]\n\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	createServer((req, res) => {
		let body = "";
		req.on("data", (c) => (body += c));
		req.on("end", () => answer(req, res, body));
	}).listen(PORT, "127.0.0.1", () => console.log(`fake model on 127.0.0.1:${PORT}`));
}
