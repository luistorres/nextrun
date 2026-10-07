---
name: nextrun
description: A coach's paper training logbook being written as you live it.
colors:
  paper: "#f7f8f6"
  paper-raised: "#fdfdfc"
  paper-shade: "#eef0ee"
  ink: "#22252a"
  ink-soft: "#545a62"
  ink-faint: "#848b94"
  rule: "#ccd6e2"
  rule-strong: "#a8b8c9"
  pencil-red: "#bc3a2a"
  pencil-red-deep: "#98291c"
  sage: "#2f6b45"
  sage-soft: "#e9f1ec"
  amber-pencil: "#96691d"
  amber-soft: "#f5efdc"
  red-soft: "#f7e9e6"
  cloth: "#21402e"
  cloth-deep: "#182f22"
  cloth-text: "#e6eee8"
  cloth-text-dim: "#a9bfb0"
typography:
  headline:
    fontFamily: "Chivo, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "Chivo, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Chivo, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
  annotation:
    fontFamily: "Chivo, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.375
  data:
    fontFamily: "Chivo Mono, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Chivo, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.08em"
rounded:
  sm: "4px"
  stamp: "3px"
  md: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  page: "16px"
  page-lg: "32px"
components:
  button-primary:
    backgroundColor: "{colors.pencil-red}"
    textColor: "{colors.paper-raised}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.pencil-red-deep}"
  button-secondary:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.paper-shade}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  card:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px 24px"
  input:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  stamp:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.stamp}"
    padding: "0.1em 0.45em"
---

# Design System: nextrun

## Overview

**Creative North Star: "The Coach's Paper Logbook"**

Every screen is a page in a paper training log that a coach keeps for one runner. The ground is cool ledger-white paper with faint blue feint rules and a red vertical margin line; the app chrome is the logbook's racing-green buckram cloth cover. Content is written onto the page in dark ink (Chivo), data lands in a monospaced hand (Chivo Mono, tabular numerals), and the coach's own voice appears as a penciled red italic annotation in the margin — one plain adult sentence, underlined by a hand-drawn stroke that draws itself in once.

The world explicitly refuses the dark quantified-self dashboard: no neon accents, no arc gauges, no glassy dark surfaces, no gradients. Depth is nearly flat, density is calm, and semantic color is scarce and disciplined — red is the coach's pencil (action, annotation), sage green is what's done, amber is caution. Everything else is neutral ink on paper.

**Key Characteristics:**
- Cool ledger-white paper ground with blue feint rules and a red margin line; never cream or warm paper.
- Ruled log rows instead of grids of cards; weeks read as register entries.
- Coach voice as Chivo italic in pencil-red with a hand-drawn underline — never a script or handwriting face.
- Rubber date/phase stamps (condensed caps, thin border, slight rotation) for status labels.
- Racing-green buckram cloth for navigation chrome only; the page itself stays paper.
- Dry, adult copy: no exclamation marks, no cutesy first-person coach voice.

## Colors

A near-monochrome paper-and-ink ground with three scarce semantic voices: red pencil, sage, and amber.

