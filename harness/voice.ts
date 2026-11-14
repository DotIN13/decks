import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Speech to text for the composer's mic: one recording in, its words out.
// OpenAI's transcriber, its key in OPENAI_API_KEY on this machine only. The
// model is the harness's setting (runtime.update), kept in its own folder.

export const STT_MODELS: ReadonlyArray<{ id: string; label: string; note: string }> = [
	{ id: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe", note: "$0.003 a minute; mixes languages well." },
	{ id: "gpt-transcribe", label: "GPT Transcribe", note: "$0.0045 a minute; the newest." },
	{ id: "gpt-4o-transcribe", label: "GPT-4o Transcribe", note: "$0.006 a minute; the most accurate." },
	{ id: "whisper-1", label: "Whisper", note: "$0.006 a minute; the older model." },
];
const DEFAULT_MODEL = process.env.DECKS_STT_MODEL ?? "gpt-4o-mini-transcribe";
const endpoint = (): string => process.env.DECKS_STT_URL ?? "https://api.openai.com/v1/audio/transcriptions";

export type VoiceSettings = { sttModel?: string };

/** The harness's own settings, in <home>/harness/settings.json. */
export class Settings {
	private readonly file: string;
	private value: VoiceSettings;

	constructor(home: string) {
		this.file = join(home, "harness", "settings.json");
		this.value = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as VoiceSettings) : {};
	}

	get(): VoiceSettings & { sttReady: boolean; sttModels: typeof STT_MODELS } {
		return { ...this.value, sttReady: sttReady(), sttModels: STT_MODELS };
	}

	/** A model this harness knows, or null for the default; anything else is refused. */
	setSttModel(model: string | null): void {
		if (model !== null && !STT_MODELS.some((one) => one.id === model)) {
			throw Object.assign(new Error(`"${model}" is not a speech model this harness knows: ${STT_MODELS.map((one) => one.id).join(", ")}.`), { code: "invalid" });
		}
		if (model === null) delete this.value.sttModel;
		else this.value.sttModel = model;
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(this.file, JSON.stringify(this.value));
	}

	sttModel(): string {
		return this.value.sttModel ?? DEFAULT_MODEL;
	}
}

export function sttReady(): boolean {
	return !!process.env.OPENAI_API_KEY;
}

/** The extension OpenAI reads a recording's format from, by its MIME type. */
export function extension(type: string): string {
	if (type.includes("webm")) return "webm";
	if (type.includes("ogg")) return "ogg";
	if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "mp4";
	if (type.includes("wav")) return "wav";
	if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
	return "webm";
}

export async function transcribe(audio: Uint8Array, type: string, model: string = DEFAULT_MODEL): Promise<string> {
	const key = process.env.OPENAI_API_KEY;
	if (!key) throw new Error("No speech recogniser on this machine: set OPENAI_API_KEY and restart the harness.");
	const form = new FormData();
	form.append("model", model);
	form.append("file", new Blob([new Uint8Array(audio)], { type: type || "audio/webm" }), `speech.${extension(type)}`);
	const response = await fetch(endpoint(), { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
	if (!response.ok) throw new Error(`The transcriber answered ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`);
	const body = (await response.json()) as { text?: unknown };
	return typeof body.text === "string" ? body.text.trim() : "";
}
