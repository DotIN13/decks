import type { ClaudeAccount, WebStatus } from "@decks/protocol";
import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { RENDERERS, type RendererChoice } from "../lib/renderer.ts";
import { Icon } from "../icons.tsx";
import { AlertSettings } from "../alerts/AlertSettings.tsx";
import type { AlertPrefs } from "../alerts/policy.ts";

/**
 * The Claude subscriptions this install can use.
 *
 * A subscription has a rate limit, and reaching it stops the work — so somebody with two
 * accounts wants a way to carry on on the other one. Several can be signed in at once, and
 * **which one a conversation spends is chosen in that conversation's model picker**
 * (`claude/accounts.ts`). Nothing switches by itself, and there is no order to set: this
 * panel is where accounts are added and removed, and that is all it is.
 *
 * **The switch is seamless.** The CLI re-reads its credentials per request and every session
 * is pointed at a symlink, so moving that link changes which subscription the *next turn*
 * spends — no session restart, no interrupted conversation.
 *
 * A modal rather than a panel, for the reason the all-canvases modal is one: this is a thing
 * you open, do, and close. It borrows the picker's backdrop — open, read, dismiss is one set
 * of rules about how a press outside dismisses it.
 *
 * ### What a row can be
 *
 * **Signed out** is a row with no token behind it — the CLI's own login after a
 * `claude auth logout`, or an account whose credentials were revoked. It cannot be switched
 * to, and it says so rather than being hidden: an account you added and cannot use is a fact
 * worth showing, and hiding it would leave the list disagreeing with what you remember doing.
 *
 * **Default for new** is where a conversation starts if nobody chooses. One row at most, and
 * it is the server's answer rather than this panel's rule — there is no list to walk any
 * more, so it is the CLI's own login unless that has no token.
 */