### Primary
- **Pencil Red** (`--pencil-red`, #BC3A2A): the coach's pencil. Solid primary buttons, the log sheet's vertical margin line, coach annotations, active mobile tab, pending-change dots, focus rings, text caret, and selection tint (rgba(179,58,43,0.18)). Hover/pressed deepens to **Pencil Red Deep** (#98291C), which is also the error text color. **Red Soft** (#F7E9E6) is its rare background tint.

### Secondary
- **Sage** (`--sage`, #2F6B45): done and positive. Pencil-tick checkmarks on completed rows, "done" stamps, confirmation lines. **Sage Soft** (#E9F1EC) shades chart baseline bands and positive backgrounds.
- **Amber Pencil** (`--amber-pencil`, #96691D): caution and staleness. Missed workouts, sync-lag notices; always paired with a kind next step, on **Amber Soft** (#F5EFDC) when it needs a background.

### Tertiary
- **Buckram Cloth** (`--cloth`, #21402E): racing-green logbook cover, used only for the navigation spine/chrome (with the `.buckram` woven-texture overlay). Text on cloth is **Cloth Text** (#E6EEE8), dimmed to **Cloth Text Dim** (#A9BFB0) at rest; **Cloth Deep** (#182F22) is its darker step. Cloth never appears inside page content.

### Neutral
- **Paper** (#F7F8F6): the page ground (`body` background).
- **Paper Raised** (#FDFDFC): sheets, cards, inputs, nav bars — anything that sits on the page.
- **Paper Shade** (#EEF0EE): recessed/hover fills and skeleton base.
- **Ink** (#22252A): primary text and chart lines.
- **Ink Soft** (#545A62): secondary text, metadata, secondary button labels.
- **Ink Faint** (#848B94): placeholders, empty-state text, chart axis ticks.
- **Rule** (#CCD6E2): the blue feint line — card borders, row dividers, chart grids.
- **Rule Strong** (#A8B8C9): input and secondary-button borders, chart baselines, scrollbar thumb.

### Named Rules
**The Scarce Semantics Rule.** Red = action/coach, sage = done/positive, amber = caution. No other semantic color exists, and none of the three is decoration; a screen with no action, nothing done, and nothing wrong is entirely ink on paper.

**The No Shame Rule.** A missed workout is never red. It gets amber and a kind, concrete next step.

**The Cool Paper Rule.** Grounds are cool ledger white — never cream, sand, or any warm paper tint.

## Typography

**Body/UI Font:** Chivo (system-ui, sans-serif fallback), normal + italic
**Data/Mono Font:** Chivo Mono (monospace fallback), tabular numerals

**Character:** A grotesque with a draftsman's plainness. Chivo carries everything spoken; Chivo Mono carries everything measured — distances, paces, splits. The coach's voice is Chivo *italic* in pencil-red, never a script or handwriting face.

### Hierarchy
- **Headline** (700, 1.5rem, up to 1.875rem at `sm:`, tight leading): today's session title, page heroes. This is the ceiling — nothing on a page exceeds text-3xl.
- **Title** (600, 0.875rem): sheet headers, date lines, section headings.
- **Body** (400, 0.875rem, relaxed leading, max-w-prose): descriptions and explanations.
- **Annotation** (500 italic, 1rem, pencil-red): the coach margin note, via `.coach-note`.
- **Data** (Chivo Mono, 0.875rem, tabular-nums): paces, distances, durations, chart ticks (11px in charts).
- **Label/Stamp** (700 condensed, 11px, 0.08em tracking, UPPERCASE): only inside `.stamp` chips.

### Named Rules
**The Pencil-Not-Script Rule.** The coach's voice is Chivo italic in pencil-red. Handwriting and script fonts are banned everywhere, forever.

**The Mono-Means-Measured Rule.** Chivo Mono appears only on quantities the watch measured or the plan prescribes (pace, distance, time, splits); it never sets prose.

## Layout

Pages are log sheets inside a logbook. On desktop (`lg:` 1024px+) a fixed 224px buckram spine holds navigation on the left; the main column scrolls with 32px padding. On mobile the spine disappears, navigation becomes a bottom tab bar (52px min-height targets, safe-area padded), and page padding drops to 16px. The first phone viewport is today's enlarged log entry with the coach's margin note beside it (stacking under it below `sm:` 640px); the rest of the week fades below in ruled rows.

Lists are ruled rows separated by 1px `--rule` dividers — a register, not a grid. The `.log-sheet` ground draws only the ledger's red vertical margin line (1.5px `--pencil-red` at 1.625rem); entry content sits right of the margin (pl-10/pl-12). Horizontal rules exist only as structural row separators (1px `--rule` borders between entries), never as decorative lines behind prose. Card innards use a 24px horizontal / 16px vertical padding rhythm; general spacing follows the 4px Tailwind scale.

**The Ruled Row Rule.** Weeks, activities, and plan lists are ruled rows on shared paper, never grids of same-size cards. Nested cards do not exist.

**The Margin Line Rule.** The 1.5px pencil-red vertical margin line is the brand device: it grounds `.log-sheet`, divides the wordmark, and marks the app icon. Horizontal rules are structural only — a decorative rule behind prose strikes through it.

## Elevation & Depth

Effectively flat. Depth comes from paper tones (paper → paper-raised → paper-shade) and 1px feint-blue borders, plus two textures: `.paper-tooth` (faint fractal-noise grain over the page ground) and `.buckram` (woven cloth weave on the green chrome). The single shadow in the system is a whisper under sheets and tooltips.

### Shadow Vocabulary
- **Sheet lift** (`box-shadow: 0 1px 4px rgba(38,36,31,0.06)`): cards, the today sheet, chart tooltips. That's the whole vocabulary.

### Named Rules
**The One Shadow Rule.** `0 1px 4px rgba(38,36,31,0.06)` is the only shadow. Nothing floats, glows, or lifts on hover.

## Shapes

Small, quiet radii: 4px (`rounded`) on buttons and inputs, 6px (`rounded-md`) maximum on sheets and cards, 3px on stamps and skeletons. No pills except tiny status dots. Borders are 1px `--rule` (sheets, dividers) or 1px `--rule-strong` (inputs, secondary buttons); dashed `--rule` borders mark empty states. The recurring silhouettes are hand-drawn SVG strokes: the pencil underline, the sage completion tick, and the slightly rotated (-1.5deg) rubber stamp.

## Components

### Buttons
- **Shape:** barely rounded (4px); sizes sm/md/lg = `px-3 py-1.5 text-sm` / `px-4 py-2 text-sm` / `px-6 py-3 text-base`, weight 500–600.
- **Primary:** solid pencil-red with paper-raised text; hover deepens to pencil-red-deep. One solid red action per view.
- **Secondary:** 1px rule-strong border on paper-raised, ink text; hover fills paper-shade.
- **Outline / Ghost:** transparent, ink-soft text, hover paper-shade + ink.
- **States:** 150ms color transitions, `active:translate-y-px` press, pencil-red focus-visible outline (2px, offset 2), disabled at 50% opacity, loading shows an inline spinner.

### Cards / Containers
- **Corner Style:** 6px.
- **Background:** paper-raised on the paper ground.
- **Border:** 1px `--rule`; header/footer sections divided by the same rule.
- **Shadow:** the sheet lift (see Elevation).
- **Internal Padding:** 24px × 16px (`px-6 py-4`).

### Inputs / Fields
- **Style:** paper-raised fill, 1px rule-strong border, 4px radius, `px-3 py-2 text-sm`; labels 500-weight ink above; placeholder ink-faint; caret pencil-red; autofill repainted to paper-raised/ink.
- **Focus:** border shifts to pencil-red (no glow).
- **Error:** pencil-red border, pencil-red-deep message below; helper text ink-faint.

### Navigation
- **Desktop:** 224px `.buckram` racing-green spine; wordmark + "training log" subtitle; items are cloth-text-dim, brighten to cloth-text on hover; the active item is a paper-colored tab (`rounded-l-md`, `--paper` background, ink text) — the open page's edge showing through the cover. 18px stroke-icon + label, never icon-only.
- **Mobile:** bottom tab bar on paper-raised over a 1px rule; active tab pencil-red, inactive ink-soft; 11px labels under 20px icons.
- **Pending-change signal:** a 1.5px pencil-red dot, with sr-only text.

### Charts
Recharts on paper: ink (#22252A) data lines at 1.5px with small ink dots, feint-blue dashed grid (`#CCD6E2`, 0.5px), rule-strong dashed baselines, sage-soft personal-baseline bands, a single pencil-red dot marking the latest reading. Axis ticks are Chivo Mono 11px ink-faint. Tooltips are miniature sheets (rule border, paper-raised, the one shadow). Annotation over legend; no neon, no gradients. Empty chart = dashed-rule box with an ink-faint explanatory line.

### Coach Margin Note (signature)
`.coach-note`: one plain italic pencil-red sentence (Chivo, 500, 1rem) with a hand-drawn SVG underline that draws itself in once (`.pencil-stroke`, 480ms, 120ms delay). Drivers/caveats follow in a smaller line at 80% opacity. **One per screen, maximum.** Completion is its sibling: the `.pencil-check` sage tick draws in over 260ms. Both freeze under `prefers-reduced-motion`.

### Stamp (signature)
`.stamp`: rubber date/phase stamp — condensed 700 uppercase, 0.08em tracking, 1.5px `currentColor` border, 3px radius, rotated -1.5deg. Color follows meaning: ink-soft for neutral phase labels ("WEEK 3/12"), sage for done. Used for phase/status labels only, never as a button.

### Wordmark (brand)
`Wordmark` (`src/components/ui/wordmark.tsx`): "next│run" — bold tracking-tight Chivo with the ledger's red vertical margin line (1.5px `--pencil-red`, stretched to the full cap height via `self-stretch`, 0.18em side margins, nudged down 0.08em) dividing the two words. The line is the same brand device as `.log-sheet`'s margin. Two tones: `ink` for paper contexts, `cloth` (cloth-text) on the buckram spine. The app icon (`src/app/icon.svg`) repeats the construction: paper tile (12px radius), red margin line, ink "n".

## Do's and Don'ts

### Do:
- **Do** keep semantic color scarce: pencil-red for action and the coach's voice, sage for done, amber for caution — everything else ink on paper.
- **Do** set every measured quantity (pace, distance, duration, splits) in Chivo Mono with tabular numerals.
- **Do** treat missed workouts with amber and a kind, concrete next step.
- **Do** design empty states: ghost ruled rows or a dashed-rule box with one explanatory ink-faint line.
- **Do** write copy dry and adult ("Recovered. Run this as written."), with a concrete next step in every negative state.
- **Do** show only the metrics a sport actually has: pace and distance belong to distance sports; other sports get their own relevant measures.
- **Do** reserve `.log-sheet` ruled paper for the hero/today entry, not every surface.

### Don't:
- **Don't** use cream or warm paper grounds — the ledger is cool white, ever.
- **Don't** use script or handwriting fonts anywhere; the coach annotates in Chivo italic.
- **Don't** use dark dashboard surfaces, neon accents, arc gauges, gradients, or glow effects.
- **Don't** lay out weeks or lists as grids of same-size cards, and don't nest cards.
- **Don't** use exclamation marks or a cutesy first-person coach voice.
- **Don't** add shadows beyond the sheet lift, radii beyond 6px, or motion beyond 150–250ms state transitions — the pencil-stroke draw is the one authored moment.
- **Don't** put more than one coach margin note or more than one solid red action on a screen.
- **Don't** draw decorative horizontal rules behind prose; horizontal rules are structural row separators only, and `.log-sheet` draws only the red vertical margin line.
