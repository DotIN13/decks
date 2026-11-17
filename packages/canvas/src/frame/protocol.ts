import type { Page, Camera } from "@decks/protocol";
import type { PenTool } from "../edit/pen-tools.ts";
import type { Insets } from "../camera/insets.ts";
import type { Peer, StartMessage as FrameStartMessage } from "@decks/frame";

// The first words, the port the two talk on and a call's refusal are every frame's (`@decks/frame`); what is said on the port here is the canvas's.
export { CallRefused, peer, PROTOCOL, type Hello } from "@decks/frame";

/**
 * The canvas frame: the canvas, its engine and every card on it, in one sandboxed page of its own,
 * and the app's page around it as its broker.
 *
 * The frame keeps nothing and holds one credential: a canvas pass for its canvas alone, with your role
 * on it, lasting an hour and renewed by the page unseen (`server/src/auth/passes.ts`). On it the frame
 * reads its drawing, follows the canvas's stream and makes your edits itself, the pass in the
 * `Authorization` header; the page never relays the drawing. It reads its canvas's files and pictures
 * with the same pass in their address (`/api/t/<pass>/…`), since an image or a module cannot send a
 * header. It is sandboxed (`allow-scripts`, an origin of its own), so a card's script there cannot
 * reach the app's page or your own token.
 *
 * The two talk on one `MessagePort`. The frame says `hello` to its parent once; the page answers on
 * that window alone with `start` and the port, and after that no window message is read again.
 */

/** The page's answer to the frame's hello (`@decks/frame`), with what a canvas starts from. */
export type StartMessage = FrameStartMessage<Start>;

/** Everything the frame starts from: what was a host's options, as data. */
export interface Start {
	protocol: number;
	canvas: { name: string; title?: string; role: "owner" | "edit" | "view" };
	/**
	 * Who keeps the canvas, as the frame reaches it: a harness (`kind` left out), on its `/api` address,
	 * or Decks Studio (`studio`), on its own; and the pass for this one canvas, which runs out at `expires`
	 * unless the page sends the next (`token`).
	 */
	backend: { api: string; token: string; expires: number; kind?: "harness" | "studio" };
	/** The address the canvas's files are read at, with the pass in it: `…/api/t/<pass>/card/canvases/<name>/`. */
	files: { base: string; expires: number };
	/** Where the canvas's pictures are, by the same pass: `…/api/t/<pass>/thumb/`; or a pattern with `{path}` and `{scheme}` in it, where they are kept otherwise (Studio). */
	pictures: string;
	/** The deck's import map, given once for every card on the canvas: names to another site's addresses, or to paths under `assets/`, read beside the canvas's cards. Left out, each card looks for the deck's own. */
	imports?: Record<string, string>;
	look: { dark: boolean; mode: "edit" | "browse"; readOnly: boolean; toolbar: boolean; insets?: Insets; agent?: string; agents?: Record<string, { name: string; color: string }>; /** The page draws the comment box (`onComment`), so its Send now is a press of yours the page can send on; the frame only says where. */ pageComments?: boolean; /** The page draws the tools (the tool column, the pen tray, the properties, the zoom): the frame draws none, and keeps the tools' state in step with the page's (`tools-mirror.ts`). */ pageTools?: boolean; /** The bare keys the page's tools take (a letter each): pressed on the canvas and not taken there, they are passed on to the page (`keys`). */ pageKeys?: readonly string[]; /** Keys the page's tools take ahead of the canvas's own: heard first on the canvas, passed on and acted on nowhere else. Each a key (`"v"`), or a code with its Shift (`"shift+Digit1"`). */ pageKeysFirst?: readonly string[]; /** The page has tabs of its own: the pill's New tab says what it opens (`open-tab`). */ pageTabs?: boolean };
	camera?: Camera;
	writer?: { name?: string; color: string };
	/** What the frame keeps between visits, kept for it by the page (`store`). */
	stored: Record<string, string>;
	/** What each app on the canvas saved in its browser storage, kept by the page (`app-store`), by app name and key. */
	appStored?: Record<string, Record<string, string>>;
	/** The card or board the page has selected on this canvas, selected again as the frame starts. */
	selected?: string;
}

/** A card or a board on the canvas, as the frame draws it. */
export type FramePage = Page & { trust?: "own" | "friend" };

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };
/** A place in a card: the card's id, the slot between its blocks, and its inner width. */
export type CardSlot = { card: string; index: number; inner: number };

/** What the page sends the frame: events, and the calls it makes of it. */
export interface PageToFrame {
	/**
	 * The canvas pass, renewed before it runs out: the token for calls, and the addresses of the files
	 * and pictures with the new pass in them.
	 */
	token: { token: string; files?: { base: string; expires: number }; pictures?: string };
	reload: { path: string };
	/** The page's scheme and mode, and what of the frame its own chrome covers (the side panel, the top bar). */
	look: { dark?: boolean; mode?: "edit" | "browse"; readOnly?: boolean; insets?: Insets; /** The conversation on screen, whose `decks view …` moves this canvas; another agent's waits for its chat. */ agent?: string; /** Each agent's name and colour, said when they change: what is new on the canvas glows in the colour of who wrote it. */ agents?: Record<string, { name: string; color: string }>; /** How far up from the bottom the page's dock (the composer) reaches, in pixels: on a phone the tools are a row just above it. */ dock?: number; /** Where the page's composer is on the frame's screen (null: not shown): a drag let go over it mentions what it carries. */ composer?: Rect | null };
	tool: { tool?: PenTool; ink?: { on: boolean } };
	camera: { camera: Camera; glide?: number };
	select: { ids: readonly string[]; page?: string };
	/** Who writes on the drawing now: what it is drawing is shown in their colour, with their name. */
	busy: { writer?: { name?: string; color: string } };
	/** A press or Escape on the page, which the frame does not hear: its open menus and popovers go (`@decks/ui` dismiss). */
	away: Record<string, never>;
	/** The tools' state as the page has it, when the page draws the tools (`tools-mirror.ts`): each value that changed. */
	tools: Record<string, unknown>;
	/** Undo or redo, pressed on the page's tools. */
	step: { direction: "undo" | "redo" };
	/** Fit everything on the canvas, pressed on the page's zoom. */
	fit: Record<string, never>;
	/** A paste the page heard, with the focus on the page: a copy of items (a clip's JSON) or words, for the canvas (`frame/inside/clipboard.ts`). */
	paste: { clip?: string; text?: string };
}

