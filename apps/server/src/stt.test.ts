import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { sttReady, transcribe } from "./stt.ts";

test("a recording goes to the transcriber with the key and the model, and its words come back", async () => {
	let seen: { auth?: string; body: string } = { body: "" };
	const stand = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk.toString("latin1")));
		req.on("end", () => {
			seen = { auth: req.headers.authorization, body };
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ text: " make the arrow green " }));
		});
	});
	await new Promise<void>((done) => stand.listen(0, "127.0.0.1", done));
	const port = (stand.address() as { port: number }).port;
	const was = { key: process.env.OPENAI_API_KEY, url: process.env.DECKS_STT_URL };
	process.env.OPENAI_API_KEY = "sk-test";
	process.env.DECKS_STT_URL = `http://127.0.0.1:${port}/v1/audio/transcriptions`;
	try {
		assert.equal(sttReady(), true);
		const words = await transcribe(Buffer.from("not really opus"), "audio/webm;codecs=opus");
		assert.equal(words, "make the arrow green");
		assert.equal(seen.auth, "Bearer sk-test");
		assert.match(seen.body, /name="model"\r\n\r\ngpt-4o-mini-transcribe/);
		assert.match(seen.body, /filename="speech\.webm"/);
	} finally {
		stand.close();
		if (was.key === undefined) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = was.key;
		if (was.url === undefined) delete process.env.DECKS_STT_URL;
		else process.env.DECKS_STT_URL = was.url;
	}
	assert.equal(sttReady(), !!process.env.OPENAI_API_KEY);
});
