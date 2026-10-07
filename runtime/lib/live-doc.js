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

// packages/docs/src/page/blocks.ts
function blocks(source, format, tex = false) {
  if (format === "docx") return docxBlocks(source);
  return tex ? texBlocks(source) : markdownBlocks(source);
}
function lines(source) {
  const out = [];
  let at = 0;
  while (at < source.length) {
    const next = source.indexOf("\n", at);
    const end = next === -1 ? source.length : next + 1;
    out.push({ start: at, text: source.slice(at, end) });
    at = end;
  }
  return out;
}
function byBlankLines(source, inside) {
  const out = [];
  let start = 0;
  let open = false;
  let content = false;
  for (const line of lines(source)) {
    const blank = line.text.trim() === "";
    if (blank && !open && content) {
      out.push({ start, end: line.start + line.text.length, kind: "text" });
      start = line.start + line.text.length;
      content = false;
      continue;
    }
    if (!blank) content = true;
    open = inside(line.text, open);
  }
  if (start < source.length) out.push({ start, end: source.length, kind: "text" });
  const merged = [];
  for (const block of out) {
    if (merged.length && source.slice(block.start, block.end).trim() === "") merged[merged.length - 1].end = block.end;
    else merged.push(block);
  }
  return merged.length ? merged : [{ start: 0, end: source.length, kind: "text" }];
}
function markdownBlocks(source) {
  let fence = "";
  return byBlankLines(source, (line, open) => {
    const t = line.trim();
    if (fence) {
      if (t.startsWith(fence)) fence = "";
      return fence !== "";
    }
    const opened = /^(```+|~~~+)/.exec(t);
    if (opened) {
      fence = opened[1];
      return true;
    }
    if (t === "$$") return !open;
    return open && t !== "$$";
  });
}
function texBlocks(source) {
  const begin = source.indexOf("\\begin{document}");
  const head = [];
  let body = source;
  let offset = 0;
  if (begin !== -1) {
    const after = source.indexOf("\n", begin);
    offset = after === -1 ? source.length : after + 1;
    head.push({ start: 0, end: offset, kind: "preamble" });
    body = source.slice(offset);
  }
  let depth = 0;
  const inner = byBlankLines(body, (line) => {
    const code = line.replace(/(^|[^\\])%.*$/, "$1");
    depth += (code.match(/\\begin\{/g) ?? []).length - (code.match(/\\end\{/g) ?? []).length;
    if (depth < 0) depth = 0;
    return depth > 0;
  });
  return [...head, ...inner.map((b) => ({ ...b, start: b.start + offset, end: b.end + offset }))];
}
var PARAGRAPH = /<w:p(?=[\s>/])[^>]*?(\/>|>)/g;
function docxBlocks(xml) {
  const out = [];
  let at = 0;
  PARAGRAPH.lastIndex = 0;
  for (let m = PARAGRAPH.exec(xml); m; m = PARAGRAPH.exec(xml)) {
    const start = m.index;
    let end;
    if (m[1] === "/>") end = start + m[0].length;
    else {
      const close = xml.indexOf("</w:p>", PARAGRAPH.lastIndex);
      if (close === -1) break;
      end = close + "</w:p>".length;
    }
    if (start > at) out.push({ start: at, end: start, kind: "hidden" });
    out.push({ start, end, kind: "text" });
    at = end;
    PARAGRAPH.lastIndex = end;
  }
  if (at < xml.length) out.push({ start: at, end: xml.length, kind: "hidden" });
  return out;
}
var ENTITY = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
var escapeXml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function readParagraph(xml) {
  const out = { text: "", xml: [], width: [], tag: [], runs: [], style: /<w:pStyle w:val="([^"]+)"/.exec(xml)?.[1] ?? "" };
  const run = /<w:r(?=[\s>])[^>]*>([\s\S]*?)<\/w:r>/g;
  let lastEnd = -1;
  for (let r = run.exec(xml); r; r = run.exec(xml)) {
    const body = r[1];
    const bodyAt = r.index + r[0].indexOf(">") + 1;
    const props = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(body)?.[1] ?? "";
    const on = (tag) => new RegExp(`<w:${tag}(?:\\s+w:val="(?!0|false|none)[^"]*")?\\s*/>`).test(props);
    const style = { bold: on("b"), italic: on("i"), underline: /<w:u\s+w:val="(?!none)/.test(props) };
    let text = "";
    const piece = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g;
    for (let p = piece.exec(body); p; p = piece.exec(body)) {
      const pieceAt = bodyAt + p.index;
      if (p[0].startsWith("<w:tab")) {
        out.text += "	";
        text += "	";
        out.xml.push(pieceAt);
        out.width.push(p[0].length);
        out.tag.push(-1);
        continue;
      }
      if (!p[0].startsWith("<w:t")) {
        out.text += "\n";
        text += "\n";
        out.xml.push(pieceAt);
        out.width.push(p[0].length);
        out.tag.push(-1);
        continue;
      }
      const open = p[0].indexOf(">") + 1;
      const content = p[1];
      let i = 0;
      while (i < content.length) {
        let char = content[i];
        let width = 1;
        if (char === "&") {
          const semi = content.indexOf(";", i);
          const name = semi === -1 ? "" : content.slice(i + 1, semi);
          const decoded = ENTITY[name] ?? (name.startsWith("#x") ? String.fromCodePoint(parseInt(name.slice(2), 16)) : name.startsWith("#") ? String.fromCodePoint(parseInt(name.slice(1), 10)) : void 0);
          if (decoded !== void 0) {
            char = decoded;
            width = semi - i + 1;
          }
        }
        out.text += char;
        text += char;
        out.xml.push(pieceAt + open + i);
        out.width.push(width);
        out.tag.push(pieceAt);
        i += width;
      }
      lastEnd = pieceAt + open + content.length;
    }
    if (text) out.runs.push({ text, ...style });
  }
  out.xml.push(out.xml.length ? out.xml.at(-1) + out.width.at(-1) : lastEnd);
  return out;
}
function paragraphSplices(xml, para, edit) {
  const out = [];
  const cuts = [];
  for (let i = edit.at; i < edit.at + edit.before.length; i++) {
    const at = para.xml[i];
    const len = para.width[i];
    const last = cuts.at(-1);
    if (last && last.at + last.len === at) last.len += len;
    else cuts.push({ at, len });
  }
  let shift = 0;
  for (const cut of cuts) {
    out.push({ at: cut.at - shift, before: xml.slice(cut.at, cut.at + cut.len), text: "" });
    shift += cut.len;
  }
  if (edit.text) {
    const parts = edit.text.split("\n").map(escapeXml);
    const inner = parts.join('</w:t><w:br/><w:t xml:space="preserve">');
    const anchor = edit.at > 0 ? edit.at - 1 : 0;
    let at;
    let tag = para.tag[anchor] ?? -1;
    if (para.text.length === 0 || tag === -1) {
      const close = xml.lastIndexOf("</w:p>");
      const where = close === -1 ? xml.length : close;
      at = where - removedBefore(cuts, where);
      out.push({ at, before: "", text: `<w:r><w:t xml:space="preserve">${inner}</w:t></w:r>` });
      return out;
    }
    at = edit.at > 0 ? para.xml[anchor] + para.width[anchor] : para.xml[0];
    at -= removedBefore(cuts, at);
    out.push({ at, before: "", text: inner });
    const open = xml.slice(tag, xml.indexOf(">", tag) + 1);
    if (!/xml:space="preserve"/.test(open)) {
      const tagAt = tag - removedBefore(cuts, tag);
      const fixed = { at: tagAt, before: open, text: open.replace(/^<w:t/, '<w:t xml:space="preserve"') };
      const last = out.pop();
      out.push(fixed, { ...last, at: last.at + fixed.text.length - fixed.before.length });
    }
  }
  return out;
}
function removedBefore(cuts, at) {
  return cuts.reduce((sum, cut) => cut.at + cut.len <= at ? sum + cut.len : sum, 0);
}

// packages/docs/src/page/render.ts
var escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function command(text, names, wrap) {
  const re = new RegExp(`\\\\(${names})\\*?\\s*(\\[[^\\]]*\\])?\\{`, "g");
  let out = "";
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "\\") i++;
      else if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    if (depth !== 0) break;
    out += text.slice(at, m.index) + wrap(text.slice(re.lastIndex, i - 1), m[1]);
    at = i;
    re.lastIndex = i;
  }
  return out + text.slice(at);
}
function texInline(source) {
  const maths = [];
  let text = source.replace(/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+\$)/g, (m) => `\0${maths.push(m) - 1}\0`);
  text = text.replace(/(^|[^\\])%.*$/gm, "$1");
  text = escapeHtml(text);
  text = command(text, "textbf", (x) => `<b>${x}</b>`);
  text = command(text, "emph|textit", (x) => `<i>${x}</i>`);
  text = command(text, "texttt", (x) => `<code>${x}</code>`);
  text = command(text, "underline", (x) => `<u>${x}</u>`);
  text = command(text, "cite|citep|citet|parencite|textcite", (x) => `<span class="dp-cite">[${x}]</span>`);
  text = command(text, "ref|eqref|autoref|cref|Cref", (x) => `<span class="dp-cite">(${x})</span>`);
  text = command(text, "url", (x) => `<span class="dp-link">${x}</span>`);
  text = command(text, "href", (x) => `<span class="dp-link">${x}</span>`);
  text = command(text, "footnote", (x) => `<sup class="dp-note" title="${x.replace(/"/g, "&quot;")}">*</sup>`);
  text = command(text, "label|vspace|hspace|index", () => "");
  text = command(text, "[a-zA-Z]+", (x) => x);
  text = text.replace(/``/g, "\u201C").replace(/''/g, "\u201D").replace(/---/g, "\u2014").replace(/--/g, "\u2013").replace(/~/g, " ").replace(/\\([%&$#_{}])/g, "$1").replace(/\\\\/g, "<br>").replace(/\\[a-zA-Z]+\s?/g, "");
  return text.replace(/\u0000(\d+)\u0000/g, (_m, n) => escapeHtml(maths[Number(n)]));
}
var SECTION = { part: "h1", chapter: "h1", section: "h2", subsection: "h3", subsubsection: "h4", paragraph: "h5" };
var DISPLAY = /\\begin\{(equation|align|gather|multline|eqnarray)(\*?)\}([\s\S]*?)\\end\{\1\2\}/g;
function texToHtml(block) {
  let text = block.trim();
  if (!text) return "";
  text = text.replace(DISPLAY, (_m, env2, _star, body) => {
    const clean2 = body.replace(/\\label\{[^}]*\}/g, "").replace(/\\nonumber/g, "").trim();
    return env2 === "equation" ? `\\[${clean2}\\]` : `\\[\\begin{aligned}${clean2}\\end{aligned}\\]`;
  });
  const heading = /^\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\{([\s\S]*?)\}\s*([\s\S]*)$/.exec(text);
  if (heading) {
    const tag = SECTION[heading[1]];
    return `<${tag}>${texInline(heading[2])}</${tag}>${heading[3] ? texToHtml(heading[3]) : ""}`;
  }
  const list = /^\\begin\{(itemize|enumerate|description)\}([\s\S]*?)\\end\{\1\}$/.exec(text);
  if (list) {
    const tag = list[1] === "enumerate" ? "ol" : "ul";
    const items = list[2].split(/\\item\b(?:\[[^\]]*\])?/).slice(1);
    return `<${tag}>${items.map((item) => `<li>${texInline(item.trim())}</li>`).join("")}</${tag}>`;
  }
  const env = /^\\begin\{(figure|table)\*?\}([\s\S]*?)\\end\{\1\*?\}$/.exec(text);
  if (env) {
    const caption = /\\caption\{([\s\S]*?)\}\s*(\\label|\\end|$)/.exec(env[2])?.[1] ?? "";
    return `<div class="dp-box">${env[1] === "figure" ? "Figure" : "Table"}${caption ? `: ${texInline(caption)}` : ""}</div>`;
  }
  if (/^\\begin\{abstract\}/.test(text)) {
    return `<div class="dp-abstract"><b>Abstract.</b> ${texInline(text.replace(/\\(begin|end)\{abstract\}/g, ""))}</div>`;
  }
  if (/^\\(maketitle|tableofcontents|bibliography|bibliographystyle|newpage|clearpage|end\{document\})/.test(text)) {
    return `<div class="dp-chip">${escapeHtml(text.split("\n")[0])}</div>`;
  }
  return `<p>${texInline(text)}</p>`;
}
var HEADING = { Title: "h1", Heading1: "h2", Heading2: "h3", Heading3: "h4", Subtitle: "h3" };
function paragraphToHtml(para) {
  const tag = HEADING[para.style] ?? (/^Heading(\d)/.exec(para.style) ? "h4" : "p");
  const inner = para.runs.map((run) => {
    let html = escapeHtml(run.text).replace(/\n/g, "<br>").replace(/\t/g, "&emsp;");
    if (run.bold) html = `<b>${html}</b>`;
    if (run.italic) html = `<i>${html}</i>`;
    if (run.underline) html = `<u>${html}</u>`;
    return html;
  }).join("");
  return `<${tag}>${inner || "<br>"}</${tag}>`;
}

// packages/docs/src/page/reading.ts
var escapeHtml2 = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var Reading = class {
  constructor(sync, host) {
    this.sync = sync;
    this.host = host;
    this.root = document.createElement("div");
    this.root.className = "dp-page";
    this.root.addEventListener("mousedown", (event) => this.pressed(event));
    this.root.addEventListener("compositionstart", () => this.composing = true);
    this.root.addEventListener("compositionend", () => {
      this.composing = false;
      this.typed();
    });
    this.root.addEventListener("input", () => {
      if (!this.composing) this.typed();
    });
    this.root.addEventListener("focusout", (event) => {
      if (this.editing && event.target === this.editing.el) this.leave();
    });
    this.root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.editing) this.editing.el.blur();
    });
  }
  root;
  editing;
  composing = false;
  /** Drawn blocks by their source, so a redraw after someone else's keystroke reuses the rest. */
  drawn = /* @__PURE__ */ new Map();
  get tex() {
    return /\.(tex|sty|cls|ltx)$/i.test(this.sync.source ?? this.sync.path);
  }
  /** Draw every block, keeping the one being typed into as it is. */
  render() {
    const all = blocks(this.sync.text, this.sync.format, this.tex);
    const children = [];
    const editing = this.editing;
    let placed = false;
    const marks = this.host.marks().filter((m) => m.kind === "ins");
    for (const block of all) {
      if (editing && block.end > editing.start && block.start < editing.end) {
        if (!placed) children.push(editing.el);
        placed = true;
        continue;
      }
      if (editing && !placed && block.start >= editing.end) {
        children.push(editing.el);
        placed = true;
      }
      if (block.kind === "hidden") continue;
      children.push(this.blockEl(block, marks.some((m) => m.end > block.start && m.start < block.end)));
    }
    if (editing && !placed) children.push(editing.el);
    if (children.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dp-block dp-empty-doc";
      empty.dataset.start = "0";
      empty.dataset.end = "0";
      empty.textContent = this.sync.readOnly ? "This document is empty." : "Empty. Click to write.";
      children.push(empty);
    }
    if (editing && editing.el.parentNode === this.root) {
      for (const child of [...this.root.childNodes]) if (child !== editing.el) child.remove();
      const at = children.indexOf(editing.el);
      for (const node of children.slice(0, at)) this.root.insertBefore(node, editing.el);
      for (const node of children.slice(at + 1)) this.root.append(node);
    } else this.root.replaceChildren(...children);
  }
  /** Someone else's splices landed: move the block being typed into, and redraw the rest. */
  update(applied) {
    const editing = this.editing;
    if (editing && applied) {
      for (const s of applied) {
        const delta = s.text.length - s.before.length;
        if (s.at + s.before.length <= editing.start) {
          editing.start += delta;
          editing.end += delta;
        } else if (s.at < editing.end) editing.end = Math.max(editing.start, editing.end + delta);
      }
      const source = this.sync.text.slice(editing.start, editing.end);
      const para = this.sync.format === "docx" ? readParagraph(source) : void 0;
      const now = para ? para.text : source;
      if (now !== editing.text) {
        const at = this.caretIn(editing.el);
        editing.text = now;
        editing.para = para;
        editing.el.textContent = now;
        this.placeIn(editing.el, Math.min(at ?? now.length, now.length));
      }
    } else if (editing && !applied) {
      this.editing = void 0;
    }
    this.render();
  }
  blockEl(block, changed) {
    const source = this.sync.text.slice(block.start, block.end);
    const el2 = document.createElement("div");
    el2.className = `dp-block${changed ? " dp-changed" : ""}${block.kind === "preamble" ? " dp-preamble" : ""}`;
    el2.dataset.start = String(block.start);
    el2.dataset.end = String(block.end);
    if (block.kind === "preamble") {
      const lines2 = source.split("\n").length - 1;
      el2.textContent = `Preamble \xB7 ${lines2} lines`;
      return el2;
    }
    const key = `${this.sync.format}:${this.tex ? "tex" : ""}:${source}`;
    const known = this.drawn.get(key);
    if (known !== void 0) {
      el2.innerHTML = known;
      return el2;
    }
    if (this.sync.format === "docx") {
      el2.innerHTML = paragraphToHtml(readParagraph(source));
      this.drawn.set(key, el2.innerHTML);
    } else if (this.tex) {
      el2.innerHTML = texToHtml(source);
      void Promise.resolve(this.host.math?.(el2)).then(() => this.drawn.set(key, el2.innerHTML));
    } else if (this.host.markdown) {
      el2.innerHTML = `<p>${escapeHtml2(source)}</p>`;
      void Promise.resolve(this.host.markdown(el2, source)).then(() => this.drawn.set(key, el2.innerHTML));
    } else {
      el2.innerHTML = `<p style="white-space: pre-wrap">${escapeHtml2(source)}</p>`;
    }
    return el2;
  }
  // --- editing one block ------------------------------------------------------------------
  pressed(event) {
    if (this.sync.readOnly || !this.sync.ready || event.button !== 0) return;
    const target = event.target.closest(".dp-block");
    if (!target || target === this.editing?.el || !this.root.contains(target)) return;
    const start = Number(target.dataset.start);
    const end = Number(target.dataset.end);
    const shown = target.textContent ?? "";
    const near = this.shownOffset(target, event.clientX, event.clientY);
    event.preventDefault();
    const source = this.sync.text.slice(start, end);
    const para = this.sync.format === "docx" ? readParagraph(source) : void 0;
    const text = para ? para.text : source;
    const el2 = document.createElement("div");
    el2.className = "dp-block dp-editing";
    el2.setAttribute("contenteditable", "plaintext-only");
    el2.spellcheck = false;
    el2.textContent = text;
    el2.dataset.start = String(start);
    this.editing = { start, end, el: el2, text, ...para ? { para } : {} };
    target.replaceWith(el2);
    this.render();
    el2.focus();
    this.placeIn(el2, this.caretFor(text, shown, near));
  }
  typed() {
    const editing = this.editing;
    if (!editing) return;
    const now = editing.el.textContent ?? "";
    const local = spliceBetween(editing.text, now, this.caretIn(editing.el) ?? now.length);
    if (!local) return;
    if (!editing.para) {
      editing.text = now;
      editing.end += local.text.length - local.before.length;
      this.sync.edit({ at: editing.start + local.at, before: local.before, text: local.text });
      return;
    }
    const xml = this.sync.text.slice(editing.start, editing.end);
    for (const splice of paragraphSplices(xml, editing.para, local)) {
      editing.end += splice.text.length - splice.before.length;
      this.sync.edit({ at: editing.start + splice.at, before: splice.before, text: splice.text });
    }
    editing.para = readParagraph(this.sync.text.slice(editing.start, editing.end));
    editing.text = editing.para.text;
    if (editing.text !== now) {
      const at = this.caretIn(editing.el);
      editing.el.textContent = editing.text;
      this.placeIn(editing.el, Math.min(at ?? editing.text.length, editing.text.length));
    }
  }
  leave(draw = true) {
    this.editing = void 0;
    if (draw) this.render();
  }
  // --- carets -------------------------------------------------------------------------------
  shownOffset(el2, x, y) {
    const doc = el2.ownerDocument;
    let node;
    let offset = 0;
    const pos = doc.caretPositionFromPoint?.(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    } else {
      const range2 = doc.caretRangeFromPoint?.(x, y);
      if (range2) {
        node = range2.startContainer;
        offset = range2.startOffset;
      }
    }
    if (!node || !el2.contains(node)) return (el2.textContent ?? "").length;
    const range = doc.createRange();
    range.setStart(el2, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  }
  /** The caret in the block's text for a press at `near` in its drawn words. */
  caretFor(text, shown, near) {
    if (this.sync.format === "docx") return Math.min(near, text.length);
    for (const width of [16, 8, 4]) {
      const cue = shown.slice(Math.max(0, near - width), near);
      if (cue.trim().length < 2) continue;
      const at = text.indexOf(cue);
      if (at !== -1 && text.indexOf(cue, at + 1) === -1) return at + cue.length;
    }
    return Math.round(near / Math.max(1, shown.length) * text.length);
  }
  caretIn(el2) {
    const selection = el2.ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0 || !el2.contains(selection.focusNode)) return void 0;
    const range = el2.ownerDocument.createRange();
    range.setStart(el2, 0);
    range.setEnd(selection.focusNode, selection.focusOffset);
    return range.toString().length;
  }
  placeIn(el2, offset) {
    const walker = el2.ownerDocument.createTreeWalker(el2, NodeFilter.SHOW_TEXT);
    let left = offset;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (left <= node.data.length) {
        el2.ownerDocument.getSelection()?.collapse(node, left);
        return;
      }
      left -= node.data.length;
    }
    el2.ownerDocument.getSelection()?.collapse(el2, el2.childNodes.length);
  }
};

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
.dp-page { box-sizing: border-box; max-width: 820px; margin: 0 auto; padding: 28px 40px 80px; font-size: 17px; line-height: 1.6; }
.dp-page[hidden], .dp-text[hidden] { display: none; }
.dp-block { position: relative; border-radius: 6px; padding: 2px 10px; margin: 0 -10px 8px; cursor: text; }
.dp-block:hover { background: color-mix(in srgb, var(--b-fg, #111) 4%, transparent); }
.dp-block > :first-child { margin-top: 0; }
.dp-block > :last-child { margin-bottom: 0; }
.dp-block p, .dp-block ul, .dp-block ol, .dp-block pre, .dp-block blockquote, .dp-block table { margin: 0 0 14px; }
.dp-block h1 { font-size: 28px; line-height: 1.25; margin: 6px 0 14px; }
.dp-block h2 { font-size: 22px; line-height: 1.3; margin: 14px 0 10px; }
.dp-block h3 { font-size: 18px; margin: 12px 0 8px; }
.dp-block h4, .dp-block h5 { font-size: 16px; margin: 10px 0 6px; }
.dp-block code { font-family: var(--b-mono, ui-monospace, monospace); font-size: .9em; background: var(--b-bg-layer, #f3f3f3); padding: 0 4px; border-radius: 4px; }
.dp-block .katex-display { margin: 8px 0 14px; }
.dp-changed { box-shadow: inset 3px 0 0 var(--b-accent, #2563eb); background: color-mix(in srgb, var(--b-accent, #2563eb) 6%, transparent); }
.dp-editing { white-space: pre-wrap; overflow-wrap: anywhere; outline: none; background: var(--b-bg-deep, #fafafa); box-shadow: inset 0 0 0 1px var(--b-border-strong, #ccc); padding: 8px 10px; margin: 0 -10px 14px; font-size: 15px; line-height: 1.55; }
.dp-page[data-format="text"] .dp-editing { font-family: var(--b-mono, ui-monospace, monospace); }
.dp-preamble, .dp-chip { display: inline-block; font-size: 13px; color: var(--b-muted, #666); border: 1px dashed var(--b-border-strong, #ccc); border-radius: 6px; padding: 2px 8px; margin: 0 0 14px; }
.dp-box, .dp-abstract { border: 1px solid var(--b-border, #e5e5e5); border-radius: 8px; padding: 8px 12px; margin: 0 0 14px; }
.dp-box { color: var(--b-muted, #666); font-size: 15px; }
.dp-cite, .dp-link { color: var(--b-accent, #2563eb); }
.dp-empty-doc { color: var(--b-muted, #666); }
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
  const sourceButton = el("button", { type: "button", "aria-pressed": "false", title: "Show the file as its source" }, "Source");
  const suggestionsButton = el("button", { type: "button", "aria-pressed": "false" }, "Suggestions");
  const historyButton = el("button", { type: "button", "aria-pressed": "false" }, "History");
  const writeButton = el("button", { type: "button", hidden: "" }, "Write back");
  bar.append(name, from, status, sourceButton, suggestionsButton, historyButton, writeButton);
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
  let mode = "page";
  const sync = new DocSync({
    path: options.path,
    send: options.send,
    onUpdate: (_sync, why, applied) => updated(why, applied)
  });
  const reading = new Reading(sync, {
    ...options.markdown ? { markdown: options.markdown } : {},
    ...options.math ? { math: options.math } : {},
    marks: () => marks
  });
  scroll.append(reading.root);
  text.hidden = true;
  function setMode(next) {
    mode = next;
    sourceButton.setAttribute("aria-pressed", String(mode === "source"));
    text.hidden = mode !== "source";
    reading.root.hidden = mode !== "page";
    if (mode === "source") draw(false);
    else reading.render();
  }
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
      reading.root.dataset.format = sync.format;
      if (mode === "source") draw(false);
      else reading.update(void 0);
    } else if (why === "local") {
      const before = marks.length;
      for (const splice of applied ?? []) marks = shiftMarks(marks, splice);
      if (before > 0 && mode === "source") draw();
    } else {
      const where = caret();
      const known = new Set(marks.map((m) => m.change));
      for (const splice of applied ?? []) marks = shiftMarks(marks, splice);
      const live = new Set(sync.changes.map((c) => c.id));
      marks = marks.filter((m) => live.has(m.change));
      for (const change of sync.changes) if (!known.has(change.id)) marks.push(...marksOf(change.id, applied ?? []));
      if (mode === "page") reading.update(applied ?? []);
      else {
        draw(false);
        if (where) place(shiftCaret(where, applied ?? []));
      }
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
      item.onclick = () => {
        const mark = marks.find((m) => m.change === change.id && m.kind === "ins");
        const target = mode === "source" ? text.querySelector(`[data-change="${change.id}"]`) : [...reading.root.querySelectorAll(".dp-block")].find((b) => mark && Number(b.dataset.start) <= mark.start && mark.start < Number(b.dataset.end));
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
      };
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
  sourceButton.onclick = () => setMode(mode === "source" ? "page" : "source");
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
function mountLiveDoc(host, board, renderers = {}) {
  const raw = host.dataset.path?.trim();
  if (!raw) {
    host.textContent = "This document box names no file: give it a data-path.";
    return;
  }
  const page = mountDocPage(host, {
    ...renderers,
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
