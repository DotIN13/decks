# The table of calls

Every call and event of today, and what it becomes. Written by Lexicon on 2026-11-14 for stop 1.
`protocol/calls/<noun>.ts` and `protocol/events.ts` declare what this table lists; `node tools/gen/table.ts`
proves that every name in today's three files is here exactly once, and every declared call and event too.

**How to read it.** *Today* is the old name and *From* is its table: `agents` (`packages/api/src/verbs.ts`, 77),
`person` (`person.ts`, 43) or `event` (`packages/protocol/src/names.ts`, 52). *New* is the name it becomes. When
two old names meant one thing, the second says *alias of* the first's new name. *new* marks a call with no old name.
Every old name keeps answering for one release, from `server/compat/`; then its refusal names the new call.
*Who* is who may call it: person, agent, app, card, or anyone. Calls on chat, account and runtime are answered
by the harness, for the person only; all others by the server.

**Counts.** 124 calls (104 on the server, 20 in the harness) and 23 events, from 120 calls and 52 events today.

## Calls, by noun

### deck

The folder that holds everything: canvases, assets, docs and apps. One server serves one deck.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| `deck.get` | person | `deck.get` | person, agent, app | Answers versions, settings and warnings. |
| `now` | agents | `deck.now` | anyone | A bare word becomes noun.verb. |
| `pair.code` | agents | `deck.pair` | person | Renamed. |
| `harness.revoke` | person | `deck.revoke` | person | Renamed. |
| `harness.configure` | person | `deck.update` | person | The timezone and the code rule are the deck's; the speech model moves to runtime.update. |

### canvas

A pen.dev drawing and the folder around it: canvases/<name>/, with its cards, frames and files.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| `canvas.copyShared` | agents | `canvas.copy` | person, agent | Copies any canvas into a new one of yours, a friend's included. |
| `canvas.create` | agents | `canvas.create` | person, agent | Unchanged. |
| `canvas.export` | agents | `canvas.export` | person, agent, app | Answers the File it wrote. |
| new | | `canvas.get` | anyone | Split from canvas.read: the canvas's title, file, revision and variables. |
| `here` | agents | `canvas.here` | anyone | A bare word becomes noun.verb. |
| `canvas.list` | agents | `canvas.list` | person, agent, app | Unchanged. |
| `canvas.remove` | person | `canvas.delete` | person | Renamed. |
| `canvas.screenshot` | agents | `canvas.screenshot` | person, agent, app | The picture's size is a Size { w, h }. |
| `canvas.step` | agents | `canvas.undo` | person, card | `redo: true` puts a step back. Answers the canvas, whose undo and redo say whether a step is left. |
| `canvas.rename` | agents | `canvas.update` | person, agent | Rename was update by another word. |

### item

Anything on a canvas: a note, text, a shape, an arrow, a frame, a card, an app or a document.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| `canvas.batch` | agents | `item.batch` | anyone | Takes item ops only; pen.dev's own { op, node, box } form is read by compat. |
| `canvas.edit` | person | alias of `item.batch` | anyone | The person's edit is the same batch; `for` names the agent it is for. |
| `canvas.clip` | agents | `item.clip` | anyone | The held items' box is a Box { x1, y1, x2, y2 }, not { x, y, w, h }. |
| `canvas.copy` | agents | `item.copy` | anyone | Renamed. |
| new | | `item.get` | anyone | Split from canvas.read's `of`: one item and what is in it. |
| `canvas.insert` | agents | `item.insert` | anyone | `at` is a Point { x, y }; the old { x1, y1 } corner is still read, from compat. |
| `card.play` | person | alias of `item.insert` | anyone | { type: card, card: <path> }. |
| `doc.place` | person | alias of `item.insert` | anyone | { type: document, path }, or a Google Doc by its link. |
| `canvas.read` | agents | `item.list` | anyone | Answers the items alone. The canvas's title, revision and variables move to canvas.get, and `of` (one item) to item.get. |
| `canvas.move` | agents | `item.move` | anyone | `at` is a Point. |
| `card.move` | person | alias of `item.move` | anyone | The same as the agents' move; a card is an item. |
| `canvas.paste` | agents | `item.paste` | anyone | Renamed. |
| `canvas.delete` | agents | `item.delete` | anyone | It always took an item off the canvas; deleting a canvas is canvas.delete now. |
| `card.hide` | person | alias of `item.delete` | anyone | Takes the card off the canvas; its folder stays. |
| `canvas.replace` | agents | `item.replace` | anyone | Renamed. |
| `canvas.space` | agents | `item.space` | anyone | Answers a Point { x, y } instead of { x1, y1 }. |
| `canvas.update` | agents | `item.update` | anyone | The id, the change and the options are one object; `at` is a Point. |
| `card.resize` | person | alias of `item.update` | anyone | `size` on item.update. |
| `canvas.variables` | agents | `item.variables` | anyone | Answers the canvas, its variables inside. |

