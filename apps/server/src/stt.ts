/**
 * Speech to text for the composer's mic (`chat/composer/voice.ts`): one recording in, its words out.
 *
 * OpenAI's transcriber, with the key in `OPENAI_API_KEY` on the server: about half a cent a minute,
 * any browser, and Chinese and English mixed in one sentence, which the browsers' own recognisers
 * cannot do. The key is read from the server's environment and nowhere else, so it never lands in
 * the deck's files or a bundle of them. Without one the page uses the browser's own recogniser.
 */
const MODEL = process.env.DECKS_STT_MODEL ?? "gpt-4o-mini-transcribe";
/** Where the recording goes: OpenAI's, or another service that answers the same way (and the tests' stand-in). */
const URL_ = () => process.env.DECKS_STT_URL ?? "https://api.openai.com/v1/audio/transcriptions";

export function sttReady(): boolean {
	return !!process.env.OPENAI_API_KEY;
}

/** The extension OpenAI reads a recording's format from, by its MIME type. */
function extension(type: string): string {
	if (type.includes("webm")) return "webm";
	if (type.includes("ogg")) return "ogg";
	if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "mp4";
	if (type.includes("wav")) return "wav";
	if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
	return "webm";
}

export async function transcribe(audio: Buffer, type: string, model: string = MODEL): Promise<string> {
	const key = process.env.OPENAI_API_KEY;
	if (!key) throw new Error("No speech recogniser on this server: set OPENAI_API_KEY and restart it.");
	const form = new FormData();
	form.append("model", model);
	form.append("file", new Blob([new Uint8Array(audio)], { type: type || "audio/webm" }), `speech.${extension(type)}`);
	const response = await fetch(URL_(), { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
	if (!response.ok) {
		const said = await response.text().catch(() => "");
		throw new Error(`The transcriber answered ${response.status}: ${said.slice(0, 200)}`);
	}
	const body = (await response.json()) as { text?: unknown };
	return typeof body.text === "string" ? body.text.trim() : "";
}
