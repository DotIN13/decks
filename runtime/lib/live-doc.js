// packages/docs/src/index.ts
function applySplice(text, splice) {
  return text.slice(0, splice.at) + splice.text + text.slice(splice.at + splice.before.length);
}
function transformSplice(a, b, aFirst) {
  const aEnd = a.at + a.before.length;
  const bEnd = b.at + b.before.length;
  const first = a.at < b.at || a.at === b.at && aFirst;
  const past = (at) => b.at + b.text.length + (at - bEnd);
  const out = [];
  if (first) {
    const leftEnd = Math.min(aEnd, b.at);
    out.push({ at: a.at, before: a.before.slice(0, leftEnd - a.at), text: a.text });
    const rightStart = Math.max(a.at, bEnd);
    if (aEnd > rightStart) {
      const left = out[0];
      out.push({ at: past(rightStart) + left.text.length - left.before.length, before: a.before.slice(rightStart - a.at), text: "" });
    }
  } else {
    const start = Math.max(a.at, bEnd);
    out.push({ at: past(start), before: aEnd > start ? a.before.slice(start - a.at) : "", text: a.text });
  }
  return out.filter((splice) => splice.before.length > 0 || splice.text.length > 0);
}
function transformSplices(a, b, aFirst) {
  if (a.length === 0 || b.length === 0) return { a: [...a], b: [...b] };
  if (a.length === 1 && b.length === 1) return { a: transformSplice(a[0], b[0], aFirst), b: transformSplice(b[0], a[0], !aFirst) };
  if (a.length > 1) {
    const head2 = transformSplices(a.slice(0, 1), b, aFirst);
    const rest2 = transformSplices(a.slice(1), head2.b, aFirst);
    return { a: [...head2.a, ...rest2.a], b: rest2.b };
  }
  const head = transformSplices(a, b.slice(0, 1), aFirst);
  const rest = transformSplices(head.a, b.slice(1), aFirst);
  return { a: rest.a, b: [...head.b, ...rest.b] };
}

