# Taste ledger

What the user has approved and rejected, newest first. Read this before every
run. A rejected look is never used again in any form; an approved one is a
safe default. Add each new lasting decision here, with its date, when you act
on review notes.

## Rejected

- **2026-10-17 · Connect.** Disliked. Removed from the Agenta brand; lockup and
  pair cover partner posts. The template stays in the kit for other brands.

- **2026-10-17 · Pair is too flat, and three fixes missed:** overlapping big
  tiles, tiles inside interlocking hairline rings, and tiles on a tint stage
  joined by a connector. The user asked for a simple change instead (approved
  below).

- **2026-10-17 · Grid.** Dropped in review. Removed from the Agenta brand;
  the template stays in the kit for other brands.

- **2026-10-17 · Thirteen of eighteen draft formats:** flow, branch,
  anatomy, waterfall, heatmap, layers, timeline, steps, kanban, venn, tree,
  sequence, matrix, and the yellow bento and hub. Never added to the kit.

- **2026-10-17 · Pair on yellow.** Dropped in review. `formatGrounds` limits
  pair to white.

- **2026-10-17 · Press.** Dropped in review. Removed from the Agenta brand;
  the template stays in the kit for other brands. Link cards go to quiet.

- **2026-10-17 · Exchange, studio and depth.** "Those are making the posters
  look cheap." Removed from the Agenta brand; studio and depth are deleted
  from the kit. Approvals and agent-in-a-channel posts go to context (the
  `.chat` among faded cards); a hero card goes to prompt or window.

- **2026-10-16 · Every gradient look.** "Those look like low quality graphics,
  especially daylight and sunrise." Daylight, sunrise, haze and aurora are
  removed from the kit; studio, prompt, window, spotlight, plate and
  milestone are flattened; Agenta sets `allowLight: false`. No gradients,
  glow or grain on any Agenta post.

- **2026-10-16 · A "so bad and broken" series from another session.** Title
  Case titles, the bitmap chip on every title, small cards and arrow diagrams
  on empty canvases, a bubble spilling past its card, whole screenshots
  shrunk to mush. Every one of these is now an audit failure, kept as a
  regression test (`review/regress.py`). The contact sheet that should have
  shown it was blank (fixed).

- **2026-10-16 · Isometric,** dropped on white and then on yellow. Removed from the Agenta formats.

- **2026-10-16 · A narrow, phone-like chat column.** "Too narrow, and the
  component itself doesn't look good" on every chat post. The `.chat` component
  is now landscape (56–64 %W): white bubbles for the person, ink bubbles for the
  agent, and the approval as one row inside the agent's message.

- **2026-10-16 · Figure and field-report,** dropped in the third gallery review.
- **2026-10-16 · Uneven title-to-card spacing.** Both crowded ("very close") and
  drifting ("very big") gaps were flagged on eight posts. Title and subject go in
  one `.stack` with a fixed gap; the audit fails outside 4.5–9 %H.
- **2026-10-16 · Off-centre groups.** Title and subject must centre as one block
  (sunrise post 04).
- **2026-10-16 · A left-aligned statement with an empty right half.** The
  statement is now centred and set large.
- **2026-10-16 · A sentence on the aurora look.** Aurora carries a 1–3 word name
  with the mark.
- **2026-10-16 · Composed product mocks where a real screen exists.** "It should
  be really product picture based on who you are creating for": capture the
  real screen (marketplace post 09).
- **2026-10-16 · The depth focus row spilling past its card** on yellow. Fixed;
  the row keeps inside the card on every ground.

- **2026-10-16 · Plain chat cards.** "The component does not look good": flat
  bubbles in a bare card. Channel posts use the kit's `.chat` component (header
  with avatar and status, bubbles with tails and timestamps, the approval as an
  action panel inside the agent's message).
- **2026-10-16 · A left-aligned statement with an empty right half** (release
  post 15). Fill the canvas with the subject; the keyboard studio shot
  replaced it.

- **2026-10-16 · Ledger, graphite, field, annotated and emboss,** dropped on
  every ground in the second gallery review: big numerals on flat paper, a
  dim field behind a title, eval rings, the proofreader's box, and the
  blind-embossed word. Removed from the Agenta formats.
- **2026-10-16 · Field-report on yellow.** Field-report stays, on white only.

- **2026-10-16 · Proof** (a title beside a cropped screen that fades out) and
  **woven** (a band of state-coloured cells): both dropped on white and on
  yellow in the first gallery review. Removed from the Agenta formats.

- **2026-10-16 · Mosaic.** A partner logo rebuilt from rounded dots. Removed
  from both skills.
- **2026-10-16 · Dark grounds.** No carbon or black backgrounds on any post.
- **2026-10-16 · White plate behind the logo on yellow.** The black lockup goes
  straight on the yellow.
- **2026-10-16 · Serif text inside product UI.** Card text, bubbles and buttons
  are Inter; only the title is GT Alpina.
- **2026-10-16 · Empty, lopsided layouts.** A title on the left with nothing on
  the right reads unfinished. The audit warns at over 86 % bare ground or
  weight outside 0.34–0.66 W.
- **2026-10-16 · Generic first drafts.** "Too generic": a plain title plus a
  plain card on a flat ground is not enough on its own.
- **2026-10-16 · Variety for its own sake** (superseded). Rotating formats to
  stay unique is no longer the goal; the best fit for each message is.
- **2026-10-16 · Messaging on the image.** No subcopy, taglines, CTAs, URLs,
  dates or prices; a title at most.

## Approved

- **2026-10-17 · Lockup,** the haze idea without the haze: the two lockups
  split by a thin slash, flat, on white or yellow, no title.

- **2026-10-17 · Pair, the simple change.** Same layout, tiles at 30 %H with a
  real drop shadow and a soft top-to-bottom shade, like the brand's keys. A
  gradient is fine on a tile, "but not much"; the ground stays flat.

- **2026-10-17 · Bento, bento-split, hub, modules and sankey,** kept from
  two rounds of drafts, on white only. Added to the kit and the Agenta brand.

- **2026-10-16 · Internal A/B.** Three candidates per post, tested
  internally; the user sees only the winner, chosen for the message first,
  then for a clean, balanced picture.

- **2026-10-16 · Best fit per message, repeats allowed.** "It can be
  repetitive, no problem there, but it must pick the best option instead of
  going unique every time." Pick by what the message needs to show.

- **2026-10-16 · Kept in the third review:** every format still listed in
  `brand/brand.json`, the sunrise drafts for WhatsApp, Slack and Telegram, and
  release posts 02–08, 10 and 12–14.

- **2026-10-16 · Reference picks.** The posts the user kept from 21 company
  accounts are listed in
  [`../social-graphic/studies/picks-2026-10.md`](../social-graphic/studies/picks-2026-10.md):
  Runway, Lovable, Modal, Bolt, Clerk, v0, Cohere, Mistral and The Browser
  Company. Two groups are for special posts only: analytics references for
  data posts, and meme references only when the brief asks for a meme.

- **2026-10-16 · Stunning, mature, premium.** The bar for every post. Premium
  formats are the first choice.
- **2026-10-16 · Light in brand colours** (superseded the same day: all
  gradient looks were rejected as low quality).
- **2026-10-16 · White or yellow grounds,** alternating across a series.
- **2026-10-16 · GT Alpina Light titles,** Inter for UI text, one PP Mondwest
  word at most.
- **2026-10-16 · Inspired by, never copied.** The references (Vercel, Cursor,
  Linear, Raycast, Resend, Granola, Perplexity) give principles, never looks.
