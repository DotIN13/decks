import { createEffect, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import Check from "lucide-solid/icons/check";
import CircleAlert from "lucide-solid/icons/circle-alert";
import CircleCheck from "lucide-solid/icons/circle-check";
import Copy from "lucide-solid/icons/copy";
import ExternalLink from "lucide-solid/icons/external-link";
import LoaderCircle from "lucide-solid/icons/loader-circle";
import X from "lucide-solid/icons/x";
import { Icon } from "@decks/ui";
import { m } from "@decks/i18n";
import { call } from "../state/socket.ts";
import { claudeLoginHeard, type ClaudeLoginOpen } from "../state/ui.ts";

/**
 * The Claude sign-in, one modal over everything (Settings included), owned by the page.
 *
 * It opens from Settings' Add account, from the server when a Claude agent starts with no account
 * (`account.needed`, why "no-account"), and from the person's /login (why "asked"). The flow is the
 * server's: `account.add` answers the CLI's sign-in link, `account.code` finishes it with the code the
 * browser gives back, and `account.cancel` stops one under way, which closing the modal mid-way does.
 * The server may also finish it by itself (`account.login`), heard here through `claudeLoginHeard`.
 */

type Method = "subscription" | "api";

/** Where the flow is: choosing, waiting for the link, holding the link, finishing, and the two ends. */
type Step =
	| { at: "choose" }
	| { at: "starting" }
	| { at: "link"; url: string }
	| { at: "finishing"; url: string }
	| { at: "done"; email?: string }
	| { at: "failed"; message: string };

/** Whether a flow is under way on the server, so a close has to stop it. */
const underWay = (step: Step) => step.at === "starting" || step.at === "link" || step.at === "finishing";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function ClaudeLogin(props: { open: ClaudeLoginOpen; onClose: () => void }) {
	const [step, setStep] = createSignal<Step>({ at: "choose" });
	const [method, setMethod] = createSignal<Method>("subscription");
	/** Bumped on every start and close, so an answer to a flow that is no longer on screen is dropped. */
	let flow = 0;
	const openedAt = Date.now();
	let dialog: HTMLDivElement | undefined;

	const start = async () => {
		const mine = ++flow;
		setStep({ at: "starting" });
		const answer = await call<{ url: string }>("account.add", [{ method: method() }]);
		if (mine !== flow) return;
		if (answer.ok && answer.value?.url) setStep({ at: "link", url: answer.value.url });
		else setStep({ at: "failed", message: answer.ok ? "" : answer.error });
	};

	const finish = async (code: string) => {
		const now = step();
		if (now.at !== "link" || !code) return;
		const mine = flow;
		setStep({ at: "finishing", url: now.url });
		const answer = await call<{ email?: string; replaced?: boolean }>("account.code", [code]);
		if (mine !== flow || step().at !== "finishing") return;
		setStep(answer.ok ? { at: "done", ...(answer.value?.email ? { email: answer.value.email } : {}) } : { at: "failed", message: answer.error });
	};

	// A flow the server finished by itself ends the second step the way the code's answer would.
	createEffect(
		on(claudeLoginHeard, (heard) => {
			if (!heard || heard.at < openedAt) return;
			const now = step().at;
			if (now !== "link" && now !== "finishing") return;
			flow++;
			setStep(heard.phase === "done" ? { at: "done", ...(heard.email ? { email: heard.email } : {}) } : { at: "failed", message: heard.message });
		}),
	);

	const close = () => {
		if (underWay(step())) void call("account.cancel", []);
		flow++;
		props.onClose();
	};

	onMount(() => {
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				// Ahead of Settings' own Escape, which would close the window under this one.
				event.preventDefault();
				event.stopPropagation();
				close();
			} else if (event.key === "Tab" && dialog) trapTab(event, dialog);
		};
		addEventListener("keydown", key, true);
		onCleanup(() => removeEventListener("keydown", key, true));
		(dialog?.querySelector<HTMLElement>("[data-autofocus]") ?? dialog?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
	});

	return (
		<div
			class="picker-backdrop cl-backdrop"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) close();
			}}
		>
			<div class="confirm-dlg cl-dlg" role="dialog" aria-modal="true" aria-label={m.claudelogin_title()} ref={dialog} data-step={step().at}>
				<div class="confirm-head">
					<span class="confirm-title">{m.claudelogin_title()}</span>
					<span class="flex-1" />
					<button class="confirm-x" type="button" aria-label={m.claudelogin_close()} onClick={close}>
						<Icon of={X} size={16} />
					</button>
				</div>
				<Show when={props.open.why === "no-account" && (step().at === "choose" || step().at === "starting")}>
					<p class="cl-why">{props.open.agent ? m.claudelogin_no_account_named({ agent: props.open.agent }) : m.claudelogin_no_account()}</p>
				</Show>
				<Switch>
					<Match when={step().at === "choose" || step().at === "starting"}>
						<ChooseStep method={method()} onMethod={setMethod} starting={step().at === "starting"} onContinue={() => void start()} onCancel={close} />
					</Match>
					<Match when={linkOf(step())}>{(url) => <LinkStep url={url()} finishing={step().at === "finishing"} onFinish={(code) => void finish(code)} onCancel={close} />}</Match>
					<Match when={doneOf(step())}>{(done) => <DoneStep email={done().email} onDone={props.onClose} />}</Match>
					<Match when={failedOf(step())}>{(failed) => <FailedStep message={failed().message} onAgain={() => setStep({ at: "choose" })} onClose={props.onClose} />}</Match>
				</Switch>
			</div>
		</div>
	);
}

