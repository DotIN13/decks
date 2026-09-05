import { createMemo, For, Match, Show, Switch, type JSX } from "solid-js";
import { blocks, type Align, type Block, type Inline } from "./markdown.ts";

/**
 * A reply, drawn from the token tree `markdown.ts` produced.
 *
 * The point of this file is what it does *not* contain: no `innerHTML`, no
 * `dangerouslySetInnerHTML`, no sanitiser. Every node here is an element Solid creates and
 * every leaf is a string the browser inserts as text, so markup in a model's output is
 * markup a reader sees rather than markup a browser runs. That is the whole reason the
 * transcript can render markdown at all — see the note at the top of `markdown.ts`.
 */
export function Markdown(props: {
	text: string;
	/**
	 * Something to put after the last block — the streaming caret.
	 *
	 * Passed in rather than dropped after the tree, because after a block element it would
	 * land on a line of its own: a caret on an empty row under a finished paragraph reads as
	 * a blank message arriving. Inside the last paragraph it sits where the next word will.
	 */
	trailing?: JSX.Element;
}) {
	/**
	 * Parsed once per distinct string, not once per read and not once per token.
	 *
	 * Three things made this the most expensive thing on the screen while a reply arrived.
	 * It was a plain function, so every access re-parsed the whole reply — and it is accessed
	 * three ways below, including *inside* the `For`, so a reply with n blocks was parsed
	 * n + 2 times per render. And the column rebuilds every card on every token, so all of
	 * that ran for every reply in the history, not only the one growing.
	 *
	 * The string check is what does the work: an untouched card gets the same text and the
	 * memo hands back the *same array*, so the `For` below has nothing to diff and the DOM
	 * for that reply is never touched. Safe because `blocks` is pure — the same text is the
	 * same tree — and one entry is the right size, because the only string a card ever
	 * changes to is its own next one.
	 */
	let cachedText: string | undefined;
	let cachedBlocks: Block[] = [];
	const parsed = createMemo(() => {
		if (props.text !== cachedText) {
			cachedText = props.text;
			cachedBlocks = blocks(props.text);
		}
		return cachedBlocks;
	});
	return (
		<div class="md">
			<For each={parsed()}>
				{(block, index) => (
					<BlockView block={block} trailing={index() === parsed().length - 1 ? props.trailing : undefined} />
				)}
			</For>
			{/* A reply that is still only whitespace has no block to hang the caret on. */}
			<Show when={parsed().length === 0}>{props.trailing}</Show>
		</div>
	);
}

function BlockView(props: { block: Block; trailing?: JSX.Element }) {
	return (
		<Switch>
			<Match when={props.block.kind === "paragraph"}>
				<p>
					<Spans spans={(props.block as Extract<Block, { kind: "paragraph" }>).spans} />
					{props.trailing}
				</p>
			</Match>

			{/*
			 * A heading is weight and size, not an outline entry.
			 *
			 * `<h1>`–`<h6>` would put a reply's own structure into the page's heading
			 * outline, interleaved with every other reply in the history — which is a worse
			 * document than no headings at all. `data-level` carries what a reader needs,
			 * which is that this line is a heading and roughly how major.
			 */}
			<Match when={props.block.kind === "heading"}>
				<div class="md-h" data-level={(props.block as Extract<Block, { kind: "heading" }>).level}>
					<Spans spans={(props.block as Extract<Block, { kind: "heading" }>).spans} />
					{props.trailing}
				</div>
			</Match>

			{/*
			 * The caret follows the block that is actually being written.
			 *
			 * Every branch takes `trailing`, not just the text ones: a reply streams a list or
			 * a code block for seconds at a time, and that is precisely when "is it still
			 * going?" is the question. Rendering it only inside a paragraph made the caret
			 * disappear for the whole of a block and come back afterwards, which reads as the
			 * agent having stopped and then started again.
			 */}
			<Match when={props.block.kind === "code"}>
				<pre data-lang={(props.block as Extract<Block, { kind: "code" }>).lang || undefined}>
					{(props.block as Extract<Block, { kind: "code" }>).text}
					{props.trailing}
				</pre>
			</Match>

			<Match when={props.block.kind === "list"}>
				<ListView block={props.block as Extract<Block, { kind: "list" }>} trailing={props.trailing} />
			</Match>

			<Match when={props.block.kind === "quote"}>
				<blockquote>
					<Spans spans={(props.block as Extract<Block, { kind: "quote" }>).spans} />
					{props.trailing}
				</blockquote>
			</Match>

			<Match when={props.block.kind === "table"}>
				<TableView block={props.block as Extract<Block, { kind: "table" }>} trailing={props.trailing} />
			</Match>

			<Match when={props.block.kind === "rule"}>
				<>
					<hr />
					{props.trailing}
				</>
			</Match>
		</Switch>
	);
}

