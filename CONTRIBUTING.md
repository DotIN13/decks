# Contributing

Decks is a small project with a strong opinion about what it is. The best way in is a small,
focused change with a test that can fail, or a bug report that says what you did and what
happened.

## Getting set up

```bash
git clone https://github.com/DotIN13/decks.git
cd decks
npm ci
npm run dev:example        # the committed demo deck, not your own
```

`npm ci`, never `npm install` without it: the lockfile is the build. Node **>= 22.19**
(`engines.node`). The dev server is on `127.0.0.1:4329` and Vite on `127.0.0.1:4328`; open
the Vite URL.

You need model credentials for the agent to answer at all — Decks reads the same
`~/.pi/agent/` the Pi CLI uses, so `pi auth` once is enough. Everything else works without
them: the canvas, the boards, the editor, and every test that does not prompt an agent.

`npm run dev` uses `<repo>/data`, which is gitignored. Use `npm run dev:example` while you
are working on the app itself: it points at the committed demo deck, so a change you make
to the canvas does not rearrange your own boards or fill your own revisions.

## Before you send a change

```bash
npm run typecheck     # every workspace, including the extension and the browser checks
npm test              # the unit tests, no model needed, plus the cascade gate's own tests
npm run test:e2e      # the browser checks, ~2 min, over a throwaway copy of example/
```

**One more, and it is the one that catches what the others cannot.** The app's 13
stylesheets all declare inside `@layer components`, so a rule of equal specificity is decided
by position and by nothing else — and a comment moved, a file split or a rule dragged across
another changes which one wins while the browser checks (which measure elements, not rules)
still pass. `npm run css:order` flattens the `@import` graph in `apps/web/src/index.css`,
hashes the rules in cascade order, and compares that to the committed baseline in
`apps/web/src/styles/cascade-order.json`:

```bash
npm run css:order                # exit 1, naming every rule that moved and every tie it decided
npm run css:order -- --update    # re-stamp after an intended change — and read the diff
```

It is deliberately blind to comments and whitespace, so moving a paragraph out of a
stylesheet does not touch it; and it ignores which file a rule came from, so moving a rule to
another sheet is free *as long as it lands in the same place in the cascade*.

The browser checks need Chromium once: `npx playwright install chromium`. Three unit tests
measure a real page, so they need it too.

`npm run test:e2e` refuses to run if something else is already on the API port — that is
deliberate, and the message says which port. Leave five checks off unless you mean to spend
tokens; `DECKS_E2E_AGENT=1 npm run test:e2e` runs those as well.

## What a change should look like

**A comment explains why, not what.** The code is the what. The comment above it is the
reason it is that way and not the obvious way — the bug it prevents, the thing that was tried
first. A comment that restates the line below it is noise, and a change that adds one will
get a review asking for it to come out.

**Plain words, short sentences, no em dashes.** This applies to the app's own copy and to the
comments. The reader is deciding something.

**A test that cannot fail is not a test.** If you add one, break the code and watch it fail.
`say("...", x !== undefined)` and `ok || true` have both shipped here.

**Small diffs.** One idea per commit. A reformat, a rename and a behaviour change in one
commit is three commits, and the review will ask for them separately.

**No new dependency without a reason in the commit message.** The board primitives are
vendored rather than installed (`npm run vendor`) so a board renders offline; the runtime
carries nothing it does not use.

**The file is the artifact.** A board is a plain HTML document, and the app treats it as one:
edits are splices of the lines they name, a drag rewrites one attribute, and a board written
by hand has to survive a round trip through the editor byte for byte. Keep that property:
a change that has to rewrite a board to save it is a bug.

## Opening the change

Branch from `main`, keep it focused, and open a pull request. The template asks for what
changed, why, and how you checked it. CI runs typecheck, the unit tests and the browser
checks on every pull request; a red build is the first thing looked at, so run the three
commands above before you push.

If you are not sure whether something belongs, open an issue and describe it. "I wanted to
do X and the app made it hard" is a useful issue.

## Security

Do not open a public issue for a vulnerability. [SECURITY.md](SECURITY.md) says what is in
scope and how to report it privately.

## License

Contributions are accepted under the MIT license in [LICENSE](LICENSE).