const linkOf = (step: Step): string | false => (step.at === "link" || step.at === "finishing" ? step.url : false);
const doneOf = (step: Step) => (step.at === "done" ? step : false);
const failedOf = (step: Step) => (step.at === "failed" ? step : false);

/** Keep Tab and Shift-Tab inside the dialog. */
function trapTab(event: KeyboardEvent, dialog: HTMLElement) {
	const all = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
	if (!all.length) return;
	const first = all[0]!;
	const last = all[all.length - 1]!;
	const at = document.activeElement;
	if (event.shiftKey && (at === first || !dialog.contains(at))) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && (at === last || !dialog.contains(at))) {
		event.preventDefault();
		first.focus();
	}
}

function Spinner() {
	return (
		<span class="cl-spin" aria-hidden="true">
			<Icon of={LoaderCircle} size={15} />
		</span>
	);
}

/** Step one: which kind of account, then Continue. */
function ChooseStep(props: { method: Method; onMethod: (method: Method) => void; starting: boolean; onContinue: () => void; onCancel: () => void }) {
	const options = () => [
		{ id: "subscription" as const, title: m.claudelogin_subscription(), sub: m.claudelogin_subscription_sub() },
		{ id: "api" as const, title: m.claudelogin_api(), sub: m.claudelogin_api_sub() },
	];
	return (
		<>
			<div class="confirm-body cl-body">
				<p class="cl-lead">{m.claudelogin_choose()}</p>
				<div class="cl-options" role="radiogroup" aria-label={m.claudelogin_choose()}>
					<For each={options()}>
						{(option) => (
							<button
								class="cl-option"
								type="button"
								role="radio"
								aria-checked={props.method === option.id}
								data-on={props.method === option.id || undefined}
								disabled={props.starting}
								data-autofocus={props.method === option.id || undefined}
								onClick={() => props.onMethod(option.id)}
							>
								<span class="cl-radio" aria-hidden="true" />
								<span class="cl-option-text">
									<span class="cl-option-title">{option.title}</span>
									<span class="cl-option-sub">{option.sub}</span>
								</span>
							</button>
						)}
					</For>
				</div>
			</div>
			<div class="confirm-foot cl-foot">
				<Show when={props.starting}>
					<span class="cl-wait">
						<Spinner />
						{m.claudelogin_starting()}
					</span>
				</Show>
				<span class="flex-1" />
				<button class="btn" type="button" onClick={props.onCancel}>
					{m.claudelogin_cancel()}
				</button>
				<button class="btn" type="button" data-primary="true" disabled={props.starting} onClick={props.onContinue}>
					{m.claudelogin_continue()}
				</button>
			</div>
		</>
	);
}

