# Reporting your progress

The person should see, at a glance, who is on what, how far it has got, what it found, and what
waits on them. You report in three places, each kept current at its own pace:

| Where | Pace | What it says |
|---|---|---|
| Your tags (`decks agent update --tags`) | when the subject changes | what you are doing now, in a few words; left set when you finish |
| A progress card in your row of Working | at every run | the steps, what ran and how far, what came of it, questions as buttons |
| A result card in the topic, and your chat reply | once, at the end | the finding; chat says it in one or two sentences |

## When to make a progress card

**Every question or piece of work that takes more than one step gets one**, whatever it is: a bug, a
feature, a refactor, a web search, a question about the code, research. It is made **before you run
anything**: the card first, with the first step, then the first command. A card written after the
work is a report, not progress, and the person watched nothing move meanwhile. Only an answer you can
give in one step (a fact you know, one look at a file) goes straight to its result.

It is an ordinary card, copied from the template, placed in your row of the Working area (`--beside`
your row's last item; the canvas-authoring skill, "Organize a canvas"). If a to-do asked for the
work, put a link chip by the to-do pointing at the progress card.

```sh
p=$(decks card create --title "<the task>: starting" --canvas <canvas> | jq -r .path)
cp -R "$DECKS_SKILLS/card-authoring/progress-example/." "$(dirname "$p")/"
decks canvas insert --type card --card "$p" --canvas <canvas> --beside <your row's last item>
decks canvas update "$p" --size.w 1100 --canvas <canvas> && decks canvas fit "$p" --canvas <canvas>
```

Then write its `progress.json`. The card reads that file every 4 seconds, so from here on you only
edit the JSON and the pieces in `log/` (or let a script you run rewrite them).

## The card

A 16:10 card, edge to edge: a head across the top, the steps on the left, a log on the right. Both
sides scroll inside the card.

- **The head**: the task and where it is ("Word counter: on step 5"), your name and your own avatar
  (read from Decks by `agentId`, your id: a name can change) with a green dot while you work, when it was last updated (it turns
  to "no update for 12 min" when `updated` grows old), and a bar with one segment per step.
- **Left, the steps.** Each step is a plain title saying what is done, then:
  - **Goal** (making something) or **Hypothesis** (testing a belief), with why it matters:
    "the rules survive odd input, so a speed-up cannot quietly break counting".
  - **Method**: how, in a few words: "23 unit tests on punctuation, case and cut words".
  - **Expect**: what you expect to see: "23 of 23 pass", "Counter about twice as fast".
  - A verdict when it ends: held, not held or blocked, or a short count in `badge` ("23 of 23").
- **Right, the log**: what actually happened, in time order under each step. Each entry is
  - `run`: the exact command and what it is for (`why`); `done` and `of` (and a `unit`) draw a bar
    while `status` is "running";
  - `fail`: what went wrong; `finding`: what you learned; `result`: the outcome, with its numbers.

  The log follows the newest line until the reader scrolls up; pressing a step glides to its lines.

## Steps are small, and grow as you go

Each step is one goal or hypothesis, checked by one run or a few. "Write the counter and test it" is
two steps (write it and check it by hand; test it against the rules). A benchmark is at least two
more (time both; find where the time goes). A bug fix is reproduce, narrow it down, find the cause,
fix, check nothing else broke. A big upgrade or refactor is its own step, shown as the codebase
before and after. You do not plan every step first: write the steps you can see, and add one
whenever a result calls for it. A step that does not hold opens the next.

The same shape fits any work: research (the claim, the measurement, the number), a web search (the
question, the sources read, the answer), a feature (what it should do, the change and its tests, what
the tests showed).

## Show, do not only tell

Any log entry can carry its own HTML, drawn under it, so the reader sees what the run did:
`"html"` for a line or two inline, or `"file"` for a piece in the card's folder
(`"file": "log/step3-codebase.html"`), read again whenever it changes. A piece is plain HTML and SVG
in the card's colours (`var(--b-…)`); its scripts do not run. It is drawn with no box around it:
wrap it in `<div class="panel">` when it needs a frame (a chart, a tally), and leave it bare when it
has boxes of its own (a diagram, a before and after).

**Screenshots, SVG diagrams and short video demos are always welcome.** Whenever the work shows on
a screen, put it on the card: a screenshot of what changed, a few seconds of video of it working
(save it in `files/`; `media.html` shows both), an SVG of how the parts connect. A picture of the
real thing beats a sentence about it.

Put the picture on the entry it explains: what a run will do on the `run` (a process diagram on the
command that makes the data), what came out on its `result`, `fail` or `finding`. Start from a
template in [templates/](progress-example/templates/), copy it into `log/`, and put your numbers in:

| Template | For |
|---|---|
| `tally.html` | the words or items a run looked at, then how many of each |
| `tests.html` | one block per test, green or red, the failing ones named with why |
| `process.html` | how a run makes or changes something: boxes and arrows, what goes in, the rules, what comes out |
| `waterfall.html` | where the time went, one lane per variant, one bar per phase |
| `bars.html` | a few numbers side by side, the one that matters in the accent |
| `compare.html` | before and after, as large numbers or two pictures |
| `media.html` | a screenshot or a short video demo, with what to look at in the caption |
| `codebase.html` | the files before and after an upgrade or a refactor: two trees with sizes, what is new, changed or gone |
| `cloud.html` | a word cloud and example lines, when what the data looks like is the point |

Each template says in a comment how to fill it. When none fits, write your own piece: a diff, a
table, a map, an SVG diagram drawn for this run. The rules for every piece:

- Pick the picture that makes the result obvious; a picture that does not add to the line above it
  is left out ("23 of 23 pass" needs no row of green blocks).
- Nothing it says repeats the entry's own line: no caption restating the count.
- Every number has its unit, on axis ticks too, or the caption says what it counts.
- Text is 14 px or larger, in sentence case, never all capitals.

## The JSON

```jsonc
{
  "task": "Word counter", "agent": "<your name, shown>", "agentId": "<your id, from decks agent me>",
  "status": "working",                 // working | waiting (on the person) | done
  "updated": "2026-11-26T18:18:40-08:00",
  "steps": [{ "id": 5, "title": "Race Counter against a loop", "status": "active",  // todo | active | done | blocked
              "hypothesis": "Counter is faster, since it counts in C",           // or "goal"
              "method": "time both on the same words, 7 rounds",
              "expect": "Counter about twice as fast",
              "verdict": "held", "badge": "2.1x" }],                              // when it ends
  "log": [{ "step": 5, "at": "18:18", "kind": "run", "command": "python3 bench.py --repeat 7",
            "why": "time both on the same words", "status": "running", "done": 2, "of": 7, "unit": "rounds",
            "file": "log/step5-trace.html" },
          { "step": 4, "at": "18:16", "kind": "finding", "text": "Each weighted draw rescans 50,000 words.",
            "file": "log/step4-before-after.html" },
          { "step": 2, "at": "18:09", "kind": "finding", "text": "Reads split words.",
            "html": "<code>\"don\" + \"t\"</code> → <code>\"don't\"</code>" }],
  "questions": [{ "ask": "Keep Counter?", "options": ["Yes", "No"] }]          // buttons that message you
}
```

The shape is the template's own, not a format Decks knows: change the card as you like. Its
`index.html` styles `.doc` directly; Decks's own card styles sit beneath a card's, so any rule you
write there wins.

## Keep it current

- Add a `run` entry **before** each command you run, and its `result`, `fail` or `finding` as it
  ends; set `updated` each time.
- **Before any run that may take more than a minute**, put it on the card as running first, so the
  person sees what you are waiting on, and give it a time limit (`timeout 300 python3 bench.py`). A
  script that loops can rewrite its own `done` as it goes. A run that hits the limit is a result too:
  log it as a `fail`, and change the method.
- Write files in place (the Edit or Write tool, or a script writing the same path), never a
  rename-save such as `sed -i`, which the canvas stops watching. While a file is half written the
  card keeps the last good version.

## Questions, waiting, stopping

- A choice the person must make is a question on the card (`questions`), shown as buttons that
  message you (by `agentId`). Mark the step blocked, set `status` to "waiting" and your tags to say so, say it in
  chat in a sentence, and end your turn.
- Before you end any turn, bring the card up to date: a step left active says where it stopped and
  why. A card that says "running" after you have stopped misleads the person.

## When the work is finished

1. Set `status` to "done" and each step's verdict.
2. Write the result as its own one-screen card and file it in its topic (`--beside` the topic's last
   item).
3. Move the progress card beside the result, as the record of how it was done, and link it from the
   result card; close the gap in your Working row.
4. Fade the to-do (`opacity: 0.5`) and point its link chip at the result.
5. Chat: one or two sentences naming the result card and the number that matters. Leave your tags set.
