#!/usr/bin/env node
/**
 * A fake model for the browser checks that need an agent, so they run with no model account and no
 * tokens: an OpenAI-compatible endpoint that follows the few instructions the checks give by calling
 * the agent's real tools (read, edit, bash with the decks command), takes a moment to think and streams
 * its words, and otherwise answers briefly. Pi is the real agent; only the model is fake.
 *
 *     node e2e/fake-model.mjs &                                   # on 127.0.0.1:4700
 *     PI_CODING_AGENT_DIR=e2e/fake-agent DECKS_E2E_AGENT=1 npm run test:e2e
 *
 * `e2e/fake-agent/` is a pi agent directory whose models.json names this endpoint and whose
 * settings.json makes it the default model; pi writes its sessions beside them, which git ignores.
 * FAKE_MODEL_PORT, FAKE_MODEL_LOG (every request and answer), FAKE_MODEL_THINK_MS and
 * FAKE_MODEL_WORD_MS change the port, the log and the pace.
 */
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
const PORT = Number(process.env.FAKE_MODEL_PORT ?? 4700);
const LOG = process.env.FAKE_MODEL_LOG;
const log = (line) => LOG && appendFileSync(LOG, line + "\n");

/** Decide what to answer: text, or tool calls, from the whole conversation so far. */
function decide(messages, tools) {
	const names = new Set((tools ?? []).map((t) => t.function?.name));
	const lastUser = [...messages].reverse().find((m) => m.role === "user");
	const text = typeof lastUser?.content === "string" ? lastUser.content : (lastUser?.content ?? []).map((p) => p.text ?? "").join("\n");
	// what happened since the last user message: our own tool calls and their results
	const since = messages.slice(messages.lastIndexOf(lastUser) + 1);
	const calls = since.filter((m) => m.role === "assistant").flatMap((m) => m.tool_calls ?? []);
	const results = since.filter((m) => m.role === "tool");
	const call = (name, args) => ({ id: `call_${Math.random().toString(36).slice(2, 10)}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
	const done = (reply = "done") => ({ text: reply });

	// "Read each of X, Y and Z with the read tool, one call each, then say 'done'"
	let m = /read each of (.+?) with the read tool/i.exec(text);
	if (m && names.has("read")) {
		const paths = m[1].match(/[\w./-]+\.html/g) ?? [];
		if (calls.length === 0) return { tool_calls: paths.map((p) => call("read", { path: p })) };
		return done("done");
	}
	// "With the decks command, show A and B, then list the boards on your canvas." / "hide B"
	m = /with the decks command, (show|hide) (.+?)(?:, then list the boards[^.]*)?\.?$/i.exec(text.trim());
	if (m && names.has("bash")) {
		const paths = m[2].match(/[\w./-]+\.(?:html|md|pen)/g) ?? [];
		const list = /then list the boards/i.test(text);
		// One command a turn, in order, so the canvas sees each before the next.
		const cmds = paths.map((p) => `decks ${m[1]} ${p}`);
		if (list) cmds.push("decks canvas read");
		if (calls.length < cmds.length) return { tool_calls: [call("bash", { command: cmds[calls.length] })] };
		const out = results.map((r) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content))).join("\n");
		return done(list ? `Done. The boards on the canvas:\n${out.slice(-1500)}` : "Done.");
	}
	// "Add a sticky to boards/plan.html with data-id 'timecheck' at left 1264px top 780px saying 'first turn'."
	m = /add a sticky to ([\w./-]+) with data-id '([^']+)' at left (\d+)px top (\d+)px saying '([^']+)'/i.exec(text);
	if (m && names.has("edit") && names.has("read")) {
		const [, asked, id, left, top, words] = m;
		// The board on the agent's canvas is the canvas's own copy, when there is one: find it first.
		if (calls.length === 0) return { tool_calls: [call("bash", { command: `ls canvases/*/boards/${asked.split("/").pop()} 2>/dev/null | head -1 || true` })] };
		const found = results[0] ? String(typeof results[0].content === "string" ? results[0].content : results[0].content?.[0]?.text ?? "").trim().split("\n")[0] : "";
		const path = /\.html$/.test(found) ? found : asked;
		if (calls.length === 1) return { tool_calls: [call("read", { path })] };
		if (calls.length === 2) {
			const file = results[1] ? String(typeof results[1].content === "string" ? results[1].content : results[1].content?.[0]?.text ?? "") : "";
			const body = file.match(/^\s*\d*[:\s]*(<\/body>)/m) ? "</body>" : "</body>";
			const sticky = `<div class="sticky" data-id="${id}" style="position: absolute; left: ${left}px; top: ${top}px">${words}</div>\n`;
			return { tool_calls: [call("edit", { path, edits: [{ oldText: body, newText: sticky + body }] })] };
		}
		return done(`Added the sticky "${words}".`);
	}
	// "Now change that sticky's text to 'second turn'."
	m = /change that sticky's text to '([^']+)'/i.exec(text);
	if (m && names.has("edit")) {
		// the previous turn's words are in this conversation
		const earlier = messages.map((x) => (typeof x.content === "string" ? x.content : "")).join("\n");
		const first = /saying '([^']+)'/i.exec(earlier)?.[1] ?? "first turn";
		const edited = [...messages].reverse().find((x) => x.role === "assistant" && (x.tool_calls ?? []).some((c) => c.function?.name === "edit"));
		const path = edited ? JSON.parse(edited.tool_calls.find((c) => c.function?.name === "edit").function.arguments).path : (/sticky to ([\w./-]+)/i.exec(earlier)?.[1] ?? "boards/plan.html");
		const id = /data-id '([^']+)'/i.exec(earlier)?.[1] ?? "timecheck";
		if (calls.length === 0) return { tool_calls: [call("edit", { path, edits: [{ oldText: `data-id="${id}" style="position: absolute; left: 1264px; top: 780px">${first}</div>`, newText: `data-id="${id}" style="position: absolute; left: 1264px; top: 780px">${m[1]}</div>` }] })] };
		return done(`Changed it to "${m[1]}".`);
	}
	// "what is the last text you gave that sticky in this conversation? Reply with just that text."
	if (/what (?:is the last )?text (?:you gave|did you give) that sticky/i.test(text)) {
		const mine = messages.filter((x) => x.role === "assistant" && typeof x.content === "string").map((x) => x.content);
		const last = [...mine].reverse().map((c) => /"([^"]+)"/.exec(c)?.[1]).find(Boolean);
		return done(last ?? "first turn");
	}
	return done("Understood.");
}

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		if (req.url?.endsWith("/models")) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ object: "list", data: [{ id: "fake-1", object: "model" }] })); }
		let request = {};
		try { request = JSON.parse(body || "{}"); } catch {}
		log(`${new Date().toISOString()} ${req.method} ${req.url} tools=${(request.tools ?? []).map((t) => t.function?.name).join(",")} messages=${request.messages?.length}`);
		log("  last: " + JSON.stringify(request.messages?.slice(-2)).slice(0, 1200));
		const answer = decide(request.messages ?? [], request.tools);
		log("  answer: " + JSON.stringify(answer).slice(0, 400));
		const id = "chatcmpl-" + Date.now();
		const THINK_MS = Number(process.env.FAKE_MODEL_THINK_MS ?? 1500);
		const WORD_MS = Number(process.env.FAKE_MODEL_WORD_MS ?? 60);
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: request.model ?? "fake-1" };
		if (request.stream) {
			void (async () => {
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			await sleep(THINK_MS);
			sse(res, { ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
			if (answer.tool_calls) {
				answer.tool_calls.forEach((tc, i) => sse(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: tc.id, type: "function", function: tc.function }] }, finish_reason: null }] }));
				sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 } });
			} else {
				for (const word of answer.text.split(/(?<= )/)) {
					sse(res, { ...base, choices: [{ index: 0, delta: { content: word }, finish_reason: null }] });
					await sleep(WORD_MS);
				}
				sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 } });
			}
			res.write("data: [DONE]\n\n");
			res.end();
			})();
			return;
		}
		res.setHeader("content-type", "application/json");
		const message = answer.tool_calls ? { role: "assistant", content: null, tool_calls: answer.tool_calls } : { role: "assistant", content: answer.text };
		res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message, finish_reason: answer.tool_calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 } }));
	});
}).listen(PORT, "127.0.0.1", () => console.log(`fake model on http://127.0.0.1:${PORT}/v1`));