/** Step two: the link to open (and to copy), and the code the browser gives back. */
function LinkStep(props: { url: string; finishing: boolean; onFinish: (code: string) => void; onCancel: () => void }) {
	const [code, setCode] = createSignal("");
	const [copied, setCopied] = createSignal(false);
	let field: HTMLInputElement | undefined;
	onMount(() => field?.focus());
	const copy = () => {
		void navigator.clipboard?.writeText(props.url).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1600);
		});
	};
	const submit = () => props.onFinish(code().trim());
	return (
		<>
			<div class="confirm-body cl-body">
				<p class="cl-lead">{m.claudelogin_link_lead()}</p>
				<button class="btn cl-open" type="button" data-primary="true" onClick={() => window.open(props.url, "_blank", "noopener,noreferrer")}>
					<Icon of={ExternalLink} size={14} />
					{m.claudelogin_open()}
				</button>
				<label class="cl-label">{m.claudelogin_link_label()}</label>
				<div class="cl-link">
					<input class="cl-url" readOnly value={props.url} aria-label={m.claudelogin_link_label()} onFocus={(event) => event.currentTarget.select()} />
					<button class="btn" type="button" onClick={copy}>
						<Icon of={copied() ? Check : Copy} size={13} />
						{copied() ? m.claudelogin_copied() : m.claudelogin_copy()}
					</button>
				</div>
				<label class="cl-label" for="cl-code">
					{m.claudelogin_code_label()}
				</label>
				<input
					id="cl-code"
					class="cl-code"
					ref={field}
					data-autofocus
					autocomplete="off"
					spellcheck={false}
					placeholder={m.claudelogin_code_placeholder()}
					value={code()}
					disabled={props.finishing}
					onInput={(event) => setCode(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && code().trim()) submit();
					}}
				/>
			</div>
			<div class="confirm-foot cl-foot">
				<Show when={props.finishing}>
					<span class="cl-wait">
						<Spinner />
						{m.claudelogin_finishing()}
					</span>
				</Show>
				<span class="flex-1" />
				<button class="btn" type="button" onClick={props.onCancel}>
					{m.claudelogin_cancel()}
				</button>
				<button class="btn" type="button" data-primary="true" disabled={props.finishing || !code().trim()} onClick={submit}>
					{m.claudelogin_finish()}
				</button>
			</div>
		</>
	);
}

/** Step three: who is signed in, and that every Claude agent picks it up. */
function DoneStep(props: { email: string | undefined; onDone: () => void }) {
	return (
		<>
			<div class="confirm-body cl-body cl-end">
				<span class="cl-end-icon" data-ok aria-hidden="true">
					<Icon of={CircleCheck} size={20} />
				</span>
				<div>
					<p class="cl-end-title">{props.email ? m.claudelogin_signed_in_as({ email: props.email }) : m.claudelogin_signed_in()}</p>
					<p class="cl-end-sub">{m.claudelogin_done_body()}</p>
				</div>
			</div>
			<div class="confirm-foot cl-foot">
				<button class="btn" type="button" data-primary="true" data-autofocus ref={(button) => queueMicrotask(() => button.focus())} onClick={props.onDone}>
					{m.claudelogin_done()}
				</button>
			</div>
		</>
	);
}

/** Or the flow failed: Claude's own sentence, and back to the start. */
function FailedStep(props: { message: string; onAgain: () => void; onClose: () => void }) {
	return (
		<>
			<div class="confirm-body cl-body cl-end">
				<span class="cl-end-icon" data-failed aria-hidden="true">
					<Icon of={CircleAlert} size={20} />
				</span>
				<div>
					<p class="cl-end-title">{m.claudelogin_failed()}</p>
					<Show when={props.message}>
						<p class="cl-end-sub">{props.message}</p>
					</Show>
				</div>
			</div>
			<div class="confirm-foot cl-foot">
				<button class="btn" type="button" onClick={props.onClose}>
					{m.claudelogin_close()}
				</button>
				<button class="btn" type="button" data-primary="true" ref={(button) => queueMicrotask(() => button.focus())} onClick={props.onAgain}>
					{m.claudelogin_try_again()}
				</button>
			</div>
		</>
	);
}
