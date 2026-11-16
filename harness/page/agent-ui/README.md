# harness/page/agent-ui

The chat and the composer for another program to mount (Studio's page), imported as
`@decks/page/agent-ui`: the parts, their styles, and the small host they are handed.

## Owns

- `index.ts`: the entry: `mountAgentUi`, `AgentUi`, `setAgentUiHost`, and the parts on their own
  (`Stream`, `Composer`, `DraftField`, the draft, pill and sent-message rules, the tool results).
- `view.tsx`: `AgentUi`, the conversation above the composer. `actions.ts`: `mountAgentUi`.
  `model.ts`: the host's fields and which a host left out. `styles.css`: the parts' sheets in order.
- `fixture/`: a page that mounts the entry alone with a fake host, for the mount test.

## May import

`../chat/` and `../composer/` by file (never their entries, which bring the page's glue),
`solid-js`, `lucide-solid`, `@decks/ui`, `@decks/protocol`, `@decks/canvas`. Nothing else of the
harness's page: `model.test.ts` walks the whole import graph to hold this.

## Rules (the contract)

1. **Mount**: `mountAgentUi(element, { host, stream, composer })` answers the function that takes
   them out. A page with its own layout mounts `Stream` and `Composer` apart, after
   `setAgentUiHost(host)` once.
2. **Styles**: import `@decks/page/agent-ui/styles.css` (or the sheets it lists, in that order).
   They read the host page's design tokens (`--fg`, `--muted`, `--line`, `--layer`, `--radius-*`,
   `--type-*`, the canvas surface tokens) and its kit classes (`float`, `icon-button`,
   `chip-button`, `data-row`); the host page loads those, as Studio's page does.
3. **Host** (`AgentUiHost`, every field optional): `notice(level, text)`; `api(path)` and
   `authHeaders()` for the speech recogniser at `/stt`; `AgentFace` and `AgentMenu`, how agents are
   drawn and picked; `FiveHour`, a subscription's five-hour reading. Left out: the console, the
   browser's own recogniser, an initial in a circle, a chip with no menu, no reading.
4. **Send**: the composer calls `composer.onSend(text, commentIds, draft)` (and `onQueue` while the
   agent works); the host turns `draft` into parts with `messageParts(draft, comments, names)` and
   sends `chat.send { agent, text, parts }`.
5. **The conversation's events**: the host keeps the items and hands them to `stream.items`,
   newest last: `chat.added` with an item replaces or appends it, with a delta grows its text.
   `stream.state` is the agent's state. Older pages come from `stream.onEarlier` (`chat.list`).
6. **Tool results**: `setToolResultSender(item => …)` asks `chat.get`; the host hands the answer
   to `receiveToolResult(item, result)`.
7. **The agents list**: `composer.recipient` (chats, identities, unread, focused, pick, new,
   close) and `composer.mentionables` for the `@` menu; the time machine's four acts are
   `stream.onPreview`, `onRewind`, `onFork` and `onRestore`, each the matching `chat.*` call.
8. **Attachments**: files dropped on the box reach `composer.onDropFiles(files)`; the paperclip
   calls `composer.onAttach()`; the host puts the uploaded file back as `composer.draft.files`.

## Check

- `node tools/check.mjs harness/page`: types, and `model.test.ts` (host and import graph).
- The mount test, a browser run: `AGENT_UI_MOUNT=1 node tools/heavy.mjs --wait --class check --
  node --import tsx --test harness/page/agent-ui/mount.test.ts` (port 4697, `AGENT_UI_PORT`).
