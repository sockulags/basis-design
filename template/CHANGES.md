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
