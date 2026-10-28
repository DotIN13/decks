#!/usr/bin/env node
/*
 * The font files the engine's Rust tests set words in (`crates/paint/src/fixtures.rs`, `FONTS`), into
 * `fonts/`, from Fontsource's CDN: `npm run fonts -w packages/stage`.
 *
 * They are not kept in git (a few MB, the Chinese one most of it), and without them every test that
 * sets words skips quietly: a glyph texture bug went unseen for a week that way. Each file is held
 * to its bytes, because the goldens are drawn in exactly these; a file the CDN changed is refused, not
 * written, and the goldens have to be drawn again with it on purpose.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fonts");
/** Fontsource's name for the family, the file there, and its SHA-256. */
const FONTS = [
	["inter", "latin-400-normal", "7c7c718a62e315a83fb5b5b0b086028bae10fc153701cf0f0b168e5f5a0c28f9"],
	["inter", "latin-600-normal", "fb6efb6500fe6531b73c7a06d025ceaefc562ee03e9d840c76d48ee11e85b998"],
	["inter", "latin-700-normal", "e0b3cad6de618fb83ef2dec26499beb6011a90971090a63dcf904670e13c53ec"],
	["inter", "latin-400-italic", "a7ba45aa1282969d1acc15a752a60c2a556e9bf913ab9174abc72790d9ccbc93"],
	["jetbrains-mono", "latin-400-normal", "473c93ad62d89abd8431c8f5d744c83fe2e3f87d05b2f80c06355f240058d813"],
	["noto-sans-sc", "chinese-simplified-400-normal", "f1caaade72a6d83bf7f38ece3e837d106e333a5915d8460f4ba3d26a8573f2f1"],
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

mkdirSync(dir, { recursive: true });
let failed = 0;
for (const [family, file, want] of FONTS) {
	const name = `${family}_latest_${file}.ttf`;
	const path = join(dir, name);
	if (existsSync(path) && sha(readFileSync(path)) === want) {
		console.log(`have  ${name}`);
		continue;
	}
	const url = `https://cdn.jsdelivr.net/fontsource/fonts/${family}@latest/${file}.ttf`;
	try {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`${response.status} from ${url}`);
		const bytes = Buffer.from(await response.arrayBuffer());
		const got = sha(bytes);
		if (got !== want) throw new Error(`${url} is not the file the goldens were drawn with (sha256 ${got.slice(0, 12)}…, want ${want.slice(0, 12)}…)`);
		writeFileSync(path, bytes);
		console.log(`got   ${name} (${Math.round(bytes.length / 1024)} KB)`);
	} catch (error) {
		failed++;
		console.error(`could not get ${name}: ${error.message}`);
	}
}
process.exit(failed ? 1 : 0);
