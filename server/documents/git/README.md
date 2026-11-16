# server/documents/git

A document's git repository, kept in step with a remote such as Overleaf: `file.repo`,
`file.pull`, `file.push`. Part of the documents feature, written by Quire.

## Owns

- `repo.ts`: the three handlers, one pull or push at a time per repository.
- `status.ts`: `git status` read, the remote's address cleaned and named, failures said plainly.

## May import

`protocol/` and `server/kernel/`, through their entry files. Nothing else in `server/documents/`.

## Rules

1. The repository is the one the document's folder is in, and its top folder must be inside the
   deck. A file in no repository, or in one whose top is above the deck, has none: `file.repo`
   answers `null`, and pull and push are refused as `not_found`. A call never commits or pushes
   files outside the deck.
2. `file.repo { path }` reads without asking the remote: `{ branch, upstream?, remote?, label?,
   ahead, behind, changed }`. `branch` is a short commit when none is checked out, "no commits"
   in an empty repository. `changed` counts tracked files with edits.
3. `remote` is the upstream's address with any user, token or password taken out. `label` is
   "Overleaf" for an Overleaf project, else the remote's host.
4. A pull commits first: the repository's tracked files and the document, as "Edited in Decks",
   by the repository's own name, else as Decks. Then it fetches and merges the upstream.
5. If the merge stops on lines both sides changed, it is called off: the repository is as it was
   after the commit, nothing typed is lost, and the answer names the files.
6. A push pulls first, then sends the commits. Nothing to send says so.
7. Pull and push answer `{ ok, message, status? }`: `message` is a sentence ("Pulled 2 commits
   from Overleaf."), `status` the repository after. A failure the person can fix (a login, a
   remote out of reach, a conflict) is `ok: false` with a sentence saying how; not a refusal.
8. A branch with no upstream is refused as `conflict`, with that sentence.
9. Git never prompts: a remote that wants a login it was not given fails at once. For Overleaf
   the sentence says how to put a Git token in the remote's address.
10. A git run longer than 90 seconds is stopped. Pulls and pushes of one repository run one at
    a time, in the order asked.
11. What a pull writes reaches the deck as a change on the disk, so an open document shows it as
    a change to review, as any write from outside.
12. All three are for the person and agents.
13. On a server with no machine to run programs (in memory, Studio) the calls are `unavailable`.
14. Tests run on a fake git at the machine's edge; one test uses real git on a scratch repository
    with a bare remote, when git is installed. No network.

## Check

- `node tools/check.mjs server`
- `node --import tsx --test server/documents/git/*.test.ts`
