# The old-deck fixture

A deck as today's Decks leaves it at 0.5.1, made-up content only, with one of every kind of entry
today's Decks keeps in `.decks/`: agents (three, in `agents/<id>/`: meta.json, chat.json, one chat.log;
two share a name however capitalised, one's home canvas is gone; `agents/models.json` beside them is not
an agent), avatars, tokens.json (v2), revisions (index.json and two versions of one card), authors.json,
seen.json, heights.json, pairing.json, ports.json, apps logs and a built marker, canvases/<name>.json,
studio.json, studio-sync.json, studio-hashes.json, sync/<id>.pen, backups, thumbs, shots, trash/apps.

The tokens are made up: the person's is `dk_old_deck_fixture_person_token`, Ada's agent token is
`dk_old_deck_fixture_agent_token`; tokens.json keeps their sha256. studio.json's key is not a key, and
its address (port 9) answers nothing. `.decks/` is ignored by git, so its files are added with `git add -f`.
