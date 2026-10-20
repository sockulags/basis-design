---
name: basis-diff
description: Prove that implemented screens match their Basis design with basis-diff, where Basis itself photographs the design and the product and keeps the verdict out of the agent's reach. Use before calling a view's implementation done, when asked to verify against the design, or when a reviewer wants proof.
---

# Prove it with basis-diff

The kit's own compare runs on files you could change, so it shows you how far off you are but proves nothing.
basis-diff is the proof: you give Basis only the URLs of the product's pages, Basis photographs the design and
those pages with the same browser, compares them, and keeps the images and the verdict where no agent can change
them. A person reads the report in Basis.

1. Start the product's dev server, and make sure Basis can reach it: on the same machine `http://localhost:<port>`
   works; for a Basis elsewhere, use an address it can open (a preview deployment, the machine's name).
2. Run the `basis_verify` tool with the view and `targets`, the same shape as the kit's `targets.json`, keyed by
   screen id: `{ "baseUrl": "http://localhost:3000", "screens": { "list": "/team", "member": { "url": "/team/42", "waitFor": "h1" } } }`.
   Give a `label` that says what was checked: the issue, the branch, the commit.
3. Read the answer:
   - `pass` is the verdict. It leaves out only elements marked `data-basis-media`, whose places and sizes must
     still match. Every shot must be `pass`.
   - `passWithExceptions` applies the exceptions you sent. They are claims for a person to judge, listed with
     their reasons in the report; they never make `pass` true.
   - `page` is the report in Basis: the design, the product and their difference for every shot.
4. When `pass` is false, read the failing shots (status, percent, problems), fix, and run it again. Each run is
   kept, so the history shows how it went.
5. Report the result with the report's page, not with your own reading of the kit's compare.

Never send exceptions to make a failing shot pass. Fix the product, or tell the user what cannot match and why,
and let them decide.
