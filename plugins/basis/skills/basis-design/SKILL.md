---
name: basis-design
description: Have the screens for an issue or feature designed in Basis before building them, and bring their verification kit into the repo. Use when the user asks to design screens for an issue (WEB-12, owner/repo#42), wants a mockup or flow designed first, or says "design this in Basis".
---

# Design an issue's screens in Basis

Basis is a design tool with its own design agent. It designs a product's screens from the product's own design
system, as a clickable flow called a view, and a person reviews them in Basis before anything is built. The
`basis_*` tools of the Basis MCP server reach it.

1. Find the project: `basis_projects`. Pick the one whose `repo` is this repository, or ask the user when several
   could be. Pass it as `project` from then on (left out, Basis uses its only project).
2. Start the design: `basis_design_view` with the issue's key, title and full text (the feature and its acceptance
   criteria). The view is named for the issue: `WEB-12` becomes the view `web-12`. It answers at once; the design
   takes a few minutes.
3. Follow it with `basis_view_status` on that view about once a minute. While it answers status 404 or
   `agent: "working"`, Basis is still designing. `agent: "waiting"` means Basis' agent asks the person in Basis
   something: tell the user to answer it there.
4. When the view exists and `agent` is `idle`, tell the user to review it in Basis (it is open in a review there,
   `review: "open"`) and to approve the review when it is right. Do not build anything yet.
5. If the user wants changes, send them in their words with `basis_request_changes`, then follow it as in step 3.
6. Once the user says the design is approved (and `review` is no longer `open`), fetch the kit with
   `basis_fetch_kit` and the issue's key. It lands in `basis-verify/<view>/`. Then follow the `basis-verify` skill
   to build the screens.

Do not copy the design's source into the product: the kit's `source/` shows what to build, the product's own
components and tokens are what to build it with.
