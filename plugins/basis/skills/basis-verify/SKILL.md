---
name: basis-verify
description: Build screens designed in Basis so they match pixel for pixel, using the verification kit in basis-verify/. Use when implementing a view from basis-verify/, when a kit's PROMPT.md is in the repo, or when asked to check a page against its Basis design.
---

# Build and verify against a Basis design

A verification kit is a folder under `basis-verify/` that holds `PROMPT.md` and `basis-verify.json`: one per
issue or view (`basis-verify/web-12/`), or one for every view (`basis-verify/` itself). Find the kit of what you
build: the folder named for the issue's view, or the one whose `PROMPT.md` lists the view. No kit yet? Fetch it
with the `basis_fetch_kit` tool, or follow the `basis-design` skill first.

1. Read the kit's `PROMPT.md` and follow it: the goal, where things are, the view's notes in `views/<view>.md`,
   and the loop.
2. The loop, in the kit's folder (shown as `<kit>`): capture the design on this machine once with
   `node <kit>/capture.mjs design --only <view>`; build a screen with the product's own components and tokens; point
   `<kit>/targets.json` at its page; capture it with `node <kit>/capture.mjs app --only <view>/<screen>`; compare
   with `node <kit>/compare.mjs --only <view>/<screen>`; read the diff images in `<kit>/diff/`, fix, and repeat
   until every shot passes.
3. Only elements marked `data-basis-media` (the product's own photos) and named exceptions in
   `<kit>/exceptions.json`, each with a reason, may differ. The target is 0%.
4. When the shots pass, prove it where you cannot change the result: run the `basis-diff` skill. The kit's own
   compare runs on files you can edit; basis-diff is Basis' own photographs.

Stop and report when three rounds bring no progress, or when a fix would change shared code, global styles or the
product's tokens.
