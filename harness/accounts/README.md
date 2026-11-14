# harness/accounts

The Claude logins the harness spends from, and their usage reports. Moved from today's
`runtimes/claude/accounts.ts` and `usage.ts`.

## Owns

`accounts.ts` (`ClaudeAccounts`), `usage.ts` (a usage report from the CLI's answer),
`answers.ts` (`account.list create use delete report`), and `index.ts`.

## May import

`protocol/`, `clients/sdk` (types), `../runtimes/types`, `../sessions` (answers).

## Rules

1. Logins live under the harness's folder (`<home>/claude-accounts`), never the deck.
2. Each agent spends from its own account through its own link; repointing one agent's link
   switches that agent and nobody else.
3. Signing in runs `/login` through a Claude agent; with none, `account.create` is refused
   `unavailable`, naming `agent.create`.
4. `account.list` answers the protocol's `Account`: id, label, whether it is the default, its plan.
5. A change to the list is told as `account.changed`.

## Check

`node tools/check.mjs harness`
