import assert from "node:assert/strict";
import { test } from "node:test";
import { firstUrl, lastLine, plain } from "./cli-output.ts";

/** What `claude auth login --claudeai` actually writes, escapes and all. */
const URL =
	"https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&scope=user%3Aprofile+user%3Ainference&code_challenge=7jf3jr&state=zCyvA5";
const LOGIN_OUTPUT = `Opening browser to sign in…\nIf the browser didn't open, visit: \u001B]8;;${URL}\u0007${URL}\u001B]8;;\u0007\nPaste code here if prompted > `;

test("the sign-in URL is read out of an OSC-8 hyperlink exactly once", () => {
	assert.equal(firstUrl(LOGIN_OUTPUT), URL);
});

/*
 * The bug this file exists for.
 *
 * `\S+` does not stop at a BEL, so matching the raw line returns the copy inside the
 * escape sequence, the BEL, *and* the visible copy — one string, twice as long as a URL
 * and not a link anybody can open. The dialog showed that, and nothing could be signed
 * in to.
 */
test("matching the raw line instead would return the address twice over", () => {
	const naive = /https?:\/\/\S+/.exec(LOGIN_OUTPUT)?.[0] ?? "";
	assert.ok(naive.length > URL.length * 1.9, `naive match was ${naive.length} chars`);
	assert.ok(naive.includes("\u0007"));
});

test("output with no URL yet has none to report", () => {
	assert.equal(firstUrl("Opening browser to sign in…\n"), undefined);
});

test("colours and cursor moves come out too, and plain text is untouched", () => {
	assert.equal(plain("\u001B[1mSigned in\u001B[0m"), "Signed in");
	assert.equal(plain("nothing to strip"), "nothing to strip");
});

test("the last line is what a failure is reported as", () => {
	assert.equal(
		lastLine("something\nLogin failed: Request failed with status code 400\n"),
		"Login failed: Request failed with status code 400",
	);
	assert.equal(lastLine("   \n  \n"), undefined);
	assert.equal(lastLine(""), undefined);
});