### card

A piece of HTML drawn on a canvas, kept as a folder: cards/<name>/index.html and its files.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| `agent.claim` | agents | `card.claim` | agent | Claiming is about cards. Answers the cards. |
| `card.create` | agents | `card.create` | person, agent, app | Title, size and canvas are one object. |
| `canvas.fit` | agents | `card.fit` | anyone | Answers the card's Placement; what the browser measured rides beside it as notes. |
| `card.get` | agents | `card.get` | anyone | Answers where the card sits too (`placements`). |
| `card.canvases` | agents | alias of `card.get` | anyone | card.get's `placements` say it. |
| `card.list` | agents | `card.list` | person, agent, app | Unchanged. |
| `card.url` | agents | `card.url` | anyone | Unchanged. |

### file

Any file in the deck, named by its path from the deck's root.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| new | | `file.edit` | person, agent, app | New. |
| new | | `file.find` | person, agent, app | New. |
| new | | `file.grep` | person, agent, app | New. |
| new | | `file.list` | person, agent, app | New: the deck's files without a disk. |
| new | | `file.move` | person, agent, app | New. |
| new | | `file.read` | anyone | New; `sha` reads a document's past version. |
| `card.delete` | person | `file.delete` | person, agent, app | A card is a folder: deleting it is deleting the folder. |
| new | | `file.delete` | person, agent, app | New. |
| `file.url` | agents | `file.url` | anyone | Its argument is called `path`. |
| new | | `file.write` | person, agent, app | New: a file written through a call carries its author. |
| new | | `file.open` | anyone | Added in 0.3.0 for Folio: a page joins a document. These rode the documents' socket messages. |
| new | | `file.close` | anyone | Added in 0.3.0: the page leaves the document. |
| new | | `file.splice` | person, agent, app | Added in 0.3.0: a page's typing lands as splices at a revision. |
| new | | `file.review` | person, agent, app | Added in 0.3.0: accept or reject an edit waiting for review. |
| new | | `file.versions` | anyone | Added in 0.3.0: a document's kept versions. |
| new | | `file.restore` | person, agent, app | Added in 0.3.0: put a document back as it was at a version. |

### frame

A reusable pen.dev file in a canvas's frames/, placed on the canvas as a ref.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| `frame.create` | agents | `frame.create` | person, agent, app | Answers the Frame. |
| new | | `frame.get` | anyone | Added: one frame file and its item. |
| new | | `frame.list` | anyone | Added: frames could be made, but not listed. |
| `canvas.save` | agents | `frame.save` | person, agent, app | Answers the Frame. |

### app

A folder in apps/ that the server serves, builds or runs, shown on a canvas as an item.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| `apps.build` | agents | `app.build` | person, agent | Answers the App (status, errors); the time rides as a note. |
| `apps.check` | agents | `app.check` | person, agent | Renamed. |
| `apps.clone` | agents | `app.clone` | person, agent | Answers the App. |
| `apps.create` | agents | `app.create` | person, agent | Answers the App; place it with item.insert({ type: app, app }). |
| `apps.status` | agents | `app.get` | person, agent, app | Answers the App, its repository included. |
| `apps.repo` | agents | alias of `app.get` | person, agent, app | app.get's `repo` says it. Every app is a repository from the start; older folders become one in upgrade/. |
| `apps.list` | agents | `app.list` | person, agent, app | Renamed. |
| `apps.logs` | agents | `app.logs` | person, agent | Renamed. |
| `apps.delete` | agents | `app.delete` | person, agent | Answers { deleted }; the trash folder and the items taken off ride as notes. |
| `apps.restart` | agents | `app.restart` | person, agent | Answers the App. |
| `apps.run` | agents | `app.run` | person, agent | Answers the App. |
| `apps.stop` | agents | `app.stop` | person, agent | Answers the App, not { stopped }. |
| `apps.seen` | person | `app.update` | person | `seen` is when the person looked. |

