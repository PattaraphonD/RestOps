# Palette theme (v1.7.1) — design

**Intent.** The owner chose a five-colour palette for the app's look: coral #F09B93, blush #EBD6D7, cream #F9EBD9, yellow #E9DD8A, teal #439093. Replace the forest-green theme with it, to the standard of a professional restaurant product: readable in a bright kitchen, alerts that stay obvious, and a matching dark mode.

**Goals.** Every palette colour has a clear job. Text and buttons meet WCAG AA (4.5:1 body text, 3:1 large text and graphics). Light and dark themes. App icon and browser colour match.
**Non-goals.** No layout, flow or copy changes.
**Anti-goals.** Warnings or errors that look like decoration; white text on coral or pale teal.

## Approaches
1. **Token swap with colour roles (chosen).** The stylesheet already routes nearly every colour through CSS variables at the top of `app.css`. Re-map them to the palette, add accent and highlight tokens, and touch the few components that need a new role. Small, consistent, reversible.
2. Paint the palette at full strength everywhere (teal buttons with white text, coral badges with white text). Rejected: white on #439093 is 3.7:1 and on coral 2.1:1, below AA for normal text.
3. A theme switcher keeping the old green as an option. Rejected: the owner changed the brand; two looks to maintain for no benefit.

## Colour roles (light)
| Token | Value | Use |
|---|---|---|
| brand | #2E6E71 (deeper teal, same hue as #439093) | Buttons with white text (5.8:1), links, active tab |
| brand-bright | #439093 | Hero card (gradient to it), charts, progress, focus ring. Chart "money out" uses a deeper coral #D06F66 (3.4:1 on white) |
| brand-soft | #DDEDEC | Active-tab pill, brand avatars |
| accent | #F09B93 coral, text #3B1E1A | Close-the-day button, + button, nav badges, chart "money out" |
| plane | #F9EBD9 cream | Page background; cards stay white |
| line | #EBD6D7 blush | Card borders, dividers |
| highlight | #E9DD8A yellow | Warning tint (warn-soft), setup/today highlights; text on it is dark olive |
| bad | #C0392B | Errors stay a true red, darker than coral |
| good | #2F8F4E | "OK" stays green, not teal |

Ink is a teal-black (#1F2A2B); muted text #5E696A (4.8:1 on cream).

## Dark
Deep teal-charcoal planes (#0F1E1F / surfaces #172A2B…), cream ink, teal #6FB7BA for buttons (dark text), coral and yellow as accent and warning. The hero card keeps the teal gradient with white text.

## Also
`theme-color` meta, manifest colours, and the app icon (SVG + PNGs) in teal with cream and coral rings. Service-worker cache bumped to v1.7.1.

**Left to the builder:** exact tints for soft backgrounds and dark-mode surfaces, within AA.