/** The calls the page makes of the frame, and what each answers. */
type PageCalls = {
	edit: { data: { ops: unknown[] }; value: true };
};

/**
 * What the frame hands the composer: what you point at, a comment written in the frame's popover, a
 * sketch to turn into something. **A draft, never a message**: whatever runs in the frame can say this,
 * a card's script too, so the page shows it in the composer and only your Send there sends it.
 */
export interface ComposerPart {
	selection?: { ids: readonly string[]; page?: string };
	pills?: Array<{ kind: "card" | "item"; id: string; label: string }>;
	/** `send`: you pressed Send in the popover, so the page puts it in the composer as its own message, still for you to send. */
	comment?: { path: string; title: string; quote: string; text: string; send?: boolean; component?: string; items?: string[] };
	ink?: { action: "drawing" | "card" | "send"; ids: string[]; canvas: string; box: Rect };
}

/** What the frame sends the page. */
interface FrameToPage {
	composer: ComposerPart;
	/** Open an app in a tab of its own: the page's, outside the canvas's sandbox (`decks.app`). */
	"open-app": { name: string };
	/** Open a card, a document or an app whole in a tab of the page's (the pill's New tab), where the page has them (`look.pageTabs`). */
	"open-tab": { kind: "card" | "document" | "app"; target: string; browser?: true };
	/** Follow a link to something in the deck, by its address in the page's window (`#canvas/…`, `#card/…`, `#doc/…`, `#app/…`): the page reads the address and opens the tab, where it has tabs (`look.pageTabs`). */
	"open-at": { address: string; browser?: true };
	/** A drag is over the page's composer, or no longer: it is marked as where what is dragged would be mentioned. */
	refer: { over: boolean };
	/** Open an address in a tab: the page's to open, an http(s) one alone, since the sandbox has no popups. */
	"open-link": { href: string };
	/** Open one of the app's own panels, beside the canvas (the apps list), or its file picker (`files`): the file chosen there is put in the middle of the view. */
	panel: { name: "apps" | "files" };
	/** A sheet is open over the canvas's foot (the properties drawer on a phone): the page's composer makes way for it, as under an iOS sheet, until it closes. */
	sheet: { open: boolean };
	/** Once the camera rests; or a view kept for another conversation (`agent`), for the page to keep as that agent's view and the harness to answer its `view.camera` by. */
	camera: { camera: Camera; agent?: string; selected?: string };
	viewport: { width: number; height: number };
	comment: { path: string; title: string; quote: string; component?: string; items?: string[]; at?: Rect; /** The box at once (a pill's Comment), not the small button words selected show first. */ open?: boolean };
	export: { ids: string[]; format?: "png" | "pdf" };
	store: { key: string; value: string | null };
	/** A value an app inside the canvas saved in its browser storage (`decks-canvas.js`, as `decks-storage`), for the page to keep under the app's name. */
	"app-store": { app: string; key: string; value: string | null };
	keys: { key: string; code: string; meta: boolean; ctrl: boolean; alt: boolean; shift: boolean };
	/** A press or Escape in the frame, which the page does not hear: its open menus and popovers go (`@decks/ui` dismiss). */
	away: Record<string, never>;
	/** The tools' state as the frame has it, when the page draws the tools (`tools-mirror.ts`): each value that changed. */
	tools: Record<string, unknown>;
	/** The person pressed Go on an agent's move to another canvas (`view.goto` offered): the page moves that conversation there, as its canvas switcher does. */
	goto: { agent: string; canvas: string };
}

/** The calls the frame makes of the page, and what each answers. */
export type FrameCalls = {
	open: { data: { path: string; from: string }; value: boolean };
	/** A card's agent call, or showing another canvas: the page's, with your token, and your OK before a message goes to an agent. */
	agent: { data: { verb: string; args: unknown[]; card: string }; value: unknown };
	/**
	 * Files dropped on the canvas, at a point of the frame: the page uploads them into the canvas's folder and places them, as it does a drop of its own;
	 * over a card, into it (`card`: its id, the slot between its blocks there, and its inner width).
	 */
	upload: { data: { files: Array<{ name: string; type: string; bytes: ArrayBuffer }>; at: Point; card?: CardSlot }; value: boolean };
};

/** The page's end, typed. */
export type PageEnd = Peer<PageToFrame, PageCalls, FrameToPage, FrameCalls>;
/** The frame's end, typed. */
export type FrameEnd = Peer<FrameToPage, FrameCalls, PageToFrame, PageCalls>;