### port

A local server forwarded so a card or an app can frame it.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| new | | `port.close` | person, agent | Split from `ports`. |
| `ports` | agents | `port.list` | person, agent, app | One call did three things: port.open and port.close are the other two. |
| new | | `port.open` | person, agent | Split from `ports`. |

### agent

Who works on the deck: its name, avatar, home canvas, tags and inbox.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| new | | `agent.attach` | person | New: trades a person's login for an agent's own token, name and colour. |
| `agent.create` | agents | `agent.create` | person, agent | `name` may be left out, and `near` joins another agent's workspace (both from the person's agent.add). |
| `agent.add` | person | alias of `agent.create` | person, agent | The same thing as agent.create. |
| `agent.get` | agents | `agent.get` | anyone | Unchanged. |
| new | | `agent.host` | person | New: a client says which kinds of agent it can start. |
| `agent.inbox` | agents | `agent.inbox` | agent | Unchanged. |
| `agent.list` | agents | `agent.list` | anyone | Unchanged. |
| `agent.me` | agents | `agent.me` | agent | Unchanged. |
| new | | `agent.news` | agent | New: what changed on your canvas since you last asked, and your mail. |
| `agent.queue` | agents | `agent.queue` | person, agent, app | Answers the Message, with its place in the queue. |
| `agent.remove` | person | `agent.delete` | person | Renamed. |
| `agent.send` | agents | `agent.send` | anyone | Answers the Message, with its state: delivered, queued or new. |
| `agent.update` | agents | `agent.update` | person, agent | The change goes in `change`; the person may name another agent. |
| `agent.set` | person | alias of `agent.update` | person, agent | The same thing as agent.update, naming the agent. |

### view

What a screen shows of a canvas: its camera, its size, and where people point.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| `view.cursor` | agents | `view.cursor` | anyone | Answers the View. |
| `view.focus` | agents | `view.focus` | anyone | Answers the View. |
| `view.camera` | agents | `view.get` | anyone | Answers the View, its camera inside. |
| `view.viewport` | agents | alias of `view.get` | anyone | view.get's `screen` is the screen's Size. |
| `view.goto` | agents | `view.goto` | person, agent | Answers the View. |
| `view.move` | agents | `view.move` | anyone | Answers the View. |
| `view.remember` | person | alias of `view.move` | anyone | From the person's own page, view.move records where their screen is. |
| `view.reload` | agents | `view.reload` | anyone | Answers how many reloaded, as a number. |

### tab

The person's shared Chrome tab, driven through the Decks extension.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| `web.answer` | person | `tab.answer` | person | Answers the Tab. |
| `web.click` | agents | `tab.click` | person, agent | Answers the Tab. |
| `web.fill` | agents | `tab.fill` | person, agent | Answers the Tab. |
| `web.open` | agents | `tab.open` | person, agent | Answers the Tab. |
| `web.pairing` | agents | `tab.pair` | person, agent | Renamed. |
| `web.repair` | agents | alias of `tab.pair` | person, agent | `fresh: true` makes a new code and drops the old pairing. |
| `web.press` | agents | `tab.press` | person, agent | Answers the Tab. |
| `web.read` | agents | `tab.read` | person, agent | Renamed. |
| `web.screenshot` | agents | `tab.screenshot` | person, agent | Answers a Screenshot, its size a Size. |
| `web.select` | agents | `tab.select` | person, agent | Answers the Tab. |
| `web.status` | agents | `tab.status` | person, agent | Answers the Tab. |
| `web.stop` | agents | `tab.stop` | person, agent | Answers the Tab. |
| `web.submit` | agents | `tab.submit` | person, agent | Answers the Tab; `pending` says it waits for the person. |

### studio

The hosted Decks a server syncs with.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| `studio.connect` | agents | `studio.connect` | person | Unchanged. |
| `studio.disconnect` | agents | `studio.disconnect` | person | Unchanged. |
| `harness.unpair` | person | alias of `studio.disconnect` | person | The same thing as studio.disconnect. |
| `studio.status` | agents | `studio.status` | person, agent, app | Unchanged. |

### google