// packages/docs/src/client.ts
var BATCH_MS = 50;
var DocSync = class {
  constructor(options) {
    this.options = options;
    this.path = options.path;
    this.client = options.client ?? `page-${Math.random().toString(36).slice(2, 10)}`;
  }
  /** What the server calls the document: the path asked for, until it names a working copy. */
  path;
  /** For a working copy, the original it was copied from and is written back to. */
  source;
  client;
  text = "";
  format = "text";
  /** The last revision the server confirmed this page has. */
  rev = 0;
  changes = [];
  error;
  ready = false;
  /** Opened from a root that is not writable: shown, never sent. */
  readOnly = false;
  inflight;
  pending = [];
  timer;
  seq = 0;
  open() {
    this.ready = false;
    this.inflight = void 0;
    this.pending = [];
    this.options.send({ type: "doc.open", path: this.path, client: this.client });
  }
  close() {
    this.flush();
    this.options.send({ type: "doc.close", path: this.path, client: this.client });
  }
  /** A change the page has already made to its own text. */
  edit(splice) {
    if (!this.ready || this.readOnly) return;
    this.text = applySplice(this.text, splice);
    this.pending.push(splice);
    this.options.onUpdate(this, "local", [splice]);
    if (this.timer === void 0) {
      const schedule = this.options.schedule ?? ((run, ms) => setTimeout(run, ms));
      this.timer = schedule(() => {
        this.timer = void 0;
        this.flush();
      }, BATCH_MS);
    }
  }
  accept(change) {
    this.options.send({ type: "doc.review", path: this.path, client: this.client, change, accept: true });
  }
  reject(change) {
    this.options.send({ type: "doc.review", path: this.path, client: this.client, change, accept: false });
  }
  restore(sha) {
    this.options.send({ type: "doc.restore", path: this.path, client: this.client, sha });
  }
  /** Write the working copy back over its original. */
  writeBack() {
    this.flush();
    this.options.send({ type: "doc.writeback", path: this.path, client: this.client });
  }
  versions() {
    this.options.send({ type: "doc.versions", path: this.path });
  }
  /** Send what is waiting, unless a batch is still on its way. */
  flush() {
    if (this.inflight || this.pending.length === 0 || !this.ready) return;
    this.inflight = { batch: `${this.client}-${++this.seq}`, splices: this.pending };
    this.pending = [];
    this.options.send({ type: "doc.patch", path: this.path, client: this.client, rev: this.rev, batch: this.inflight.batch, splices: this.inflight.splices });
  }
  /**
   * Every message from the server; those about other documents, and any that are not about
   * documents at all, are ignored, so a host can pass its whole stream through.
   */
  receive(incoming) {
    const message = incoming;
    if (!("path" in message)) return;
    switch (message.type) {
      case "doc.state":
        if (message.asked !== this.path && message.path !== this.path) return;
        if (message.client !== void 0 && message.client !== this.client) return;
        this.path = message.path;
        this.source = message.source;
        this.text = message.text;
        this.format = message.format;
        this.rev = message.rev;
        this.changes = message.changes;
        this.error = message.error;
        this.inflight = void 0;
        this.pending = [];
        this.ready = !message.error || message.rev !== 0;
        this.readOnly = !!message.error && message.rev !== 0;
        this.options.onUpdate(this, "open");
        return;
      case "doc.patched":
        if (!this.matches(message.path) || message.batch !== this.inflight?.batch) return;
        if (message.refused.length > 0) {
          if (message.text === void 0) return this.open();
          this.text = message.text;
          this.rev = message.rev;
          this.inflight = void 0;
          this.pending = [];
          this.options.onUpdate(this, "open");
          return;
        }
        this.rev = message.rev;
        this.inflight = void 0;
        this.flush();
        return;
      case "doc.changed":
        if (!this.matches(message.path) || !this.ready) return;
        if (message.client === this.client && message.batch !== void 0 && message.batch === this.inflight?.batch) {
          if (message.base === this.rev) this.rev = message.rev;
          return;
        }
        if (message.base !== this.rev) return this.open();
        const applied = this.take(message.splices);
        if (!applied) return this.open();
        this.rev = message.rev;
        if (message.change) this.changes = [...this.changes, message.change];
        if (message.settled) this.changes = this.changes.filter((c) => c.id !== message.settled);
        this.options.onUpdate(this, message.change || message.settled ? "review" : "remote", applied);
        return;
    }
  }
  /**
   * The server's path for a document inside the deck is deck-relative, and a page may have
   * opened it by another spelling (`./paper.md`), so the comparison is on the cleaned path.
   */
  matches(path) {
    return clean(path) === clean(this.path);
  }
  /**
   * Apply others' splices past ours, and move ours past theirs, by the rule the server landed
   * ours by. In flight and waiting are moved one after the other, so each stays its own list.
   * Answers the splices applied here, or undefined when what they say they replaced is not in
   * this page's text, which means the two have already drifted and the page must start again.
   */
  take(theirs) {
    const flying = transformSplices(theirs, this.inflight?.splices ?? [], false);
    const waiting = transformSplices(flying.a, this.pending, false);
    let text = this.text;
    for (const splice of waiting.a) {
      if (text.slice(splice.at, splice.at + splice.before.length) !== splice.before) return void 0;
      text = applySplice(text, splice);
    }
    if (this.inflight) this.inflight = { ...this.inflight, splices: flying.b };
    this.pending = waiting.b;
    this.text = text;
    return waiting.a;
  }
  /** Nothing typed here is still on its way to the server. */
  get settled() {
    return !this.inflight && this.pending.length === 0;
  }
};
function clean(path) {
  return path.replace(/^\.\//, "").replace(/^\/+/, "");
}

// packages/docs/src/page/marks.ts
function point(p, s) {
  if (p < s.at) return p;
  if (p >= s.at + s.before.length) return p + s.text.length - s.before.length;
  return s.at;
}
function startOf(p, s) {
  if (p < s.at) return p;
  if (p >= s.at + s.before.length) return p + s.text.length - s.before.length;
  return s.at + s.text.length;
}
function endOf(p, s) {
  if (p <= s.at) return p;
  if (p >= s.at + s.before.length) return p + s.text.length - s.before.length;
  return s.at;
}
function shiftMarks(marks, splice) {
  const out = [];
  for (const mark of marks) {
    if (mark.kind === "del") out.push({ ...mark, at: point(mark.at, splice) });
    else {
      const start = startOf(mark.start, splice);
      const end = endOf(mark.end, splice);
      if (end > start) out.push({ ...mark, start, end });
    }
  }
  return out;
}
function marksOf(change, applied) {
  let marks = [];
  for (const splice of applied) {
    marks = shiftMarks(marks, splice);
    if (splice.before) marks.push({ change, kind: "del", at: splice.at, text: splice.before });
    if (splice.text) marks.push({ change, kind: "ins", start: splice.at, end: splice.at + splice.text.length });
  }
  return marks;
}
function findMarks(change, text) {
  const marks = [];
  for (const splice of change.splices) {
    if (!splice.text) continue;
    let best = -1;
    for (let i = text.indexOf(splice.text); i !== -1; i = text.indexOf(splice.text, i + 1)) {
      if (best === -1 || Math.abs(i - splice.at) < Math.abs(best - splice.at)) best = i;
    }
    if (best !== -1) marks.push({ change: change.id, kind: "ins", start: best, end: best + splice.text.length });
  }
  return marks;
}
function segments(text, marks) {
  const runs = marks.filter((m) => m.kind === "ins").filter((m) => m.start < m.end && m.end <= text.length).sort((a, b) => a.start - b.start);
  const ghosts = marks.filter((m) => m.kind === "del" && m.at <= text.length).sort((a, b) => a.at - b.at);
  const out = [];
  let at = 0;
  let g = 0;
  const ghostsUpTo = (limit) => {
    while (g < ghosts.length && ghosts[g].at <= limit) {
      const ghost = ghosts[g++];
      if (ghost.at > at) {
        out.push({ text: text.slice(at, ghost.at) });
        at = ghost.at;
      }
      out.push({ text: "", mark: ghost });
    }
  };
  for (const run of runs) {
    if (run.start < at) continue;
    ghostsUpTo(run.start);
    if (run.start > at) out.push({ text: text.slice(at, run.start) });
    out.push({ text: text.slice(run.start, run.end), mark: run });
    at = run.end;
  }
  ghostsUpTo(text.length);
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
function spliceBetween(from, to, caret) {
  if (from === to) return void 0;
  let head = 0;
  const max = Math.min(from.length, to.length);
  while (head < max && from.charCodeAt(head) === to.charCodeAt(head)) head++;
  const grown = to.length - from.length;
  if (grown > 0) head = Math.max(0, Math.min(head, caret - grown));
  let tail = 0;
  while (tail < max - head && from.charCodeAt(from.length - 1 - tail) === to.charCodeAt(to.length - 1 - tail)) tail++;
  return { at: head, before: from.slice(head, from.length - tail), text: to.slice(head, to.length - tail) };
}

// packages/docs/src/page/page.ts
var STYLE = `
.dp { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--b-bg, #fff); color: var(--b-fg, #111); font-family: var(--b-font, system-ui, sans-serif); }
.dp-bar { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--b-border, #e5e5e5); font-size: 14px; flex: none; }
.dp-name { font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-from { color: var(--b-muted, #666); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-status { color: var(--b-muted, #666); margin-left: auto; white-space: nowrap; }
.dp-status[data-state="saving"] { color: var(--b-warn, #b45309); }
.dp-status[data-state="error"] { color: var(--b-danger, #b91c1c); }
.dp-bar button { font: inherit; font-size: 14px; padding: 5px 10px; border-radius: 7px; border: 1px solid var(--b-border-strong, #ccc); background: var(--b-bg, #fff); color: var(--b-fg, #111); cursor: pointer; white-space: nowrap; }
.dp-bar button[aria-pressed="true"] { background: var(--b-fg, #111); color: var(--b-bg, #fff); border-color: var(--b-fg, #111); }
.dp-bar button:disabled { opacity: .45; cursor: default; }
.dp-main { position: relative; flex: 1; min-height: 0; display: flex; }
.dp-scroll { flex: 1; min-width: 0; overflow: auto; }
.dp-text { box-sizing: border-box; max-width: 820px; margin: 0 auto; padding: 28px 40px 80px; min-height: 100%; outline: none; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 16px; line-height: 1.65; tab-size: 4; }
.dp-text[data-format="docx"] { font-family: var(--b-mono, ui-monospace, monospace); font-size: 13px; line-height: 1.5; }
.dp-ins { background: color-mix(in srgb, var(--b-accent, #2563eb) 16%, transparent); border-bottom: 2px solid var(--b-accent, #2563eb); border-radius: 2px; }
.dp-ins[data-hot] { background: color-mix(in srgb, var(--b-accent, #2563eb) 32%, transparent); }
.dp-del::before { content: attr(data-text); text-decoration: line-through; color: var(--b-danger, #b91c1c); opacity: .75; }
.dp-panel { flex: none; width: 300px; border-left: 1px solid var(--b-border, #e5e5e5); overflow: auto; padding: 12px 14px; font-size: 14px; background: var(--b-bg-deep, #fafafa); }
.dp-panel[hidden] { display: none; }
.dp-panel h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--b-muted, #666); margin: 4px 0 10px; }
.dp-item { border: 1px solid var(--b-border, #e5e5e5); background: var(--b-bg, #fff); border-radius: 9px; padding: 9px 10px; margin-bottom: 8px; cursor: pointer; }
.dp-item b { font-weight: 600; }
.dp-item .dp-snip { margin: 4px 0 8px; overflow-wrap: anywhere; }
.dp-item .dp-snip ins { text-decoration: none; background: color-mix(in srgb, var(--b-accent, #2563eb) 16%, transparent); }
.dp-item .dp-snip del { color: var(--b-danger, #b91c1c); }
.dp-item button { font: inherit; font-size: 13px; padding: 3px 9px; border-radius: 6px; border: 1px solid var(--b-border-strong, #ccc); background: var(--b-bg, #fff); color: var(--b-fg, #111); cursor: pointer; margin-right: 6px; }
.dp-empty { color: var(--b-muted, #666); }
`;
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== void 0) node.textContent = text;
  return node;
}
var base = (path) => path.split(/[\\/]/).pop() ?? path;
var clip = (text, n = 90) => text.length > n ? `${text.slice(0, n - 1)}\u2026` : text;
function mountDocPage(host, options) {
  if (!document.getElementById("dp-style")) document.head.append(el("style", { id: "dp-style" }, STYLE));
  host.classList.add("dp");
  host.replaceChildren();
  const bar = el("div", { class: "dp-bar" });
  const name = el("span", { class: "dp-name" }, base(options.path));
  const from = el("span", { class: "dp-from" });
  const status = el("span", { class: "dp-status" }, "Opening\u2026");
  const suggestionsButton = el("button", { type: "button", "aria-pressed": "false" }, "Suggestions");
  const historyButton = el("button", { type: "button", "aria-pressed": "false" }, "History");
  const writeButton = el("button", { type: "button", hidden: "" }, "Write back");
  bar.append(name, from, status, suggestionsButton, historyButton, writeButton);
  const main = el("div", { class: "dp-main" });
  const scroll = el("div", { class: "dp-scroll" });
  const text = el("div", { class: "dp-text", spellcheck: "false" });
  const panel = el("div", { class: "dp-panel", hidden: "" });
  scroll.append(text);
  main.append(scroll, panel);
  host.append(bar, main);
  let marks = [];
  let composing = false;
  let view = "none";
  let versions = [];
  let written = "";
  const sync = new DocSync({
    path: options.path,
    send: options.send,
    onUpdate: (_sync, why, applied) => updated(why, applied)
  });
  function texts() {
    const out = [];
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node);
    return out;
  }
  function offsetOf(node, offset) {
    let total = 0;
    if (node.nodeType !== Node.TEXT_NODE) {
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(node, offset);
      return range.toString().length;
    }
    for (const t of texts()) {
      if (t === node) return total + offset;
      total += t.data.length;
    }
    return total;
  }
  function caret() {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0 || !text.contains(selection.anchorNode)) return void 0;
    const a = offsetOf(selection.anchorNode, selection.anchorOffset);
    const f = offsetOf(selection.focusNode, selection.focusOffset);
    return { start: a, end: f };
  }
  function place(at) {
    const find = (offset) => {
      let total = 0;
      const all = texts();
      for (const t of all) {
        if (offset <= total + t.data.length) return [t, offset - total];
        total += t.data.length;
      }
      const last = all.at(-1);
      return last ? [last, last.data.length] : [text, 0];
    };
    const [an, ao] = find(at.start);
    const [fn, fo] = find(at.end);
    getSelection()?.setBaseAndExtent(an, ao, fn, fo);
  }
  function draw(keepCaret = true) {
    const where = keepCaret ? caret() : void 0;
    const frag = document.createDocumentFragment();
    for (const segment of segments(sync.text, marks)) {
      if (!("mark" in segment)) frag.append(document.createTextNode(segment.text));
      else if (segment.mark.kind === "ins") frag.append(el("span", { class: "dp-ins", "data-change": segment.mark.change }, segment.text));
      else frag.append(el("span", { class: "dp-del", contenteditable: "false", "data-change": segment.mark.change, "data-text": segment.mark.text }));
    }
    frag.append(el("br"));
    text.replaceChildren(frag);
    if (where) place(where);
  }
  function shiftCaret(at, applied) {
    const move = (p) => applied.reduce((q, s) => q <= s.at ? q : q >= s.at + s.before.length ? q + s.text.length - s.before.length : s.at + s.text.length, p);
    return { start: move(at.start), end: move(at.end) };
  }
  function updated(why, applied) {
    if (why === "open") {
      marks = sync.changes.flatMap((change) => findMarks(change, sync.text));
      text.setAttribute("data-format", sync.format);
      text.setAttribute("contenteditable", sync.readOnly ? "false" : "plaintext-only");
      name.textContent = base(sync.source ?? sync.path);
      from.textContent = sync.source ? `copy in ${sync.path.replace(/\/[^/]*$/, "/")}` : "";
      writeButton.hidden = !sync.source;
      draw(false);
    } else if (why === "local") {
      const before = marks.length;
      for (const splice of applied ?? []) marks = shiftMarks(marks, splice);
      if (before > 0) draw();
    } else {
      const where = caret();
      const known = new Set(marks.map((m) => m.change));
      for (const splice of applied ?? []) marks = shiftMarks(marks, splice);
      const live = new Set(sync.changes.map((c) => c.id));
      marks = marks.filter((m) => live.has(m.change));
      for (const change of sync.changes) if (!known.has(change.id)) marks.push(...marksOf(change.id, applied ?? []));
      draw(false);
      if (where) place(shiftCaret(where, applied ?? []));
    }
    refresh();
  }
  text.addEventListener("compositionstart", () => composing = true);
  text.addEventListener("compositionend", () => {
    composing = false;
    typed();
  });
  text.addEventListener("input", () => {
    if (!composing) typed();
  });
  function typed() {
    const now = text.textContent ?? "";
    const at = caret();
    const splice = spliceBetween(sync.text, now, at?.end ?? now.length);
    if (splice) sync.edit(splice);
  }
  function refresh() {
    const n = sync.changes.length;
    suggestionsButton.textContent = n ? `Suggestions ${n}` : "Suggestions";
    if (sync.error && !sync.ready) {
      status.dataset.state = "error";
      status.textContent = sync.error;
    } else if (sync.readOnly) {
      status.dataset.state = "";
      status.textContent = "Read-only";
    } else if (!sync.ready) {
      status.dataset.state = "";
      status.textContent = "Opening\u2026";
    } else {
      status.dataset.state = sync.settled ? "" : "saving";
      status.textContent = sync.settled ? written || "Saved" : "Saving\u2026";
    }
    if (view === "suggestions") drawSuggestions();
  }
  function show(next) {
    view = view === next ? "none" : next;
    suggestionsButton.setAttribute("aria-pressed", String(view === "suggestions"));
    historyButton.setAttribute("aria-pressed", String(view === "history"));
    panel.hidden = view === "none";
    if (view === "suggestions") drawSuggestions();
    if (view === "history") {
      panel.replaceChildren(el("h3", {}, "History"), el("p", { class: "dp-empty" }, "Reading\u2026"));
      sync.versions();
    }
  }
  function drawSuggestions() {
    panel.replaceChildren(el("h3", {}, "Suggestions"));
    if (sync.changes.length === 0) panel.append(el("p", { class: "dp-empty" }, "Nothing waiting. A write to this file from an agent or another program shows here."));
    for (const change of [...sync.changes].reverse()) {
      const item = el("div", { class: "dp-item", "data-change": change.id });
      const snip = el("div", { class: "dp-snip" });
      for (const splice of change.splices.slice(0, 3)) {
        if (splice.before) snip.append(el("del", {}, clip(splice.before, 60)));
        if (splice.text) snip.append(el("ins", {}, clip(splice.text, 60)));
        snip.append(" ");
      }
      if (change.splices.length > 3) snip.append(`and ${change.splices.length - 3} more`);
      const accept = el("button", { type: "button" }, "Accept");
      const reject = el("button", { type: "button" }, "Reject");
      accept.onclick = (event) => (event.stopPropagation(), sync.accept(change.id));
      reject.onclick = (event) => (event.stopPropagation(), sync.reject(change.id));
      item.append(el("b", {}, change.by === "outside" ? "Another program" : change.by), document.createTextNode(` \xB7 ${new Date(change.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`), snip, accept, reject);
      item.onmouseenter = () => hot(change.id, true);
      item.onmouseleave = () => hot(change.id, false);
      item.onclick = () => text.querySelector(`[data-change="${change.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      panel.append(item);
    }
  }
  function hot(change, on) {
    for (const node of text.querySelectorAll(`.dp-ins[data-change="${change}"]`)) node.toggleAttribute("data-hot", on);
  }
  function drawHistory() {
    panel.replaceChildren(el("h3", {}, "History"));
    if (versions.length === 0) panel.append(el("p", { class: "dp-empty" }, "No versions kept yet."));
    for (const version of [...versions].reverse()) {
      const item = el("div", { class: "dp-item" });
      const restore = el("button", { type: "button" }, "Restore");
      restore.onclick = () => sync.restore(version.sha);
      item.append(el("b", {}, new Date(version.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })), el("div", { class: "dp-snip" }), restore);
      panel.append(item);
    }
  }
  suggestionsButton.onclick = () => show("suggestions");
  historyButton.onclick = () => show("history");
  writeButton.onclick = () => {
    writeButton.disabled = true;
    sync.writeBack();
  };
  const stop = options.listen((message) => {
    sync.receive(message);
    if (message.type === "doc.versions" && message.path === sync.path) {
      versions = message.versions;
      if (view === "history") drawHistory();
    }
    if (message.type === "doc.written" && message.path === sync.path) {
      writeButton.disabled = false;
      written = message.error ? "" : `Written to ${base(message.source ?? "")} at ${(/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
      if (message.error) {
        status.dataset.state = "error";
        status.textContent = message.error;
        return;
      }
    }
    if (message.type === "doc.patched") refresh();
  });
  const ticker = setInterval(() => {
    if (!sync.ready && !sync.error) sync.open();
    refresh();
  }, 400);
  sync.open();
  return {
    sync,
    destroy() {
      clearInterval(ticker);
      sync.close();
      stop();
    }
  };
}

// runtime/live-doc.ts
function mountLiveDoc(host, board) {
  const raw = host.dataset.path?.trim();
  if (!raw) {
    host.textContent = "This document box names no file: give it a data-path.";
    return;
  }
  const page = mountDocPage(host, {
    path: resolvePath(raw, board),
    send: (message) => window.parent.postMessage({ decks: "doc", message }, "*"),
    listen: (listener) => {
      const onMessage = (event) => {
        if (event.source !== window.parent) return;
        const data = event.data;
        if (data?.decks === "doc" && data.message && typeof data.message === "object") listener(data.message);
      };
      addEventListener("message", onMessage);
      return () => removeEventListener("message", onMessage);
    }
  });
  addEventListener("pagehide", () => page.destroy(), { once: true });
}
function resolvePath(raw, board) {
  if (raw.startsWith("/") || raw.startsWith("~") || !board) return raw;
  const parts = board.split("/").slice(0, -1);
  for (const part of raw.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}
export {
  mountLiveDoc
};
