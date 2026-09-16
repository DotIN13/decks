# Security

## The model, first

Decks runs an agent with live `bash`, `write`, `edit` and `stage_eval` tools, and the server
has **no authentication**. There is no login, no token, and every frame that arrives on `/ws`
is accepted. A reachable Decks port is therefore arbitrary code execution as the user running
it, plus whatever API keys that user has.

That is a deliberate design for one person on one machine, not an oversight. It also decides
everything about a deployment: bind it to loopback, reach it over a private network, and never
put it on a public interface or a public tunnel. [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) §1
is the long version, and it is worth reading before this file.

So the interesting security work here is not "add a password". It is:

- **Keeping a board from reaching anything the agent was not asked to reach.** Boards render
  in the deck's origin, and an embed is a document from somewhere else. §4 of
  [docs/DESIGN.md](docs/DESIGN.md) is the trust model: the two tiers, what the sandbox does,
  and what it does not.
- **Keeping a path from escaping the deck.** Every route that turns a URL into a file goes
  through `deck/roots.ts`, which resolves symlinks before it compares. An escape there is a
  bug worth reporting.
- **Keeping the agent inside the blast radius its operator chose.** The systemd unit in the
  deployment doc is the mitigation; a way around it from inside a board rather than from a
  shell is worth reporting.

## Reporting a vulnerability

Use GitHub's private reporting on this repository: **Security → Report a vulnerability**.
That opens a draft advisory only the maintainers can see. Please do not open a public issue
first.

Include what you need to: what you did, what happened, and what you expected. A board, a
deck or a request that reproduces it is worth more than a description of one. If you have a
suggested fix, say so, but a report without one is still a report.

There is no bug bounty and no SLA. This is a small project; you will get an honest answer
about whether it can be fixed and when.

## Scope

**In scope**

- A path escape: any route, embed, symlink or `data-embed` that reads or writes outside the
  deck and the roots its `deck.json` declares.
- A board or an embedded document that reaches the network or the filesystem without the
  agent asking it to, or that escapes the tier it was served under.
- The shared-Chrome bridge (`extension/`) acting on a tab or an origin the user did not
  share, or a pairing code that survives longer than it should.
- Prompt injection that turns a deck document into a tool call the user did not ask for. The
  agent reads files; a file that gives it orders is an attack on this design.
- Anything that makes the deployment sandbox (`ProtectSystem`, `ReadWritePaths`, the `750`
  home) not do what it says.

**Not a vulnerability, by design**

- No authentication on the port, and code execution by the agent. Both are the product.
  See §1 above.
- A board's scripts running: a board is an HTML file in the same origin, and the two trust
  tiers exist to bound that rather than to forbid it (DESIGN §4).
- Bound to `127.0.0.1` by default. Reaching it from elsewhere is the operator's choice, and
  the deployment doc says how to do it safely and how not to.

## Supported versions

`main`. There are no releases and no backports; fixes land on `main` and nowhere else.