The Google sign-in the server edits Google Docs with.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| `account.googleCode` | person | `google.connect` | person | Renamed. |
| `account.googleSignOut` | person | `google.disconnect` | person | Renamed. |
| `account.google` | person | `google.status` | person | Google's sign-in is the server's, for Google Docs; see the decision. |

### chat

An agent's conversation, as the harness keeps it.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| `chat.abort` | person | `chat.abort` | person | Answers the Agent. |
| `agent.answer` | person | `chat.answer` | person | Names the agent and the question. |
| `agent.focus` | person | `chat.focus` | person | Which conversation is up belongs to the harness's page, not to the agent's record. |
| `chat.fork` | person | `chat.fork` | person | Answers the new Agent. |
| `chat.tool` | person | `chat.get` | person | One entry whole, a tool call's full result included; answered, not an event. |
| `chat.open` | person | `chat.list` | person | Answers the entries instead of saying them as an event. |
| `chat.earlier` | person | alias of `chat.list` | person | `before` and `limit` page back. |
| `chat.preview` | person | `chat.preview` | person | Answers the cards instead of saying them as an event. |
| `chat.queue` | person | `chat.queue` | person | Answers the queue. |
| `agent.reset` | person | `chat.delete` | person | Starting over is deleting the conversation. |
| `chat.restore` | person | `chat.restore` | person | Answers how many cards changed, as a number. |
| `chat.rewind` | person | `chat.rewind` | person | Answers the Agent. |
| `chat.send` | person | `chat.send` | person | Answers the new entry. |

### account

A login the harness spends from.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| `account.add` | person | `account.create` | person | Renamed. |
| `account.list` | person | `account.list` | person | Answers the accounts instead of saying them as an event. |
| `account.forget` | person | `account.delete` | person | Renamed. |
| `agent.report` | person | `account.report` | person | Usage belongs with accounts. Answers the report instead of saying it as an event. |
| `account.use` | person | `account.use` | person | Answers the Account. |

### runtime

A kind of agent the harness can run, and the harness's own settings.

| Today | From | New | Who | What changes |
|---|---|---|---|---|
| `agent.dialogs` | person | alias of `runtime.get` | person | runtime.get with `agent` lists its open questions. |
| `agent.settings` | person | `runtime.get` | person | With `agent`, that agent's page. |
| `harness.get` | person | alias of `runtime.get` | person | With no `agent`, the harness's own page. |
| new | | `runtime.list` | person | Was only an event, harness.runtimes; a snapshot is a call. |
| new | | `runtime.update` | person | Split from harness.configure: the speech-to-text model. |

## Calls dropped

| Today | From | Why |
|---|---|---|
| `canvas.file` | agents | canvas.get's `file` field says where the drawing is. |
| `apps.item` | agents | The item is { type: app, app: <name> }, written straight into item.insert. |
| `deck.open` | person | A server serves one deck, chosen when it starts; another deck is another server. |

## Events

An event says which ids changed, who changed them and the revision: `{ canvas?, ids, by, rev }` and a few small
fields. A snapshot (a whole list, a history) is a call. *Heard by*: everyone who may see the canvas, or the person only.

