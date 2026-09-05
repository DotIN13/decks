import type { ClaudeAccount } from "@decks/protocol";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import { For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { Icon } from "../icons.tsx";
import { AlertSettings } from "./AlertSettings.tsx";
import { canMove, nextUp } from "../lib/accounts.ts";
import type { AlertPrefs } from "../lib/alerts.ts";

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
	/** What the app may interrupt you with (`AlertSettings.tsx`). */
	prefs: AlertPrefs;
	onPrefs: (prefs: AlertPrefs) => void;
	accounts: ClaudeAccount[];
	/** The id of the one in force. */
	active: string;
	onAdd: () => void;
	onUse: (id: string) => void;
	onForget: (id: string) => void;
	/** Change who a limit moves to first. The list is the priority (`lib/accounts.ts`). */
	onMove: (id: string, direction: "up" | "down") => void;
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
	/**
	 * The row a limit would hand over to, so the order can be seen and not only set.
	 *
	 * Computed here rather than sent: everything the rule needs is already on the wire, and a
	 * "next" the server had decided would be stale the moment an account was spent.
	 */
	const next = () => nextUp(props.accounts, props.active);

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
			<div class="panel-float settings static flex max-h-[84%] w-[min(560px,calc(100vw-24px))] flex-col overflow-hidden p-0" role="dialog" aria-label="Settings">
				{/*
					A title, not a section label.
					
					The header used to say "Claude accounts" in the 10px `.label` the panels use for a
					heading *inside* a list — which was right when the modal was one list and wrong the
					moment it was two. A window has a name at the size of a name, and the groups below
					carry the section headings now.
				*/}
				<header class="set-head">
					<span class="set-head-title">Settings</span>
					<span class="flex-1" />
					<button class="iconbtn [--control:26px]" type="button" title="Close" aria-label="Close" onClick={props.onClose}>
						<Icon of={X} size={15} />
					</button>
				</header>

				{/*
					Grouped rows on a recessed ground, which is the shape every settings screen worth
					copying has converged on — and it is this app's own shape too: a `--panel` surface
					standing on `--bg-deep` is what a float is against the canvas.

					Notifications first, accounts second, and the order is not alphabetical: this is the
					part somebody opens the modal to change, and accounts is the part they set up once.
				*/}
				<div class="set-body">
					<AlertSettings prefs={props.prefs} onChange={props.onPrefs} />

					<section class="set-group" data-group="accounts">
						<header>
							<span class="set-title">Claude accounts</span>
							{/*
								The group's own state, where a footer note used to be. A sentence about
								accounts belongs to the accounts group rather than to the window, which is
								what made it look like a status line for the whole modal.
							*/}
							<Show
								when={props.accounts.find((account) => account.id === props.active && !account.signedIn)}
								fallback={
									<span class="set-note">
										{props.accounts.length === 1
											? "Add another to switch when this one runs out."
											: "When one runs out it moves down this list — use the arrows to set the order."}
									</span>
								}
							>
								<span class="set-note text-warn">The account in use is signed out. Add it again, or pick another.</span>
							</Show>
						</header>

						{/* `rowlist`, so each account is the same row as a described choice anywhere else in
						    the app — `styles/chrome.css` owns the grid, the corner, the hover and the
						    `.lb`/`.nt` type scale. */}
						<div class="rowlist set-rows">
							<For each={props.accounts}>
								{(account) => (
									<Row
										account={account}
										active={props.active === account.id}
										next={next() === account.id}
										canUp={props.accounts.length > 1 && canMove(props.accounts, account.id, "up")}
										canDown={props.accounts.length > 1 && canMove(props.accounts, account.id, "down")}
										onUse={() => props.onUse(account.id)}
										onForget={() => props.onForget(account.id)}
										onMove={(direction) => props.onMove(account.id, direction)}
									/>
								)}
							</For>
						</div>

						{/*
							Inside the group rather than in a window footer, because signing in is a thing
							you do *to this list*. The footer it left behind held one button and one
							sentence, both about accounts, on a bar that spanned a modal which is mostly
							not about accounts.

							Signing in adds an account rather than replacing one: the CLI writes its
							credentials wherever it is pointed, so each login gets a directory of its own.
						*/}
						<button class="set-add" type="button" onClick={props.onAdd}>
							<Icon of={Plus} size={14} />
							Add an account
						</button>
					</section>
				</div>
			</div>
		</div>
	);
}

function Row(props: {
	account: ClaudeAccount;
	active: boolean;
	/** Whether this is the one a limit would move to — the top usable row that is not in use. */
	next: boolean;
	canUp: boolean;
	canDown: boolean;
	onUse: () => void;
	onForget: () => void;
	onMove: (direction: "up" | "down") => void;
}) {
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
		 * is invalid markup. That arrangement is `.row-act` in `chrome.css` now — the agent
		 * dropdown wanted the same thing, and this file's version of it was the reason the
		 * wash, the reveal and the 22px slot had to be argued twice. What is left on
		 * `.account-row` is only what is true of *accounts*: the accent tint on the one in
		 * use, and the fact that its row is disabled without being dimmed.
		 */
		<div class="account-row row-act" data-current={props.active}>
			<button class="min-w-0 flex-1" type="button" data-row disabled={!props.account.signedIn || props.active} title={title()} onClick={props.onUse}>
				<span class="lb w-full items-baseline">
					<span class="truncate">{name()}</span>
					<Show when={props.account.plan}>{(plan) => <span class="meta flex-none">{plan()}</span>}</Show>
				</span>
				<span class="nt flex w-full items-baseline gap-1.5">
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
						{/*
							The only row that says what the arrows *did*. Ranked below every other
							state for the same reason they are ranked among themselves: "next" is a
							plan, and a row that is signed out or spent has something truer to say.
						*/}
						<Match when={props.next}>
							<span class="state flex-none text-muted">next</span>
						</Match>
					</Switch>
				</span>
			</button>

			{/*
				The order, one step at a time.
				*
				* Not drag-and-drop: this list is two or three rows in a modal, a drag needs a
				* handle and a drop target and an answer for what a half-finished one means, and
				* two arrows need none of that. They are `.close`-shaped so they live in the same
				* revealed slot the × does — a column of arrows standing at rest would make a
				* settings list look like a queue you were meant to be managing.
				*
				* Disabled at the ends rather than hidden: a button that disappears at the top of
				* the list is a row that changes shape as it moves.
			*/}
			<Show when={props.canUp || props.canDown}>
				<button
					class="close rank"
					type="button"
					disabled={!props.canUp}
					title={`Try ${name()} sooner when an account runs out`}
					aria-label={`Move ${name()} up`}
					onClick={(event) => {
						event.stopPropagation();
						props.onMove("up");
					}}
				>
					<Icon of={ChevronUp} size={13} />
				</button>
				<button
					class="close rank"
					type="button"
					disabled={!props.canDown}
					title={`Try ${name()} later when an account runs out`}
					aria-label={`Move ${name()} down`}
					onClick={(event) => {
						event.stopPropagation();
						props.onMove("down");
					}}
				>
					<Icon of={ChevronDown} size={13} />
				</button>
			</Show>

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
