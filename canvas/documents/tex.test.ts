import assert from "node:assert/strict";
import { test } from "node:test";
import { readTabular, texMeta } from "./tex.ts";

const paper = String.raw`\documentclass{article}
\title{Photos move the answers}
\author{A. One \and B. Two}
\begin{document}
\maketitle
\section{Introduction}\label{sec:intro}
As shown \cite{b,a} and again \cite{a}. % \cite{commented}
\begin{equation}
x = 1 \label{eq:one}
\end{equation}
\section{Method}
\subsection{Data}\label{sec:data}
\begin{align}
a &= b \label{eq:two} \\
c &= d \nonumber \\
e &= f \label{eq:three}
\end{align}
\begin{figure}\caption{A picture}\label{fig:pic}\end{figure}
\begin{table}\caption{Numbers}\label{tab:n}\end{table}
\begin{theorem}\label{thm:main} True.\end{theorem}
\begin{equation*} y \end{equation*}
\begin{equation}\label{eq:four} z \end{equation}
\end{document}`;

test("labels, citations and environments are numbered as a first LaTeX run numbers them", () => {
	const meta = texMeta(paper);
	assert.equal(meta.title, "Photos move the answers");
	assert.equal(meta.author, "A. One \\and B. Two");
	assert.deepEqual(meta.labels.get("sec:intro"), { num: "1", kind: "section" });
	assert.deepEqual(meta.labels.get("sec:data"), { num: "2.1", kind: "section" });
	assert.deepEqual(meta.labels.get("eq:one"), { num: "1", kind: "equation" });
	assert.equal(meta.labels.get("eq:two")?.num, "2");
	assert.equal(meta.labels.get("eq:three")?.num, "3", "a \\nonumber row takes no number");
	assert.deepEqual(meta.labels.get("fig:pic"), { num: "1", kind: "figure" });
	assert.deepEqual(meta.labels.get("tab:n"), { num: "1", kind: "table" });
	assert.deepEqual(meta.labels.get("thm:main"), { num: "1", kind: "theorem" });
	assert.equal(meta.labels.get("eq:four")?.num, "4", "a starred equation takes no number");
	assert.deepEqual([...meta.cites], [["b", 1], ["a", 2]], "in order of first citation, comments ignored");
});

test("a bibliography in the file numbers citations by its own order", () => {
	const meta = texMeta(String.raw`\cite{x}\cite{y}
\begin{thebibliography}{9}\bibitem{y} Y.\bibitem{x} X.\end{thebibliography}`);
	assert.deepEqual([...meta.cites], [["x", 2], ["y", 1]]);
});

test("a tabular is read into rows, spans, alignments and rules", () => {
	const { rows, rules } = readTabular("l|rr", String.raw`\toprule Group & Users & Shift \\ \midrule Left & 120 & $-0.012$ \\ \multicolumn{3}{c}{All} \\ \bottomrule`);
	assert.deepEqual(rows[0]!.map((c) => c.text), ["Group", "Users", "Shift"]);
	assert.deepEqual(rows[1]!.map((c) => c.align), ["left", "right", "right"]);
	assert.deepEqual(rows[2], [{ text: "All", span: 3, align: "center" }]);
	assert.deepEqual(rules, [0, 1, 3]);
});

test("the file's macros are read as definitions KaTeX accepts, and put at the head of a formula", async () => {
	const { readMacros, withMacros } = await import("./tex.ts");
	const macros = readMacros(String.raw`\newcommand{\R}{\mathbb{R}}
\renewcommand\vec[1]{\mathbf{#1}}
\newcommand{\opt}[1][x]{#1}
\def\E{\mathbb{E}}
\DeclareMathOperator*{\argmax}{arg\,max}`);
	assert.equal(macros, String.raw`\def\R{\mathbb{R}}\def\vec#1{\mathbf{#1}}\def\E{\mathbb{E}}\def\argmax{\operatorname*{arg\,max}}`, "a default optional argument drops only that one");
	assert.equal(withMacros("$x\\in\\R$", "\\M"), "$\\Mx\\in\\R$");
	assert.equal(withMacros("$$y$$", "\\M"), "$$\\My$$");
	assert.equal(withMacros("$y$", ""), "$y$");
});
