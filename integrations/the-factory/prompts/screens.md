The screens for this card are being designed in Basis, a separate design tool, by its own agent. A person reviews
them there and approves this step when they are right. Do not change anything.

{{card.key}}: {{card.title}}

{{handover.previous}}

{{#if input}}
The reviewer asked for changes; they are being made in Basis:

{{input}}
{{/if}}

From the spec above, write the handover for the reviewer and for the steps after this one:

1. The screens the feature needs, and how the user moves between them.
2. The states each screen must show: empty, loading, an error, a long list, a confirmation, where they apply.
3. What the screens must not do or show, if the spec says.

Keep it to what the reviewer can check against the view in Basis. The verification kit arrives in
`basis-verify/` on this card's branch when the step is approved.
