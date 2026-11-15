# tools/gen

Everything that follows from the protocol, generated from its declarations into `dist-gen/` (not in
git), and the proof that `docs/rewrite/calls.md` is whole. Lexicon owns it.

## Owns

- `index.ts`: `node tools/gen/index.ts` writes `dist-gen/`; `--check` writes nothing and fails when a file
  there is missing or out of date; `--only <name>` runs one generator (sdk, cli, mcp, reference, swift).
- `ts.ts`: the SDK's types (`sdk/types.ts`: every named shape, `Calls`, `Events`) and its list of calls
  (`sdk/calls.json`).
- `docs.ts`: the `decks` command's help (`cli/help.txt`) and the agents' reference (`reference.md`).
- `mcp.ts`: the MCP tool list (`mcp/tools.json`), every server call an agent may make, as JSON Schema.
- `swift.ts`, `swift-types.ts`: `swift/Shapes.swift`, `Calls.swift`, `Events.swift` and `Wire.swift` (the
  envelope, login, the lock, the socket's messages as enums on type, and the wire's paths) for the iPad app.
- `table.ts`: `node tools/gen/table.ts` proves `calls.md` whole against today's three files.
- `paths.ts`: where they read and write.

## May import

`protocol/` through its entry, and node's own modules. `table.ts` also imports today's
`packages/api/src/verbs.ts`, `person.ts` and `packages/protocol/src/names.ts`, read-only, until the
switch-over removes them; then it checks only the declared side.

## Rules

1. Nothing here is written by hand that the declarations can say. A change to the protocol is followed
   by `node tools/gen/index.ts`; `--check` is what the gates and CI run.
2. Output goes only to `dist-gen/`, never into git.
3. The SDK, the command and the reference list the same calls in the same order as `protocol/calls/`.
   The MCP list holds the server's calls an agent may make; the harness's own calls stay out of it.
4. A required string or number argument is a word on the command line; every other is a flag.
5. In Swift a named object is a struct, an object that takes other keys keeps them in `extra`, a union of
   objects told apart by one literal field is an enum switched on it, and any other mixed union is
   `JSONValue`. The four files must pass `swiftc -typecheck` together.
6. `calls.md` lists each of today's names exactly once, and every declared call and event; each call's
   Who column says what its declaration says.

## Check

```
node tools/gen/index.ts && node tools/gen/index.ts --check && node tools/gen/table.ts
node --import tsx --test tools/gen/*.test.ts
(cd dist-gen/swift && swiftc -typecheck *.swift)
```
