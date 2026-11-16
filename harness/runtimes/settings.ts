import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_MODEL, STT_MODELS, sttReady } from "../voice.ts";

// The harness's own settings, which runtime.get and runtime.update show and
// change: the speech model, and the agent every new page starts on.

export type VoiceSettings = { sttModel?: string; focused?: string };

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

	/** The agent every new page starts on (chat.focus). */
	setFocused(agent: string): void {
		this.value.focused = agent;
		this.save();
	}

	/** A model this harness knows, or null for the default; anything else is refused. */
	setSttModel(model: string | null): void {
		if (model !== null && !STT_MODELS.some((one) => one.id === model)) {
			throw Object.assign(new Error(`"${model}" is not a speech model this harness knows: ${STT_MODELS.map((one) => one.id).join(", ")}.`), { code: "invalid" });
		}
		if (model === null) delete this.value.sttModel;
		else this.value.sttModel = model;
		this.save();
	}

	private save(): void {
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(this.file, JSON.stringify(this.value));
	}

	sttModel(): string {
		return this.value.sttModel ?? DEFAULT_MODEL;
	}
}
