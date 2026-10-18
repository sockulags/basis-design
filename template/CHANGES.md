# Starter template changes

What changed in Basis' starter components, patterns and views, by template version. Basis updates the files a
workspace never changed by itself; the agent brings these changes into the ones it did change, keeping the
design system's own look.

## 1

- Reduced motion in every component and pattern: under `@media (prefers-reduced-motion: reduce)` nothing slides,
  zooms, shimmers or loops (presses do not shrink, cards do not lift, the indeterminate progress bar and the
  skeleton stand still, tooltips, toasts and dialogs only fade, the tab indicator and underlines jump). Spinners
  keep turning, since they are the only sign that work goes on. See the `@media (prefers-reduced-motion: reduce)`
  block at the end of each stylesheet.
- Field: the label is a `<label for>` above the control, then the hint, then the error, then the control. The hint
  and the error are tied to the control with `aria-describedby`, the control gets `aria-invalid` from the Field's
  error (through a React context, so TextInput, Textarea and Select need no extra props), and the error has an
  icon as well as the danger colour.
- Navbar responds to its own width, as a size container: from 1024px everything sits in the bar; from 800px the
  search becomes a button that opens the field below the bar, with focus in it; under 800px the links, the search
  and the actions move into a menu behind a menu button. `compact` still forces the narrow layout, and the menu
  keeps its own open state unless `menuOpen` is given.
- AppShell is a size container named `app-shell`; SidebarNav becomes its icon rail inside a narrow one (under
  640px). The rail's grid column is pinned so its icons stay centred.
- Small text that used `textSubtle` (SidebarNav section titles, StatCard hints) uses `textMuted`, since subtle is
  held to 3:1 and small text needs 4.5:1.

## 2

- DataTable fits a phone without scrolling sideways. Its frame is a size container named `data-table`; under 600px
  each row becomes a stack of label and value pairs (every cell carries `data-label` with its column's header,
  shown through `::before`), with the row's checkbox beside it. The first column names the row, so it heads the
  stack at full width without a label. The header row stays as a strip with select all and
  the sortable columns; the other headings are hidden, since every row repeats them. The table, row groups, rows,
  headers and cells have explicit roles (`table`, `rowgroup`, `row`, `columnheader`, `cell`), which keep it a table
  for screen readers once CSS changes its display. See the `@container data-table` block at the end of
  `DataTable.module.css`.
- The tooltip specimen gives the static tooltip room on its left (`paddingInlineStart`), so the open tooltip no
  longer runs past the gallery's edge.
