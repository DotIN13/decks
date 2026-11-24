import KeyRound from "lucide-solid/icons/key-round";
import LogOut from "lucide-solid/icons/log-out";
import LockKeyhole from "lucide-solid/icons/lock-keyhole";
import { createSignal, onMount, Show } from "solid-js";
import { Icon } from "@decks/ui";
import { m } from "@decks/i18n";
import { authHeaders } from "../lib/session.ts";
import { ask } from "../state/confirm.ts";
import { notice } from "../state/notices.ts";
import { SetGroup, SetRow } from "./rows.tsx";

/**
 * The deck's password in Settings, Accounts (`server/src/auth/password.ts`): whether this browser is
 * logged in with it, signing this browser out, signing every browser and terminal out, and changing
 * it. Shown only when the server says a password is set (`/api/login/state`); with none, one row says
 * how to set one, which is done on the Mac itself (`decks password set`), never from a browser.
 *
 * Signing out is the server's: the login cookie is HttpOnly, so this page cannot drop it itself.
 */
const MIN_LENGTH = 10;

type LoginState = { enabled: boolean; password: boolean; loggedIn: boolean };

async function errorOf(response: Response): Promise<string | undefined> {
	try {
		return ((await response.json()) as { error?: string }).error;
	} catch {
		return undefined;
	}
}

function post(path: string, body?: unknown): Promise<Response> {
	return fetch(path, {
		method: "POST",
		credentials: "same-origin",
		headers: { ...authHeaders(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

/** POST and reload on success (the server has dropped this browser's login), or say why not. */
async function postThenReload(path: string): Promise<void> {
	try {
		const response = await post(path);
		if (!response.ok) notice("error", (await errorOf(response)) ?? m.settings_password_unreachable());
		else location.reload();
	} catch {
		notice("error", m.settings_password_unreachable());
	}
}

/** The group's actions, sharing one busy flag so only one request is out at a time. */
function passwordActions() {
	const [busy, setBusy] = createSignal(false);
	const run = async (work: () => Promise<void>) => {
		if (busy()) return;
		setBusy(true);
		try {
			await work();
		} finally {
			setBusy(false);
		}
	};
	const signOut = () => run(() => postThenReload("/api/logout"));
	const signOutEverywhere = async () => {
		if (busy()) return;
		const yes = await ask({
			title: m.settings_password_everywhere_confirm_title(),
			body: m.settings_password_everywhere_confirm_body(),
			yes: m.settings_password_everywhere_confirm_yes(),
			no: m.settings_password_everywhere_confirm_no(),
			danger: true,
		});
		if (yes) await run(() => postThenReload("/api/login/everywhere"));
	};
	return { busy, run, signOut, signOutEverywhere };
}

const mark = (icon: typeof KeyRound) => (
	<span class="sw-mark">
		<Icon of={icon} size={14} />
	</span>
);

export function PasswordGroup() {
	const [state, setState] = createSignal<LoginState>();
	const actions = passwordActions();

	onMount(async () => {
		try {
			const response = await fetch("/api/login/state", { credentials: "same-origin" });
			if (response.ok) setState((await response.json()) as LoginState);
		} catch {
			/* a server with no password login: the group is not shown */
		}
	});

	return (
		<Show when={state()?.enabled ? state() : undefined}>
			{(known) => (
				<SetGroup label={m.settings_password_group()} group="password">
					<Show when={known().password} fallback={<SetRow lead={mark(KeyRound)} title={m.settings_password_none()} sub={m.settings_password_none_sub()} />}>
						<Show
							when={known().loggedIn}
							fallback={<SetRow lead={mark(KeyRound)} title={m.settings_password_not_this_browser()} sub={m.settings_password_not_this_browser_sub()} />}
						>
							<SetRow lead={mark(KeyRound)} title={m.settings_password_this_browser()} sub={m.settings_password_this_browser_sub()}>
								<button class="sw-btn" type="button" data-password="sign-out" disabled={actions.busy()} onClick={() => void actions.signOut()}>
									{m.settings_password_sign_out()}
								</button>
							</SetRow>
						</Show>
						<SetRow lead={mark(LogOut)} title={m.settings_password_everywhere()} sub={m.settings_password_everywhere_sub()}>
							<button class="sw-btn" type="button" data-tone="danger" data-password="everywhere" disabled={actions.busy()} onClick={() => void actions.signOutEverywhere()}>
								{m.settings_password_everywhere_button()}
							</button>
						</SetRow>
						<ChangePasswordRows busy={actions.busy()} run={actions.run} />
					</Show>
				</SetGroup>
			)}
		</Show>
	);
}

/** Change password: its row with the button and the server's answer, then current, new and repeat. */
function ChangePasswordRows(props: { busy: boolean; run: (work: () => Promise<void>) => Promise<void> }) {
	const [current, setCurrent] = createSignal("");
	const [fresh, setFresh] = createSignal("");
	const [repeat, setRepeat] = createSignal("");
	const [problem, setProblem] = createSignal<string>();

	const change = async () => {
		if (props.busy || !current() || !fresh()) return;
		if (fresh().length < MIN_LENGTH) return setProblem(m.settings_password_too_short());
		if (fresh() !== repeat()) return setProblem(m.settings_password_mismatch());
		setProblem(undefined);
		await props.run(async () => {
			try {
				const response = await post("/api/password", { current: current(), password: fresh() });
				if (!response.ok) {
					setProblem((await errorOf(response)) ?? m.settings_password_unreachable());
					return;
				}
				setCurrent("");
				setFresh("");
				setRepeat("");
				notice("info", m.settings_password_changed());
			} catch {
				setProblem(m.settings_password_unreachable());
			}
		});
	};
	const onEnter = (event: KeyboardEvent) => event.key === "Enter" && void change();

	return (
		<>
			<SetRow
				lead={mark(LockKeyhole)}
				title={m.settings_password_change()}
				sub={
					<>
						{m.settings_password_change_sub()}
						<Show when={problem()}>
							<span class="sw-studio-failed"> {problem()}</span>
						</Show>
			
		</>
			}
		>
			<button class="sw-btn" type="button" data-password="change" disabled={props.busy || !current() || !fresh() || !repeat()} onClick={() => void change()}>
				{m.settings_password_change_button()}
			</button>
		</SetRow>
		<SetRow lead={<span class="sw-mark" data-empty />} title={m.settings_password_current()}>
			<input
				class="sw-field"
				type="password"
				autocomplete="current-password"
				aria-label={m.settings_password_current()}
				placeholder={m.settings_password_current()}
				value={current()}
				onInput={(event) => setCurrent(event.currentTarget.value)}
				onKeyDown={onEnter}
			/>
		</SetRow>
		<SetRow lead={<span class="sw-mark" data-empty />} title={m.settings_password_new()}>
			<input
				class="sw-field"
				type="password"
				autocomplete="new-password"
				minLength={MIN_LENGTH}
				aria-label={m.settings_password_new()}
				placeholder={m.settings_password_new()}
				value={fresh()}
				onInput={(event) => setFresh(event.currentTarget.value)}
				onKeyDown={onEnter}
			/>
		</SetRow>
		<SetRow lead={<span class="sw-mark" data-empty />} title={m.settings_password_repeat()}>
			<input
				class="sw-field"
				type="password"
				autocomplete="new-password"
				aria-label={m.settings_password_repeat()}
				placeholder={m.settings_password_repeat()}
				value={repeat()}
				onInput={(event) => setRepeat(event.currentTarget.value)}
				onKeyDown={onEnter}
			/>
		</SetRow>
		</>
	);
}