| Today | New | Heard by | What changes |
|---|---|---|---|
| `harness.settings` | alias of `deck.changed` | canvas | `part: settings`; deck.get and runtime.get read them. |
| `harness.paired` | alias of `deck.changed` | canvas | `part: paired`. |
| `deck.changed` | `deck.changed` | canvas | Says which part changed, not the deck; deck.get reads it. |
| `canvas.list` | `canvas.changed` | canvas | A snapshot becomes a call: canvas.list. |
| `canvas.changed` | `item.changed` | canvas | It carried the drawing's ops. canvas.changed now means the list of canvases changed. |
| `stage.pen` | alias of `item.changed` | canvas | A copy of the drawing's change per agent; one item.changed now. |
| `stage.pen.delta` | alias of `item.changed` | canvas | Renamed. |
| `card.changed` | `card.changed` | canvas | No card body: card.get reads it. |
| `doc.created` | `file.created` | canvas | Renamed. |
| `doc.state` | alias of `file.changed` | canvas | `part: state`. |
| `doc.changed` | `file.changed` | canvas | `part` says what changed. |
| `doc.patched` | alias of `file.changed` | canvas | Renamed. |
| `doc.versions` | alias of `file.changed` | canvas | `part: versions`; file.versions reads the list. |
| `doc.version` | alias of `file.changed` | canvas | `part: version`. |
| `doc.compiled` | alias of `file.changed` | canvas | `part: compiled`. |
| `doc.repo` | alias of `file.changed` | canvas | `part: repo`. |
| `doc.remote` | alias of `file.changed` | canvas | `part: remote`. |
| `doc.gdoc` | alias of `file.changed` | canvas | `part: google`. |
| `doc.gcomments` | alias of `file.changed` | canvas | `part: comments`. |
| `app.changed` | `app.changed` | canvas | Unchanged. |
| `agent.list` | `agent.changed` | canvas | A snapshot becomes a call: agent.list. |
| `agent.state` | alias of `agent.changed` | canvas | `state`. |
| `agent.row` | alias of `agent.changed` | canvas | Renamed. |
| `agent.identity` | alias of `agent.changed` | canvas | Renamed. |
| `agent.model` | alias of `agent.changed` | canvas | Renamed. |
| `agent.context` | alias of `agent.changed` | canvas | Renamed. |
| `agent.removed` | `agent.deleted` | canvas | Renamed. |
| new | `agent.mailed` | person | Added in 0.3.0 for Roster: tells an agent's host there is mail to deliver. |
| new | `agent.requested` | person | Added in 0.3.0: asks a host to start an agent, as view.requested asks a screen. |
| `agent.act` | `agent.acted` | canvas | Renamed. |
| `presence.changed` | `view.changed` | canvas | Where people are on a canvas is the view's. |
| `view.called` | `view.requested` | canvas | A view call waiting for a screen. |
| `web.changed` | `tab.changed` | canvas | Renamed. |
| `chat.item` | `chat.added` | person | Renamed. |
| `chat.delta` | alias of `chat.added` | person | `delta` grows the entry while it streams. |
| `agent.queued` | `chat.changed` | person | The person's queue is the conversation's. |
| `agent.prompt` | `chat.asked` | person | Renamed. |
| `agent.promptClosed` | `chat.answered` | person | Renamed. |
| `chat.draft` | `chat.drafted` | person | Renamed. |
| `agent.usage` | alias of `account.changed` | person | Usage belongs with accounts. |
| `agent.account` | alias of `account.changed` | person | Renamed. |
| `account.list` | `account.changed` | person | A snapshot becomes a call: account.list. |
| `harness.runtimes` | `runtime.changed` | person | runtime.list reads them. |
| `harness.notice` | `runtime.noticed` | person | Renamed. |
| `harness.error` | alias of `runtime.noticed` | person | `level: error`. |

## Events dropped

| Today | Why |
|---|---|
| `harness.hello` | The socket's greeting carries the protocol's version (version.ts); it is not an event. |
| `agent.report` | It was the answer to agent.report; account.report answers it now. |
| `chat.history` | A snapshot: chat.list answers it. |
| `chat.earlier` | A snapshot: chat.list answers it. |
| `chat.tool` | A snapshot: chat.get answers it. |
| `chat.preview` | A snapshot: chat.preview answers it. |
| `call.answered` | The socket's answer to a call, part of the envelope. |
| `line.hello` | The socket's greeting, part of the envelope. |
| `stage.pen.refused` | A refused edit is the call's own refusal, code conflict. |

## Where the grammar bends, and what is still open

- `view.reload` and `chat.restore` answer a count, not a thing: each changes many things at once (rule 5).
- `canvas.delete`, `canvas.copy` and `view.goto` take the canvas as the thing itself, so there it is required (rule 4).
- `item.variables` sits under `item`, as DESIGN.md says, though it changes the canvas; it answers the Canvas.
- `google` is a sixteenth noun, for the Google sign-in the server edits Google Docs with. A decision for the person.
- A document's own calls were in neither of today's tables: they rode the documents' socket messages. Six are declared in
  0.3.0 (`file.open`, `close`, `splice`, `review`, `versions`, `restore`); compile, git and Google comments wait for wave 2.
- The socket's own messages (`line.hello`, `line.token`, `line.call`, `canvas.watch`, `canvas.unwatch`, `view.answered`,
  `card.seen`, `card.extent`, `presence.set`) are its envelope, not calls: the greeting with the version, a call and its
  answer, and watching a canvas. `card.extent` becomes what `card.fit` measures, and `presence.set` is `view.move`.
