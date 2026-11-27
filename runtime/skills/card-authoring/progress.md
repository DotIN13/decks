# Reporting your progress

The person should see, at a glance, who is on what, how far it has got, and what waits on them. You
report in three places, each kept current at its own pace:

| Where | Pace | What it says |
|---|---|---|
| Your tags (`decks agent update --tags`) | when the subject changes | what you are doing now, in a few words; left set when you finish |
| A progress card in your row of Working | at each step | the steps, what is running, what came of it, questions as buttons |
| A result card in the topic, and your chat reply | once, at the end | the finding; chat says it in one or two sentences |

## When to make a progress card

Work of three steps or more, or anything that runs in the background, gets one, made **before you
run anything**: the card first, with the first step's hypothesis, then the first command. A card
written after the work is a report, not progress, and the person watched nothing move meanwhile. A small job (one turn, a step or two) goes straight to its result.

It is an ordinary card: `decks card create --title "<the task>: starting" --canvas <name>`, placed in
your row of the Working area (`--beside` your row's last item; the canvas-authoring skill,
"Organize a canvas"). The title is the task and how far it is ("Faster tabs: on step 4"). If a to-do
asked for the work, put a link chip by the to-do pointing at the progress card.

## The card: steps on the left, what happened on the right

Start from the template, [progress-example/](progress-example/): copy it over the folder
`decks card create` made, then write its `progress.json`. The card reads that file every 4 seconds,
so after the copy you only ever edit the JSON (or let a script you run rewrite it).

```sh
cp -R "$DECKS_SKILLS/card-authoring/progress-example/." canvases/<canvas>/cards/<name>/
```

- **The head**: the task and where it is ("Word counter: on step 4"), your own avatar (read from
  Decks by `agent`, your name) with a green dot while you work, when it was last updated (it turns
  to "no update for 12 min" when `updated` grows old), and a bar with one segment per step.
- **Left, the steps.** Each step is a plain title, then:
  - **Goal** (making something) or **Hypothesis** (testing a belief), with why it matters:
    "the rules survive odd input, so a speed-up cannot quietly break counting".
  - **Method**: how you will find out, in a few words: "23 unit tests on punctuation, case and cut words".
  - **Expect**: what you expect to see: "23 of 23 pass", "Counter about twice as fast".
  - A verdict when it ends: held, not held or blocked, or a short count in `badge` ("23 of 23").
- **Right, the log**: what actually happened, in time order under each step. Each entry is one of
  - `run`: the exact command and what it is for (`why`); `done` and `of` draw a bar while
    `status` is "running";
  - `fail`: what went wrong; `finding`: what you learned from it; `result`: the outcome, with its
    numbers.

  The log follows the newest line; pressing a step scrolls to its lines.

- **Show, do not only tell.** Any log entry can carry its own HTML, drawn under it, so the reader
  sees what the run did: `"html"` for a line or two inline, or `"file"` for a piece in the card's
  folder (`"file": "log/bench.html"`), read again whenever it changes. A piece is plain HTML and SVG
  styled with the card's colours; its scripts do not run. Start from a template in
  [templates/](progress-example/templates/), copy it into `log/`, and put your numbers in:
  - `tally.html`: the words or items a run looked at, then how many of each;
  - `tests.html`: one block per test, green or red, with the failing ones named and why;
  - `process.html`: how a run makes or changes something, as boxes and arrows (what goes in, the
    rules, what comes out), the stage that matters in the accent;
  - `cloud.html`: a word cloud and a few example lines, when what the data looks like is the point;
  - `waterfall.html`: a trace of where the time went, one lane per variant;
  - `bars.html`: a few numbers side by side, the one that matters in the accent colour;
  - `compare.html`: before and after, as large numbers or two pictures.

  Each template says in a comment how to fill it. When none fits, write your own piece: a diff, a
  table, a map, a screenshot with an `<img src="files/…">`. Pick the picture that makes the result
  obvious, keep text 14 px or larger, give every number its unit (on axis ticks too) or say in
  the caption what it counts, and show nothing the entry's own line already says: no caption that
  repeats it, no picture of a plain pass ("23 of 23 pass" needs no row of green blocks).

```jsonc
{
  "task": "Word counter", "agent": "<your name>",
  "status": "working",                 // working | waiting (on the person) | done
  "updated": "2026-11-26T18:18:40-08:00",
  "steps": [{ "id": 4, "title": "Race Counter against a loop", "status": "active",  // todo | active | done | blocked
              "hypothesis": "Counter is faster, since it counts in C",           // or "goal"
              "method": "time both on the same words, 7 rounds",
              "expect": "Counter about twice as fast",
              "verdict": "held", "badge": "2.1x" }],                              // when it ends
  "log": [{ "step": 4, "at": "18:18", "kind": "run", "command": "python3 bench.py --repeat 7",
            "why": "time both on the same words", "status": "running", "done": 2, "of": 7, "unit": "rounds" },
          { "step": 3, "at": "18:16", "kind": "finding", "text": "Each weighted draw rescans 50,000 words." },
          { "step": 2, "at": "18:08", "kind": "fail", "text": "21 of 23 pass",
            "file": "log/step2-first-run.html" },
          { "step": 2, "at": "18:09", "kind": "finding", "text": "Reads split words.",
            "html": "<code>\"don\" + \"t\"</code> → <code>\"don't\"</code>" }],
  "questions": [{ "ask": "Keep Counter?", "options": ["Yes", "No"] }]          // buttons that message you
}
```

The shape is the template's own, not a format Decks knows: change the card as you like.

## Steps are small, and grow as you go

Steps are fine-grained: one goal or hypothesis, checked by one run or a few. "Write the sieve and test
it" is two steps (write it; test it against known counts), and a benchmark is at least two more (time
both; find where the time goes). A bug fix is reproduce, narrow it down, find the cause, fix, check
nothing else broke, each its own step. You do not plan them all first: write the steps you can see,
and add one whenever a result calls for it. A step that does not hold opens the next.

The same shape fits any work: research (the claim, the measurement, the number), a web search (the
question, the sources read, the answer), a feature (what it should do, the change and its tests, what
the tests showed).

## Keep it current

- Add a `run` entry **before** each command you run, and its `result`, `fail` or `finding` as it
  ends; set `updated` each time.
- **Before any run that may take more than a minute**, put it on the card as running first, so the
  person sees what you are waiting on, and give it a time limit (`timeout 300 python3 bench.py`). A
  script that loops can rewrite its own `done` as it goes. A run that hits the limit is a result too:
  log it as a `fail`, and change the method.
- Write the file in place (the Edit or Write tool, or a script writing the same path), never a
  rename-save such as `sed -i`, which the canvas stops watching. While it is half written the card
  keeps the last good version.
- A card that changes only once a step can be plain HTML you edit instead; the template is the easy way.

## Questions, waiting, stopping

- A choice the person must make is a question on the card (`questions`), shown as buttons that
  message you. Mark the step blocked, set your tags to say you are waiting, say so in
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