export function Settings(props: {
	/** What the app may interrupt you with (`alerts/AlertSettings.tsx`). */
	prefs: AlertPrefs;
	onPrefs: (prefs: AlertPrefs) => void;
	/**
	 * The install's Claude subscriptions — the set of them, and nothing about who is using
	 * them.
	 *
	 * This panel adds accounts and removes them. Choosing which one answers is done in a
	 * conversation's own model picker, because that is what the choice is about.
	 */
	accounts: ClaudeAccount[];
	/**
	 * Where a conversation starts when nobody has chosen, from the server (`defaultId`).
	 *
	 * Sent rather than worked out here. The rule used to be duplicated in the browser so
	 * that the arrows could be seen to do something — there are no arrows now, and one
	 * implementation of a rule is the right number.
	 */
	active: string;
	onAdd: () => void;
	onForget: (id: string) => void;
	/**
	 * The user's own Chrome, shared with the deck through the Decks extension
	 * (`server/web/bridge.ts`). The code is what the extension is paired with; the address
	 * is this page's own origin, because that is the address the browser reached Decks at.
	 */
	web?: { status: WebStatus; code?: string };
	/** A fresh pairing code. The extension has to be paired again. */
	onWebRepair: () => void;
	/** Let go of the shared tab. */
	onWebStop: () => void;
	/** Put the status board on the canvas. */
	onWebBoard: () => void;
	/** How boards are drawn (`lib/renderer.ts`), and whether this browser can do the canvas ones. */
	renderer: RendererChoice;
	onRenderer: (choice: RendererChoice) => void;
	canvasApi: boolean;
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
							{/*
								What this list is *for*, now that it does not switch anything.

								Choosing which subscription answers is done per conversation, in the model
								picker — so all that is left here is the set of accounts and their order,
								and the note says both of the things the order decides. A settings panel
								that also carried a machine-wide switch was offering a control that moved
								nobody: every open conversation keeps its own account.
							*/}
							<span class="set-note">
								{props.accounts.length === 1
									? "Add another to have somewhere to go when this one runs out. Pick per conversation in the model picker."
									: "Each conversation spends one of these, chosen in its own model picker. Nothing switches on its own."}
							</span>
						</header>

						{/* `rowlist`, so each account is the same row as a described choice anywhere else in
						    the app — `styles/chrome.css` owns the grid, the corner, the hover and the
						    `.lb`/`.nt` type scale. */}
						<div class="rowlist set-rows">
							<For each={props.accounts}>
								{(account) => (
									<Row
										account={account}
										next={props.active === account.id && account.signedIn}
										onForget={() => props.onForget(account.id)}
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

					<RendererSettings renderer={props.renderer} onChange={props.onRenderer} canvasApi={props.canvasApi} />
					<YourChrome web={props.web} onRepair={props.onWebRepair} onStop={props.onWebStop} onBoard={props.onWebBoard} />
				</div>
			</div>
		</div>
	);
}

function Row(props: {
	account: ClaudeAccount;
	/** Whether a conversation that has not chosen would start here. */
	next: boolean;
	onForget: () => void;
}) {
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
		const act = props.account.signedIn
			? `${name()} — choose it for a conversation in its model picker`
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
		 * `.account-row` is only what is true of *accounts*: the accent tint on the default
		 * row, and the fact that its row is disabled without being dimmed.
		 */
		<div class="account-row row-act" data-current={props.next}>
			{/*
				A `div`, not a `button`. Pressing a row used to switch the whole machine to it;
				there is nothing to press now, and a row that still looked pressable would be
				the same lie in a quieter form. The one control that remains — the × — is a
				button of its own inside it.
			*/}
			<div class="min-w-0 flex-1" data-row title={title()}>
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
						**One status, not a pile of them.** An early draft drew each condition
						independently and produced rows reading "default for new · signed out", which
						is two claims that cannot both be acted on.

						So they are ranked, worst first. Signed out beats everything, because a row
						with no token cannot be used whatever else is true of it. "Default for new" is
						a plan, and a row that cannot be used has something truer to say. There is no
						"active": which subscription is answering is a property of a conversation, and
						it is said in that conversation's model picker.

						There used to be a third state — "limited · back at 14:20", a remembered rate
						limit. It is gone with the automatic switching that needed it: nothing
						re-checked it, so a row could sit marked spent long after its window had
						lifted. A limit is now said in the conversation that hit it, at the moment it
						happens, which is the only place the claim is known to be true.
					*/}
					<Switch>
						<Match when={!props.account.signedIn}>
							<span class="state flex-none text-faint">signed out</span>
						</Match>
						<Match when={props.next}>
							<span class="state flex-none text-accent">default for new</span>
						</Match>
					</Switch>
				</span>
			</div>

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
 * The shared Chrome: what to paste into the extension, and what is shared right now.
 *
 * Last, because it is set up once. The address is `location.origin` rather than anything
 * the server knows — the server sees loopback behind a proxy, and the one address that is
 * certainly right is the one this page was loaded from.
 */
function YourChrome(props: { web?: { status: WebStatus; code?: string }; onRepair: () => void; onStop: () => void; onBoard: () => void }) {
	const [copied, setCopied] = createSignal<"address" | "code" | undefined>(undefined);
	const copy = async (what: "address" | "code", text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(what);
			setTimeout(() => setCopied(undefined), 1500);
		} catch {
			/* no clipboard on this origin; the text is on screen to select */
		}
	};
	const status = () => props.web?.status;
	const note = () => {
		const now = status();
		if (!now) return "Waiting for the server to say.";
		if (now.connected) return `Sharing ${now.tabs.length === 1 ? "one tab" : `${now.tabs.length} tabs`}. Agents can read and fill it; submitting asks you first, on the status board.`;
		if (now.paired) return "Paired. Nothing is shared: press the Decks button in Chrome on the tab an agent should work in.";
		return "Install the extension (extension/ in the repo, loaded unpacked), then paste these two lines into its Pairing section.";
	};
	return (
		<section class="set-group" data-group="web">
			<header>
				<span class="set-title">Your Chrome</span>
				<span class="set-note">{note()}</span>
			</header>
			<div class="rowlist set-rows">
				<div class="row-act" data-row-static>
					<div class="min-w-0 flex-1" data-row>
						<span class="lb w-full items-baseline">
							<span class="truncate">Decks address</span>
						</span>
						<span class="nt flex w-full items-baseline gap-1.5">
							<span class="truncate font-mono text-muted">{location.origin}</span>
						</span>
					</div>
					<button class="set-mini" type="button" onClick={() => void copy("address", location.origin)}>
						{copied() === "address" ? "Copied" : "Copy"}
					</button>
				</div>
				<div class="row-act" data-row-static>
					<div class="min-w-0 flex-1" data-row>
						<span class="lb w-full items-baseline">
							<span class="truncate">Pairing code</span>
						</span>
						<span class="nt flex w-full items-baseline gap-1.5">
							<span class="truncate font-mono text-muted">{props.web?.code ?? "…"}</span>
						</span>
					</div>
					<button class="set-mini" type="button" disabled={!props.web?.code} onClick={() => props.web?.code && void copy("code", props.web.code)}>
						{copied() === "code" ? "Copied" : "Copy"}
					</button>
					<button class="set-mini" type="button" title="Mint a fresh code; the extension has to be paired again" onClick={props.onRepair}>
						New code
					</button>
				</div>
				<For each={status()?.tabs ?? []}>
					{(tab) => (
						<div class="row-act" data-row-static>
							<div class="min-w-0 flex-1" data-row>
								<span class="lb w-full items-baseline">
									<span class="truncate">{tab.title || "(untitled)"}</span>
									<span class="state flex-none text-accent">shared</span>
								</span>
								<span class="nt flex w-full items-baseline gap-1.5">
									<span class="truncate font-mono text-muted">{tab.url}</span>
								</span>
							</div>
						</div>
					)}
				</For>
			</div>
			<div class="flex gap-2">
				<button class="set-add" type="button" onClick={props.onBoard}>
					Show the status board
				</button>
				<Show when={status()?.connected}>
					<button class="set-add" type="button" onClick={props.onStop}>
						Stop sharing
					</button>
				</Show>
			</div>
		</section>
	);
}


/**
 * Which renderer draws the boards (`lib/renderer.ts`).
 *
 * One segmented control rather than three switches, because the choice is one of three and
 * a switch is a yes or no. The note under the row is the part that matters on a browser
 * without the API: the choice is kept, and this says which renderer is actually running.
 */
function RendererSettings(props: { renderer: RendererChoice; onChange: (choice: RendererChoice) => void; canvasApi: boolean }) {
	const running = () => (props.canvasApi || props.renderer === "dom" ? props.renderer : "dom");
	const note = () => {
		const chosen = RENDERERS.find((option) => option.id === props.renderer);
		if (!props.canvasApi && props.renderer !== "dom")
			return `This browser has no drawElementImage, so boards are documents whatever is chosen. In Chrome turn on chrome://flags/#canvas-draw-element.`;
		return chosen?.note ?? "";
	};
	return (
		<section class="set-group" data-group="renderer">
			<header>
				<span class="set-title">Boards</span>
				<span class="set-note">How the canvas draws them. The canvas renderers need Chrome's HTML-in-Canvas API{props.canvasApi ? ", which this browser has." : ", which this browser does not have."}</span>
			</header>
			<div class="set-row">
				<span class="set-k">
					<span class="lb">Renderer</span>
					<span class="nt" data-running={running()}>{note()}</span>
				</span>
				<span class="seg set-renderer" role="radiogroup" aria-label="Renderer">
					<For each={RENDERERS}>
						{(option) => (
							<button
								type="button"
								role="radio"
								aria-checked={props.renderer === option.id}
								data-on={props.renderer === option.id}
								data-moot={(option.id !== "dom" && !props.canvasApi) || undefined}
								title={option.note}
								onClick={() => props.onChange(option.id)}
							>
								{option.label}
							</button>
						)}
					</For>
				</span>
			</div>
		</section>
	);
}
