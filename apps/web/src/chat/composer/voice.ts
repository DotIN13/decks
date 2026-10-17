import { createSignal } from "solid-js";
import { api } from "../../connections/connection.ts";

/**
 * This browser's choices for the mic, from Settings: which recogniser, and what language the browser's
 * own listens for. Kept in this browser; the server's model is the deck's (`DeckSettings.sttModel`).
 */
export type Recogniser = "auto" | "server" | "browser";
export const RECOGNISERS: ReadonlyArray<{ id: Recogniser; label: string; note: string }> = [
	{ id: "auto", label: "Automatic", note: "The server's if it has a key, else this browser's." },
	{ id: "server", label: "Server", note: "OpenAI, through this server: any language." },
	{ id: "browser", label: "Browser", note: "Free and live, one language at a time." },
];
/** The languages offered for the browser's recogniser; empty is the browser's own language. */
export const VOICE_LANGS: ReadonlyArray<{ id: string; label: string }> = [
	{ id: "", label: "This browser's language" },
	{ id: "en-US", label: "English (US)" },
	{ id: "en-GB", label: "English (UK)" },
	{ id: "zh-CN", label: "中文（普通话）" },
	{ id: "zh-TW", label: "中文（台灣）" },
	{ id: "ja-JP", label: "日本語" },
	{ id: "es-ES", label: "Español" },
	{ id: "fr-FR", label: "Français" },
	{ id: "de-DE", label: "Deutsch" },
];
const stored = (key: string) => {
	try {
		return localStorage.getItem(key) ?? "";
	} catch {
		return "";
	}
};
const [recogniser, setRecogniserSignal] = createSignal<Recogniser>((["auto", "server", "browser"] as const).find((one) => one === stored("decks.voice.recogniser")) ?? "auto");
const [voiceLang, setVoiceLangSignal] = createSignal(stored("decks.voice.lang"));
export { recogniser, voiceLang };
export function setRecogniser(choice: Recogniser): void {
	setRecogniserSignal(choice);
	try {
		localStorage.setItem("decks.voice.recogniser", choice);
	} catch {
		/* a browser with storage switched off keeps it for this page */
	}
}
export function setVoiceLang(lang: string): void {
	setVoiceLangSignal(lang);
	try {
		localStorage.setItem("decks.voice.lang", lang);
	} catch {
		/* as above */
	}
}

/**
 * The composer's mic: speech turned into words you can edit before sending (`Composer`).
 *
 * Two recognisers, and the server's is preferred. With an OpenAI key on the server (`stt.ts`) the
 * recording goes there when you stop and comes back as words a second or two later, in any browser,
 * Chinese and English mixed. Without one the browser's own recogniser is used, which hears as you
 * speak but takes one language at a time, sends Chrome's audio to Google, and is missing in Firefox.
 *
 * Either way a browser gives the microphone only to a secure page: HTTPS or localhost.
 */
export interface Recording {
	/** Stop and hand back the words heard: the server's, or the browser's. */
	stop(): Promise<string>;
	/** Stop and keep nothing. */
	cancel(): void;
}

export interface VoiceOptions {
	/** How loud it is now, 0 to 1, about 20 times a second: the bars beside the timer. */
	onLevel?: (level: number) => void;
	/** Words the browser's recogniser has heard so far, before you stop: shown as you speak. */
	onHeard?: (words: string) => void;
	/** The language the browser's recogniser listens for; the server's hears any. */
	lang?: string;
}

