## Maharat overview

- Maharat helps people who know English but struggle to speak it.
- Maharat Mate holds open conversations about any topic.
- Maharat Coach checks grammar, phrasing, clarity, and professional spoken English before saving a recording or continuing the conversation.

## UX and design system

- Arabic-first and RTL, with English speech practice at the center.
- Mobile-first.
- UI writing uses concise, direct Modern Standard Arabic.
- The experience is minimal, calm, and uncluttered.
- Avoid gradients, glows, and decorative shadows. Prefer flat colors, clean spacing, and strong typography.
- Apply Hick's Law, Miller's Law, single-task focus, and progressive disclosure.
- Each screen has one clear primary action, generous emptyspace, and quiet secondary UI.
- Use the established dark design tokens: `#101112` background, `#191b1d` surfaces, `#f4f1e8` primary text, `#a7a7a1` secondary text, and `#f8be3f` brand emphasis. Use gold sparingly.
- maharat's logo at public/maharat-logo.svg
- Main typeface: IBM Plex Sans Arabic.

## Naming conventions

- Files: `kebab-case`
- React components and schemas: `PascalCase`
- Variables, functions, and Firestore fields: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Firestore collections: plural `kebab-case`

## Data and storage

- Our philosophy: save the raw, derive the rest. Treat the database as the source of truth, never as a cache of computed results.
- Store raw, unprocessed inputs exactly as they arrive. Compute every derived value in code at read time, deterministically, from the same source.
- Never persist anything that can be recomputed from raw data — stored derived values drift from reality and become obsolete. The only exception is data that is genuinely new information, not a transformation of existing data.
