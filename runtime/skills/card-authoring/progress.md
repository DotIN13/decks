# Reporting your progress

The person should see, at a glance, who is on what, how far it has got, and what waits on them. You
report in three places, each kept current at its own pace:

| Where | Pace | What it says |
|---|---|---|
| Your tags (`decks agent update --tags`) | when the subject changes | what you are doing now, in a few words; left set when you finish |
| A progress card in your row of Working | at each step | the steps, what is running, what came of it, questions as buttons |
| A result card in the topic, and your chat reply | once, at the end | the finding; chat says it in one or two sentences |

## When to make a progress card

Work of three steps or more, or anything that runs in the background, gets one, made when the work
starts. A small job (one turn, a step or two) goes straight to its result.

It is an ordinary card: `decks card create --title "<the task>: starting" --canvas <name>`, placed in
your row of the Working area (`--beside` your row's last item; the canvas-authoring skill,
"Organize a canvas"). The title is the task and how far it is ("Faster tabs: on step 4"). If a to-do
asked for the work, put a link chip by the to-do pointing at the progress card.

## Every step is hypothesis, method, result

Write each step like a small experiment, so a reader sees why you are doing it and what it showed:

- **Hypothesis**, or the goal: what this step sets out to show or make true. "The press loses the
  selection", "Links can open any item".
- **Method**: how, and what you actually run. List each run: what it is for in plain words, the exact
  command or file, and how far it has got ("Drag two selected cards twenty times",
  `node checks/group-drag.mjs`, 14 of 20; "Unit tests: a press keeps what was selected",
  `npm test -- gesture`, waiting). A script, a test run, a search, a page read, an edit: each is a run.
- **Result**: what came of it, and whether the hypothesis **held**, **did not hold**, or is
  **blocked**. Numbers where there are some: "12 of 12 pass", "8% faster, below the 30% hoped".

Steps are fine-grained: a bug fix is reproduce, narrow it down, find the cause, fix, check nothing else
broke, each its own step. You do not plan them all first: write the steps you can see, and add one
whenever a result calls for it. A step that does not hold opens the next.

The same shape fits any work: research (the claim, the measurement, the number), a web search (the
question, the sources read, the answer), a feature (what it should do, the change and its tests, what
the tests showed).

## Two ways to keep it current

Pick by how often it changes:

- **Edit the card's HTML in place** (the Edit tool) when it changes once a step or so. The open card
  picks each edit up.
- **Write a JSON file the card reads every few seconds** when it changes often, or when a background
  run should report its own counts while you wait. The file sits in the card's folder
  (`fetch(card.file("progress.json"), { cache: "no-store", signal: card.signal })`) or in the canvas's
  `files/`; a script you run can rewrite it as it goes. Keep showing the last good version while a
  write is half done.

Either way, write files in place (the Edit or Write tool, or a script writing the same path), never a
rename-save such as `sed -i`, which the canvas stops watching.

[progress-example/](progress-example/) is a working card of the second kind: `index.html` reads
`progress.json` every 4 seconds and shows the steps as a list, the chosen step's hypothesis, runs (with
a bar when a run has a count) and result, and open questions as buttons. Copy the folder over the one
`decks card create` made and change what you like; the JSON's shape is the example's own, not a format
Decks knows:

```sh
cp -R "$DECKS_SKILLS/card-authoring/progress-example/." canvases/<canvas>/cards/<name>/
```

## Questions, waiting, stopping

- A choice the person must make is a button on the card that messages you
  (`card.decks.agent.send`). Mark the step blocked, set your tags to say you are waiting, say so in
  chat in a sentence, and end your turn.
- Before you end any turn, bring the card up to date: a step left active says where it stopped and why.
  A card that says "running" after you have stopped misleads the person.

## When the work is finished

1. Write the result as its own one-screen card and file it in its topic (`--beside` the topic's last
   item).
2. Move the progress card beside the result, as the record of how it was done, and link it from the
   result card; close the gap in your Working row.
3. Fade the to-do (`opacity: 0.5`) and point its link chip at the result.
4. Chat: one or two sentences naming the result card and the number that matters. Leave your tags set.