/**
 * A table, in a box that scrolls sideways rather than one that stretches the column.
 *
 * The wrapper is the whole of "it must not overflow". A chat column is narrow and a table an
 * agent writes is as wide as its widest cell needs; without a scroller of its own it either
 * pushes the card past the edge of the screen or squeezes every column to one character.
 * Cells wrap and have a floor width, so a narrow table simply fits and only a genuinely wide
 * one ever scrolls — the same bargain `pre` makes with a pasted log.
 *
 * `trailing` goes *after* the box rather than inside it: the streaming slot belongs at the
 * end of the reply, not inside a scroll container it would be scrolled away from.
 */
function TableView(props: { block: Extract<Block, { kind: "table" }>; trailing?: JSX.Element }) {
	const align = (index: number): Align => props.block.align[index] ?? null;
	const style = (index: number) => {
		const at = align(index);
		return at ? { "text-align": at } : undefined;
	};
	return (
		<>
			<div class="md-table">
				<table>
					<thead>
						<tr>
							<For each={props.block.head}>{(cell, index) => <th style={style(index())}><Spans spans={cell} /></th>}</For>
						</tr>
					</thead>
					<tbody>
						<For each={props.block.rows}>
							{(row) => (
								<tr>
									<For each={row}>{(cell, index) => <td style={style(index())}><Spans spans={cell} /></td>}</For>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</div>
			{props.trailing}
		</>
	);
}

/** A list, with the caret riding on its last line rather than under the whole block. */
function ListView(props: { block: Extract<Block, { kind: "list" }>; trailing?: JSX.Element }) {
	const items = (
		<For each={props.block.items}>
			{(item, index) => (
				<li data-depth={item.depth}>
					<Spans spans={item.spans} />
					{index() === props.block.items.length - 1 ? props.trailing : undefined}
				</li>
			)}
		</For>
	);
	return props.block.ordered ? <ol start={props.block.start}>{items}</ol> : <ul>{items}</ul>;
}

function Spans(props: { spans: Inline[] }) {
	return (
		<For each={props.spans}>
			{(span) => (
				<Switch>
					<Match when={span.kind === "text"}>{(span as Extract<Inline, { kind: "text" }>).text}</Match>
					<Match when={span.kind === "code"}>
						<code>{(span as Extract<Inline, { kind: "code" }>).text}</code>
					</Match>
					<Match when={span.kind === "strong"}>
						<strong>
							<Spans spans={(span as Extract<Inline, { kind: "strong" }>).spans} />
						</strong>
					</Match>
					<Match when={span.kind === "em"}>
						<em>
							<Spans spans={(span as Extract<Inline, { kind: "em" }>).spans} />
						</em>
					</Match>
					<Match when={span.kind === "strike"}>
						<s>
							<Spans spans={(span as Extract<Inline, { kind: "strike" }>).spans} />
						</s>
					</Match>
					{/*
					 * `target="_blank"` because this is a single-page app: following a link in
					 * place would unload the socket, the camera and the transcript. `noreferrer`
					 * brings `noopener` with it, so the new tab gets no handle on this one.
					 */}
					<Match when={span.kind === "link"}>
						<a
							href={(span as Extract<Inline, { kind: "link" }>).href}
							target="_blank"
							rel="noreferrer"
						>
							<Spans spans={(span as Extract<Inline, { kind: "link" }>).spans} />
						</a>
					</Match>
				</Switch>
			)}
		</For>
	);
}
