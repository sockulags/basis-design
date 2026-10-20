---
name: basis-tokens
description: Build UI with the product's design system from Basis (its colour, type, spacing, radius, shadow and motion tokens, and its components' props) instead of guessing values. Use when writing or restyling UI in a product whose design system lives in Basis, or when asked which token, colour or spacing to use.
---

# Build with the product's design system

The product's design system lives in Basis. Its tokens and its components' contracts are the source of truth,
not values copied from existing CSS.

1. Read it with the `basis_design_system` tool (name the project if Basis has several). It answers with:
   - `tokens`: the design system as JSON (colour roles for light and dark, typography, spacing, radius, shadow,
     motion, and component tokens);
   - `css`: the same as CSS custom properties (`--color-primary`, `--space-4`, `--radius-md` …), the names the
     product's exported design system uses;
   - `contracts`: the TypeScript props every component and pattern accepts.
2. Use the custom properties, never raw values: a colour is a role (`--color-text`, `--color-danger`), a gap is a
   space step, a corner a radius token. Pick by meaning, not by the nearest value.
3. Use the product's components with the props their contracts list before writing new markup. When something is
   missing from the design system, say so rather than inventing a token; the design system changes in Basis.
4. Both themes: check that what you build reads in light and dark, since every colour role has both.
