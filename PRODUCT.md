# Product

## Register

product

## Users

Home cooks who like to see how a recipe is put together, reading it inside a Notion page. They want the ingredient-to-step relationship at a glance, not a long narrative.

## Product Purpose

Generate a compact ingredient-by-step chart for a recipe. It runs entirely in the browser, so it can be hosted as a static page and embedded in Notion without a backend. Success: a cook can scan the chart, find any ingredient, and see exactly which actions it joins.

## Brand Personality

Precise, calm, practical. It should feel like a tool that belongs in Notion: quiet surfaces, clear type, no decoration that competes with the data.

## Anti-references

- Decorative recipe blogs with oversized photos and long intros.
- Card-heavy SaaS dashboards with gradients and glass surfaces.
- Spreadsheet clutter: every cell walled off with heavy borders.
- Rounded-pill styling applied to structural elements.

## Design Principles

1. The matrix is the content. Every visual choice helps trace an ingredient through the steps.
2. Borrow Notion's vocabulary: system sans, hairline borders, gray action blocks, one blue accent.
3. Dense but readable. The chart earns its width; on small screens it becomes a linear step list.
4. One source of truth. The chart, the mobile list, and the screen-reader list are rendered from the same recipe data.
5. Stay still. No entrance animation, no decorative motion. Only hover and focus feedback.

## Accessibility & Inclusion

WCAG AA contrast for all text. The table has row headers and a linear step list for screen readers. The chart scrolls horizontally with a sticky ingredient column and a visible scroll hint. Focus states are visible, and motion respects `prefers-reduced-motion`.
