# Veya — first brand direction

Consumer-facing name: **Veya**.
Public metadata title: **Veya: Buy crypto with Turkish bank transfers**.
Use this descriptive title for browser tabs, search metadata and social previews. Technical protocol identifiers, payment references,
contracts, proof formats and service addresses retain their existing names.
Name availability and trademark clearance have not been checked.

## Identity

A friendly peer-to-peer exchange starting in Türkiye. Short copy, generous space,
large photography, bold sans-serif typography. The homepage introduces the product;
`/market` retains the existing marketplace. English landing; existing trading locale
controls remain available.

Palette: ivory #F7F5EF, aubergine #281D35, pistachio #DCE6BD; lilac #E8DFF0 supports
the transfer illustration. Dark mode follows system preference. Type: Arial/Helvetica
system stack; heavy, tightly spaced lowercase wordmark. Favicon: V monogram.

Motion: premium, no bounce. 160ms button feedback, 600ms illustration interactions,
650ms section reveals using IntersectionObserver. No scroll hijacking or perpetual
loops. Reduced motion renders all content statically; no-JavaScript content stays visible.

## Assets

`web/public/brand/bosphorus-options/option-2.webp` is the approved production hero.
`web/public/brand/veya-istanbul.webp` is the earlier exploration (approximately 110 KB).
`web/public/brand/veya-istanbul.png` is its source. Generated with the built-in imagegen
tool; illustrative brand photography, not a real customer or testimonial.

Generation prompt:

> Create a premium editorial photograph for Veya, a Turkish peer-to-peer digital currency website. Wide landscape 3:2 composition. A sunlit Istanbul apartment breakfast table next to a tall open window overlooking blurred Bosphorus blue water, soft distant skyline. Close still life on RIGHT HALF: sculptural pale pistachio ceramic espresso cup on saucer, folded ivory linen, a small bowl of apricots, and a modern smartphone face down in a dark aubergine case. Deep warm brown wooden table, olive branch shadows, natural afternoon sunlight, sophisticated analog film photography, authentic lived-in quiet luxury. LEFT HALF should be dark softly shadowed wood and out-of-focus interior with ample negative space for white headline overlay. No people, no text, no logos, no banking cards, no currency, no graphical overlays. Rich tactile detail, restrained warm palette, sophisticated financial lifestyle brand. Image should be a photograph not a website screenshot.

## Product boundaries

Testnet remains explicit. Bank transfers use real TRY; test tokens have no monetary
value. No invented user counts, testimonials, rates, guarantees or bank partnerships.
Receipt upload and proving-service access are disclosed. Technical safeguards link to
How it works. This branding work does not verify or deploy a live financial trade.

## Verification — 2026-09-14

- Production build and TypeScript pass. Focused ESLint checks pass.
- Full ESLint is blocked by two pre-existing `react-hooks/set-state-in-effect`
  errors in `web/src/app/anchor/page.tsx` lines 85 and 90.
- Chromium: desktop 1440px, mobile 390px, dark mode and reduced motion pass FAQ
  interaction, hero-to-market navigation, no horizontal overflow, no hidden reveals
  after scrolling, and no page errors. Additional 320px JavaScript-disabled check
  confirms visible content, loaded hero, and no overflow.
- Final local mobile Lighthouse: performance 96, accessibility 100, best practices
  100, SEO 100. Simulated LCP 2.7s; this is a local lab result, not field telemetry.
- No deployment or live wallet/bank settlement performed.

## Approved logo — 2026-09-14

The user approved the existing bold lowercase `veya` wordmark with the thin northeast arrow, as shown in their second screenshot. Keep this direction; the six generated logo alternatives were not selected.

Six new hero concepts are in `web/public/brand/hero-options/`, with original prompts in `docs/branding/hero-options.json`. The comparison page supports toggling the real headline overlay. Hero selection was finalized with the exact attached café-and-ferry image (gallery option 2).

## Final hero selection

Use the exact image attached by the user, source `exec-66470390-2770-42d3-81c8-cab58c320458.png`, regardless of the conversational option numbering. The café, two people, ferry and water match the approved attachment. Production asset: `web/public/brand/bosphorus-options/option-2.webp`; source: adjacent `option-2.png`.
