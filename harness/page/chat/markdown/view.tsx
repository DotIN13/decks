import { createMemo, For, Match, Show, Switch, type JSX } from "solid-js";
import { linkProps } from "./actions.ts";
import { blocks, type Align, type Block, type Inline } from "./model.ts";

// A reply's markdown drawn as elements: its blocks, tables, lists and inline spans.

/** A reply, drawn from the token tree `markdown.ts` produced. */
export function Markdown(props: {
	text: string;
	/** Something to put after the last block, the streaming caret. */
	trailing?: JSX.Element;
}) {
	/** Parsed once per distinct string, not once per read and not once per token. */
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

			{/* A heading is weight and size, not an outline entry. */}
			<Match when={props.block.kind === "heading"}>
				<div class="md-h" data-level={(props.block as Extract<Block, { kind: "heading" }>).level}>
					<Spans spans={(props.block as Extract<Block, { kind: "heading" }>).spans} />
					{props.trailing}
				</div>
			</Match>

			{/* The caret follows the block that is actually being written. */}
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

/** A table, in a box that scrolls sideways rather than one that stretches the column. */
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
						<a {...linkProps((span as Extract<Inline, { kind: "link" }>).href)}>
							<Spans spans={(span as Extract<Inline, { kind: "link" }>).spans} />
						</a>
					</Match>
				</Switch>
			)}
		</For>
	);
}
