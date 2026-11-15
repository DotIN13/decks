#!/bin/zsh
# A second checkout for one agent: a git worktree on its own branch off rewrite, with everything git
# ignores (node_modules, built files, fonts) cloned in, which costs no disk on this file system.
# Usage: zsh docs/rewrite/new-checkout.sh <agent>   ->  ../decks-dev-checkouts/<agent>, branch rewrite-<agent>
set -e
main=/Users/dotin13/Documents/DotGit/dotty-project/decks-dev
name=${1:?the agent name, lower case}
dir=/Users/dotin13/Documents/DotGit/dotty-project/decks-dev-checkouts/$name
free=$(df -g /System/Volumes/Data | tail -1 | awk '{print $4}')
[ "$free" -lt 12 ] && { echo "only $free GB free: no new checkout under 12"; exit 1; }
mkdir -p ${dir:h}
git -C $main worktree add -q $dir -b rewrite-$name rewrite
cd $main
git ls-files -o -i --exclude-standard --directory | while read p; do
	case "$p" in engine/target/*|.scratch/*|*.DS_Store|apps/web/*) continue;; esac
	p=${p%/}; [ -e "$main/$p" ] || continue
	mkdir -p "$dir/${p:h}"; cp -cR "$main/$p" "$dir/$p"
done
free=$(df -g /System/Volumes/Data | tail -1 | awk '{print $4}')
echo "$dir on branch rewrite-$name; $free GB free"