type SpeechRecognitionLike = {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
	onerror: ((event: { error: string }) => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
	abort(): void;
};

let serverCan: Promise<boolean> | undefined;
/** Whether this server transcribes, asked once a page. */
export function serverTranscribes(): Promise<boolean> {
	serverCan ??= fetch(api("/stt"))
		.then(async (response) => (response.ok ? ((await response.json()) as { server?: boolean }).server === true : false))
		.catch(() => false);
	return serverCan;
}

function browserRecogniser(): (new () => SpeechRecognitionLike) | undefined {
	const w = globalThis as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
	return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Why there is no mic here, in a sentence, or nothing when there is one. */
export function micMissing(): string | undefined {
	if (typeof window === "undefined") return "No microphone here.";
	if (!window.isSecureContext) return "The browser gives the microphone only to an HTTPS address or localhost.";
	if (!navigator.mediaDevices?.getUserMedia) return "This browser has no microphone to give.";
	return undefined;
}

/** Start listening. Throws a sentence when it cannot: no microphone, no permission, no recogniser. */
export async function startRecording(options: VoiceOptions = {}): Promise<Recording> {
	const missing = micMissing();
	if (missing) throw new Error(missing);
	const choice = recogniser();
	const serverHas = choice === "browser" ? false : await serverTranscribes();
	const Recogniser = browserRecogniser();
	if (choice === "server" && !serverHas) throw new Error("This server has no speech recogniser: set OPENAI_API_KEY in its environment, or pick the browser's in Settings.");
	if (choice === "browser" && !Recogniser) throw new Error("This browser has no speech recogniser: pick the server's in Settings.");
	const onServer = serverHas;
	if (!onServer && !Recogniser) throw new Error("This server has no speech recogniser, and nor has this browser: set OPENAI_API_KEY on the server.");
	let stream: MediaStream;
	try {
		stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	} catch {
		throw new Error("The microphone was not allowed: the browser's site settings can change that.");
	}
	const levels = meter(stream, options.onLevel);
	const release = () => {
		levels.stop();
		for (const track of stream.getTracks()) track.stop();
	};

	if (onServer) {
		const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((one) => MediaRecorder.isTypeSupported?.(one)) ?? "";
		const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
		const chunks: Blob[] = [];
		recorder.ondataavailable = (event) => {
			if (event.data.size > 0) chunks.push(event.data);
		};
		recorder.start(250);
		const stopped = () =>
			new Promise<void>((done) => {
				if (recorder.state === "inactive") return done();
				recorder.onstop = () => done();
				recorder.stop();
			});
		return {
			async stop() {
				await stopped();
				release();
				const audio = new Blob(chunks, { type: recorder.mimeType || type || "audio/webm" });
				if (audio.size === 0) return "";
				const response = await fetch(api("/stt"), { method: "POST", headers: { "content-type": audio.type }, body: audio });
				const body = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
				if (!response.ok) throw new Error(body.error ?? `The server could not transcribe it (${response.status}).`);
				return body.text ?? "";
			},
			cancel() {
				void stopped().then(release);
			},
		};
	}

	const recognition = new Recogniser!();
	recognition.lang = options.lang ?? (voiceLang() || navigator.language || "en-US");
	recognition.continuous = true;
	recognition.interimResults = true;
	let finals = "";
	let interim = "";
	let failed: string | undefined;
	recognition.onresult = (event) => {
		finals = "";
		interim = "";
		for (const result of Array.from(event.results)) (result.isFinal ? (finals += result[0]!.transcript) : (interim += result[0]!.transcript));
		options.onHeard?.(`${finals}${interim}`.trim());
	};
	recognition.onerror = (event) => {
		if (event.error !== "aborted" && event.error !== "no-speech") failed = event.error;
	};
	recognition.start();
	return {
		stop() {
			return new Promise((done, fail) => {
				recognition.onend = () => {
					release();
					if (failed) fail(new Error(`The browser's recogniser stopped: ${failed}.`));
					else done(`${finals}${interim}`.trim());
				};
				recognition.stop();
			});
		},
		cancel() {
			recognition.onend = null;
			recognition.abort();
			release();
		},
	};
}

/** How loud the microphone is, sampled about 20 times a second. */
function meter(stream: MediaStream, onLevel: ((level: number) => void) | undefined): { stop(): void } {
	if (!onLevel || typeof AudioContext === "undefined") return { stop() {} };
	const context = new AudioContext();
	const analyser = context.createAnalyser();
	analyser.fftSize = 512;
	context.createMediaStreamSource(stream).connect(analyser);
	const samples = new Uint8Array(analyser.fftSize);
	const timer = setInterval(() => {
		analyser.getByteTimeDomainData(samples);
		let peak = 0;
		for (const value of samples) peak = Math.max(peak, Math.abs(value - 128));
		onLevel(Math.min(1, peak / 64));
	}, 50);
	return {
		stop() {
			clearInterval(timer);
			void context.close();
		},
	};
}
