/* @refresh reload */
import { createSignal, Match, onCleanup, onMount, Switch } from "solid-js";
import { render } from "solid-js/web";
import { DecksMark } from "@decks/ui";
import { m, markDocumentLanguage } from "@decks/i18n";
import "../index.css";
import "../styles/login.css";

/**
 * The password login, at `/login` (`login.html`), open to anyone: one field, one button, and why it
 * did not work. The server sets the login cookie (`decks_login`, HttpOnly) on the right password and
 * this page then goes where it was sent from (`?next=`, a path on this server only) or to `/`.
 *
 * It is also where a terminal is let in: `decks login` prints `/login?approve=ABCD-1234`, and once
 * this browser is logged in the page asks whether to let that terminal in, naming it as the server
 * does ("decks login on mymac"). Approving is one request with the cookie, and the terminal hears it
 * by itself.
 *
 * Its own small page rather than a screen of the app: it must load for someone the server lets have
 * nothing else, so it reads only `/api/login/*`, and no token, socket or deck.
 */

markDocumentLanguage();
document.title = m.login_document_title();

// The app's scheme: the one chosen in the app (`lib/theme.ts`, `decks.scheme`), else the system's, followed while nothing is chosen.
const SCHEME_KEY = "decks.scheme";
const saved = (): string | null => {
	try {
		return localStorage.getItem(SCHEME_KEY);
	} catch {
		return null;
	}
};
const systemLight = matchMedia("(prefers-color-scheme: light)");
const paintScheme = () => {
	const chosen = saved();
	document.documentElement.dataset.colorScheme = chosen === "light" || chosen === "dark" ? chosen : systemLight.matches ? "light" : "dark";
};
paintScheme();
systemLight.addEventListener("change", paintScheme);

const query = new URLSearchParams(location.search);
/** Where to go once logged in: a path on this server, never another origin (`//host` is one). */
const next = (() => {
	const asked = query.get("next") ?? "";
	return asked.startsWith("/") && !asked.startsWith("//") && !asked.startsWith("/\\") ? asked : "/";
})();
const approveCode = (query.get("approve") ?? "").trim().toUpperCase() || undefined;

type Phase = "loading" | "login" | "approve" | "approved" | "cancelled" | "unknown";
type Device = { label?: string; expires?: number };

async function json<T>(response: Response): Promise<T | undefined> {
	try {
		return (await response.json()) as T;
	} catch {
		return undefined;
	}
}

