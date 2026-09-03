import type { ClaudeAccount } from "@decks/protocol";
import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import { For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { Icon } from "../icons.tsx";

/**
 * The Claude subscriptions this install can use.
 *
 * A subscription has a rate limit, and reaching it stops the work — so somebody with two
 * accounts wants the second one to take over rather than to be told to come back in four
 * hours. Several can be signed in at once, one is active, and reaching a limit moves the
 * active one along on its own (`claude/accounts.ts`).
 *
 * **The switch is seamless.** The CLI re-reads its credentials per request and every session
 * is pointed at a symlink, so moving that link changes which subscription the *next turn*
 * spends — no session restart, no interrupted conversation. Which is why this panel says
 * "now using" rather than "will use from the next chat".
 *
 * A modal rather than a panel, for the reason the all-canvases modal is one: this is a thing
 * you open, do, and close. It borrows the picker's backdrop — open, read, dismiss is one set
 * of rules about how a press outside dismisses it.
 *
 * ### What a row can be
 *
 * **Active** is the one spending. **Limited** is one that ran out, with the time it comes
 * back — kept because it is worth seeing why the deck moved off it, and because clicking it
 * anyway is allowed: the reset time is right there, and somebody who picks it regardless
 * either knows better than the memory or wants to find out.
 *
 * **Signed out** is a row with no token behind it — the CLI's own login after a
 * `claude auth logout`, or an account whose credentials were revoked. It cannot be switched
 * to, and it says so rather than being hidden: an account you added and cannot use is a fact
 * worth showing, and hiding it would leave the list disagreeing with what you remember doing.
 */
export function Settings(props: {
	accounts: ClaudeAccount[];
	/** The id of the one in force. */
	active: string;
	onAdd: () => void;
	onUse: (id: string) => void;
	onForget: (id: string) => void;
	onClose: () => void;
}) {
	/*
	 * Escape closes it, from anywhere.
	 *
	 * On the window rather than on the card: a `keydown` handler on a div only fires while
	 * focus is inside it, and this modal has nothing that takes focus on open — so the key did
	 * nothing at all unless you had first clicked a row. The browse modal gets away with the
	 * same arrangement because its search field is focused as it appears.
	 */
	onMount(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			event.preventDefault();
			props.onClose();
		};
		window.addEventListener("keydown", onKey);
		onCleanup(() => window.removeEventListener("keydown", onKey));
	});

	return (
		/*
		 * Dismissed by a press that *begins* on the backdrop, for the reason `FilePicker`
		 * documents at length: the tap that opened this produces a `click` at the same
		 * coordinates afterwards, and a modal that closes itself on the way in is worse than
		 * one that will not close at all.
		 */
		<div
			class="picker-backdrop"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) props.onClose();
			}}
		>
			<div
				class="panel-float settings static flex max-h-[80%] w-[min(520px,calc(100vw-24px))] flex-col overflow-hidden bg-bg p-0"
				role="dialog"
				aria-label="Settings"
			>
				<header class="label flex items-center gap-2 border-b border-line py-2 pr-2.5 pl-3">
					<span>Claude accounts</span>
					<span class="flex-1" />
					<button class="icon-button" type="button" title="Close" aria-label="Close" onClick={props.onClose}>
						<Icon of={X} size={16} />
					</button>
				</header>

				<div class="flex flex-col gap-1 overflow-y-auto overscroll-contain p-2">
					<For each={props.accounts}>
						{(account) => (
							<Row
								account={account}
								active={props.active === account.id}
								onUse={() => props.onUse(account.id)}
								onForget={() => props.onForget(account.id)}
							/>
						)}
					</For>
				</div>

				<footer class="flex items-center gap-2 border-t border-line px-2 py-2">
					{/*
						Signing in adds an account rather than replacing one: the CLI writes its
						credentials wherever it is pointed, so each login gets a directory of its own.
					*/}
					<button
						class="flex cursor-pointer items-center gap-1.5 rounded-control border-0 bg-line px-2.5 py-1.5 text-[12px] text-fg hover:bg-line-strong"
						type="button"
						onClick={props.onAdd}
					>
						<Icon of={Plus} size={14} />
						Add an account
					</button>
					<span class="flex-1" />
					{/*
						The account in use being unusable is the one state worth saying twice: nothing
						will run at all, and the row's own word for it is small and easy to miss.
					*/}
					<Show
						when={props.accounts.find((account) => account.id === props.active && !account.signedIn)}
						fallback={
							<span class="text-[11px] text-faint">
								{props.accounts.length === 1 ? "One account — add another to switch when it runs out" : "Switches on its own when one runs out"}
							</span>
						}
					>
						<span class="text-[11px] text-warn">The account in use is signed out. Add it again, or pick another.</span>
					</Show>
				</footer>
			</div>
		</div>
	);
}

