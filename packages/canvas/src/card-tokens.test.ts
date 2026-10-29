import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCardTokens } from "./card-tokens.ts";

describe("card tokens", () => {
	it("makes a card's token once per card and canvas, and again once it is due for renewal", async () => {
		let clock = 0;
		const asked: string[] = [];
		const tokens = createCardTokens({ mint: async (path, stage) => (asked.push(`${stage}:${path}`), `t${asked.length}`), renewMs: 100, now: () => clock });
		assert.equal(await tokens.token("cards/a/index.html", "one"), "t1");
		assert.equal(await tokens.token("cards/a/index.html", "one"), "t1");
		assert.equal(await tokens.token("cards/a/index.html", "two"), "t2", "another canvas is another token");
		clock = 101;
		assert.equal(await tokens.token("cards/a/index.html", "one"), "t3");
		assert.deepEqual(asked, ["one:cards/a/index.html", "two:cards/a/index.html", "one:cards/a/index.html"]);
	});

	it("keeps no refusal, so the next press asks again", async () => {
		let answer: string | undefined;
		let asks = 0;
		const tokens = createCardTokens({
			mint: async () => {
				asks++;
				if (!answer) throw new Error("not allowed");
				return answer;
			},
		});
		assert.equal(await tokens.token("cards/a/index.html"), undefined);
		await new Promise((settle) => setTimeout(settle, 0));
		answer = "yes";
		assert.equal(await tokens.token("cards/a/index.html"), "yes");
		assert.equal(asks, 2);
	});
});