/** A JSON POST with this browser's cookie, to this server. */
function postJson(path: string, body: unknown): Promise<Response> {
	return fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** Seconds left before the server takes another try (its `retryAfter`), counted down once a second; `done` when it reaches nought. */
function createCountdown(done: () => void): [() => number, (seconds: number) => void] {
	const [wait, setWait] = createSignal(0);
	let timer: ReturnType<typeof setInterval> | undefined;
	onCleanup(() => clearInterval(timer));
	const start = (seconds: number) => {
		clearInterval(timer);
		setWait(Math.max(1, Math.ceil(seconds)));
		timer = setInterval(() => {
			const left = wait() - 1;
			setWait(Math.max(0, left));
			if (left <= 0) {
				clearInterval(timer);
				done();
			}
		}, 1000);
	};
	return [wait, start];
}

function LoginPage() {
	const [phase, setPhase] = createSignal<Phase>("loading");
	const [password, setPassword] = createSignal("");
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string>();
	const [device, setDevice] = createSignal<Device>({});
	let field: HTMLInputElement | undefined;
	const [wait, countDown] = createCountdown(() => {
		setError(undefined);
		queueMicrotask(() => field?.focus());
	});

	/** What the terminal is called, as the server has it; a code it does not know is said so before anything is pressed. */
	const lookUp = async (): Promise<boolean> => {
		if (!approveCode) return false;
		try {
			const response = await fetch(`/api/login/device?code=${encodeURIComponent(approveCode)}`, { credentials: "same-origin" });
			if (response.status === 404) {
				setPhase("unknown");
				return false;
			}
			if (response.ok) setDevice((await json<Device>(response)) ?? {});
		} catch {
			/* the label is a nicety: the code is shown either way */
		}
		return true;
	};

	const afterLogin = async () => {
		if (!approveCode) {
			location.replace(next);
			return;
		}
		if (await lookUp()) setPhase("approve");
	};

	onMount(async () => {
		try {
			const response = await fetch("/api/login/state", { credentials: "same-origin" });
			const state = response.ok ? await json<{ password: boolean; loggedIn: boolean }>(response) : undefined;
			if (state && (state.loggedIn || (!state.password && !approveCode))) {
				await afterLogin();
				return;
			}
		} catch {
			setError(m.login_unreachable());
		}
		if (approveCode) void lookUp();
		setPhase((now) => (now === "unknown" ? now : "login"));
		queueMicrotask(() => field?.focus());
	});

	const logIn = async (event: Event) => {
		event.preventDefault();
		if (busy() || wait() > 0 || !password()) return;
		setBusy(true);
		setError(undefined);
		try {
			const response = await postJson("/api/login/password", { password: password() });
			if (response.ok) {
				setPassword("");
				await afterLogin();
				return;
			}
			const answer = await json<{ error?: string; retryAfter?: number }>(response);
			if (response.status === 429) countDown(answer?.retryAfter ?? 30);
			else if (response.status === 403) setError(m.login_wrong());
			else setError(m.login_failed({ why: answer?.error ?? String(response.status) }));
			field?.select();
		} catch {
			setError(m.login_unreachable());
		} finally {
			setBusy(false);
		}
	};

	const approve = async () => {
		if (busy() || !approveCode) return;
		setBusy(true);
		setError(undefined);
		try {
			const response = await postJson("/api/login/device/approve", { code: approveCode });
			const answer = await json<{ label?: string; error?: string }>(response);
			if (response.ok) {
				if (answer?.label) setDevice((was) => ({ ...was, label: answer.label }));
				setPhase("approved");
			} else if (response.status === 404) setPhase("unknown");
			else if (response.status === 401) setPhase("login");
			else setError(m.login_failed({ why: answer?.error ?? String(response.status) }));
		} catch {
			setError(m.login_unreachable());
		} finally {
			setBusy(false);
		}
	};

	const errorLine = () => (wait() > 0 ? m.login_wait({ count: wait() }) : error());

	return (
		<main class="login-page">
			<div class="login-card float" data-phase={phase()}>
				<span class="panel-mark-glyph login-mark" aria-hidden="true">
					<DecksMark size={22} />
				</span>
				<h1>Decks</h1>
				<Switch>
					<Match when={phase() === "login"}>
						<PasswordForm
							field={(element) => (field = element)}
							password={password()}
							onPassword={setPassword}
							invalid={Boolean(errorLine())}
							disabled={busy() || wait() > 0 || !password()}
							onSubmit={(event) => void logIn(event)}
						/>
					</Match>
					<Match when={phase() === "approve"}>
						<ApproveView label={device().label} busy={busy()} onCancel={() => setPhase("cancelled")} onApprove={() => void approve()} />
					</Match>
					<Match when={phase() === "approved"}>
						<p class="login-done">{m.login_approved()}</p>
					</Match>
					<Match when={phase() === "cancelled"}>
						<p>{m.login_cancelled()}</p>
					</Match>
					<Match when={phase() === "unknown"}>
						<p>{m.login_code_unknown()}</p>
						<a class="login-btn login-link" href="/">
							{m.login_open_decks()}
						</a>
					</Match>
				</Switch>
				<p class="login-error" id="login-error" role="alert" aria-live="polite">
					{errorLine()}
				</p>
			</div>
		</main>
	);
}

/** The password and Log in, with what the page is for over them (logging in, or logging in to approve a terminal). */
function PasswordForm(props: { field: (element: HTMLInputElement) => void; password: string; onPassword: (value: string) => void; invalid: boolean; disabled: boolean; onSubmit: (event: Event) => void }) {
	return (
		<>
			<p>{approveCode ? m.login_approve_first() : m.login_sub()}</p>
			<form class="login-form" onSubmit={(event) => props.onSubmit(event)}>
				<input
					ref={props.field}
					class="login-field"
					type="password"
					name="password"
					autocomplete="current-password"
					autofocus
					aria-label={m.login_password_label()}
					placeholder={m.login_password_label()}
					aria-invalid={props.invalid || undefined}
					aria-describedby="login-error"
					value={props.password}
					onInput={(event) => props.onPassword(event.currentTarget.value)}
				/>
				<button class="login-btn" type="submit" data-primary disabled={props.disabled}>
					{m.login_submit()}
				</button>
			</form>
		</>
	);
}

/** The question for a terminal's code: which terminal, the code itself, Cancel and Approve. */
function ApproveView(props: { label?: string; busy: boolean; onCancel: () => void; onApprove: () => void }) {
	return (
		<>
			<p class="login-question">{props.label ? m.login_approve_title({ label: props.label }) : m.login_approve_title_plain()}</p>
			<p>{m.login_approve_sub()}</p>
			<code class="login-code">{m.login_approve_code({ code: approveCode ?? "" })}</code>
			<div class="login-actions">
				<button class="login-btn" type="button" disabled={props.busy} onClick={() => props.onCancel()}>
					{m.login_cancel()}
				</button>
				<button class="login-btn" type="button" data-primary disabled={props.busy} onClick={() => props.onApprove()}>
					{m.login_approve()}
				</button>
			</div>
		</>
	);
}

const root = document.getElementById("root");
if (!root) throw new Error("No #root to render into");
render(() => <LoginPage />, root);