function Row(props: { account: ClaudeAccount; active: boolean; onUse: () => void; onForget: () => void }) {
	const limited = () => {
		const until = props.account.limitedUntil;
		return until && until > Date.now() ? until : undefined;
	};
	/** What to call it: the email, or something honest when the CLI has not said. */
	const name = () => props.account.email ?? (props.account.isDefault ? "Claude Code's own login" : "an account with no name yet");
	/**
	 * Why this row has no ×, said on the row.
	 *
	 * "Claude Code's own login" used to be a *fallback* for the name — so it only ever
	 * appeared when the CLI reported no email, which is the one case where the row is already
	 * unmistakable. With an email to show, the row read as an ordinary account that happened
	 * to have no delete button, and the missing button looked arbitrary. It is the one fact
	 * about this row a person needs: these credentials are the CLI's, and
	 * `claude auth logout` is where they are given up.
	 */
	const whose = () => (props.account.isDefault && props.account.email ? "Claude Code's own login" : undefined);
	/**
	 * The row's tooltip: what pressing it does, and — on the CLI's own row — why there is
	 * nothing to press to remove it.
	 *
	 * A sentence rather than a second control, because the honest answer is a shell command
	 * this app should not be running on your behalf: it would sign you out of `claude`
	 * everywhere on the machine, from a panel that looks like it is about Decks.
	 */
	const title = () => {
		const act = props.active
			? "The account in use now"
			: props.account.signedIn
				? `Use ${name()} from now on`
				: props.account.isDefault
					? "Claude Code is signed out — sign in with claude auth login"
					: "Signed out — add it again to use it";
		return props.account.isDefault
			? `${act}. These are Claude Code's own credentials, so Decks cannot remove them: claude auth logout gives them up.`
			: act;
	};

	return (
		/*
		 * The wrapper draws the row and the × sits inside it, because a button inside a button
		 * is invalid markup — the same arrangement `.chat-row-wrap` uses, and for the same
		 * reason.
		 */
		<div class="account-row flex items-center gap-1" data-current={props.active}>
			<button
				class="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-px rounded-control border-0 bg-transparent px-2.5 py-2 text-left hover:bg-line disabled:cursor-default disabled:opacity-55 disabled:hover:bg-transparent"
				type="button"
				disabled={!props.account.signedIn || props.active}
				title={title()}
				onClick={props.onUse}
			>
				<span class="flex w-full items-baseline gap-2">
					<span class="truncate text-[13px] text-fg">{name()}</span>
					<Show when={props.account.plan}>{(plan) => <span class="flex-none text-[11px] text-faint">{plan()}</span>}</Show>
				</span>
				<span class="flex w-full items-baseline gap-1.5 text-[11px]">
					{/* Before the organisation, and dimmer: what the row *is* comes before what the
					    account belongs to, and neither should out-shout the email above them. */}
					<Show when={whose()}>{(said) => <span class="flex-none text-faint">{said()}</span>}</Show>
					{/* Only between two things: the app's separator everywhere else, and without it two
					    greys sit 6px apart and read as one run of words. */}
					<Show when={whose() && props.account.orgName}>
						<span class="flex-none text-faint">·</span>
					</Show>
					<Show when={props.account.orgName}>
						{(org) => <span class="truncate text-muted">{org()}</span>}
					</Show>
					<span class="flex-1" />
					{/*
						**One status, not a pile of them.** The first draft drew each condition
						independently and produced rows reading "active · signed out", which is two
						claims that cannot both be acted on — and a *limited* account that was also
						signed out showed only the signing-out, hiding the reset time behind the worse
						problem.

						So they are ranked, worst first. Signed out beats everything, because a row
						with no token cannot be used whatever else is true of it. A limit beats being
						active, because it is the thing that changed and the thing with a time
						attached — and when both are true the row says so, since "the account in use
						has run out" is exactly what a person needs to read. Said in words rather than
						by colour alone: "active" and "limited" one hue apart is a distinction nobody
						has to be able to see.
					*/}
					<Switch>
						<Match when={!props.account.signedIn}>
							<span class="state flex-none text-faint">{props.active ? "signed out — nothing can run" : "signed out"}</span>
						</Match>
						<Match when={limited()}>
							{(until) => (
								<span class="state flex-none text-warn" title={props.account.limitType ? `The ${props.account.limitType} window ran out` : undefined}>
									{props.active ? "active · limited" : "limited"} · back {when(until())}
								</span>
							)}
						</Match>
						<Match when={props.active}>
							<span class="state flex-none text-accent">active</span>
						</Match>
					</Switch>
				</span>
			</button>

			{/*
				The CLI's own login has no × — those credentials are not Decks' to delete, and
				`claude auth logout` is where they are given up.
			*/}
			<Show when={!props.account.isDefault}>
				<button
					class="close"
					type="button"
					title={`Forget ${name()} and remove its credentials from this machine`}
					aria-label={`Forget ${name()}`}
					onClick={(event) => {
						event.stopPropagation();
						props.onForget();
					}}
				>
					<Icon of={X} size={13} />
				</button>
			</Show>
		</div>
	);
}

/**
 * When a limit lifts, at a glance.
 *
 * A time for today and a date for anything further out, because "back at 14:20" is
 * information and "back 2026-09-02T14:20:00Z" is a string to decode.
 */
function when(at: number): string {
	const date = new Date(at);
	const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	if (new Date().toDateString() === date.toDateString()) return `at ${time}`;
	return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time}`;
}
