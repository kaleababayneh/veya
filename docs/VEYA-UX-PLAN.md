# Veya internal product UX plan

Date: 2026-09-14
Status: **Planned; implementation paused at the user's request.**

## Objective

Make buying crypto feel like one understandable, resumable purchase. Carry the
approved Veya identity into trading screens while keeping payment requirements,
wallet confirmations, fees, deadlines and current testnet limitations explicit.

This plan follows a source review, not customer research or a fresh live settlement
audit. Validate assumptions through task-based usability sessions when work resumes.
The existing operational roadmap remains separate; this document does not reschedule
its release work or authorize financial transactions.

## Existing foundations to preserve

- Approved lowercase Veya wordmark with northeast arrow, aubergine/pistachio palette,
  and selected Bosphorus café hero.
- Marketplace at `/market`; ad detail, seller, activity and reservation routes.
- Quote calculation showing fees and net receipt; min/max amount shortcuts.
- Verified payee details, individual copy controls, payment reference binding,
  countdown and late-payment guard.
- Reservation step cards and restoration of proof jobs using the existing job ID.
- Existing mobile “continue on a computer” link and buyer-language support. Improve
  their discoverability and completeness rather than treating them as missing.

## Scope and invariants

Frontend usability, presentation, state recovery and complete English/Turkish copy.
No changes to escrow economics, proof validation, bank support, payment reference
format, protocol identifiers, timing rules or authorization requirements in this plan.
Any backend change discovered during implementation must be described separately.

Use contract configuration as the source of fee and deadline values. Do not describe
wallet connection as a reservation, payment declaration as bank verification, proof
completion as settlement, or a bond claim as a full refund. Preserve explicit receipt
processing consent and disclosures of operator access. Never persist receipt contents,
IBANs or unnecessary personal data for UX convenience.

## Delivery order

| Phase | Priority | Deliverable | Dependency |
|---|---|---|---|
| 1 | P0 | Readiness and receipt guidance before reservation | None |
| 2 | P0 | Guided purchase and actionable recovery states | Phase 1 |
| 3 | P1 | Amount-first offer discovery | Shared quote rules from phase 2 |
| 4 | P1 | Activity focused on resuming trades | Phase 2 state model |
| 5 | P2 | Seller setup and consistent application navigation | Shared UI established |

Each phase ends with a reviewable local result and focused verification. No dates or
automatic continuation are scheduled. Implement sequentially when the user resumes.

## Phase 1 — establish readiness before the clock starts

Files: `web/src/app/ads/[id]/page.tsx`, `web/src/lib/wallet.tsx`,
`web/src/app/r/[id]/page.tsx`, `web/src/lib/i18n.tsx`, relevant bank components.

- Before reserve, show supported payer banks, wallet/network readiness, required
  receipt format, and the fact that bank transfers are real while tokens are testnet.
- Let buyers select their payer bank and see concise bank-specific receipt guidance.
- Explain how to obtain the original `.eml`; clearly distinguish it from PDFs,
  screenshots and ordinary forwarding.
- Put the existing computer-continuation path before payment where relevant. Verify
  actual mobile bank/mail workflows before claiming mobile-only completion works.
- Preserve the chosen amount and bank through wallet connection. Explain when a
  wallet signature costs a network fee and when it only proves wallet ownership.

Acceptance:
- Unsupported payer bank produces a useful alternative before reservation.
- Wallet unavailable, rejected connection and wrong-network cases have recovery actions.
- No reservation transaction starts simply by connecting a wallet.
- First-time users can state what they will need after making the transfer.
- Desktop and mobile paths have accurate guidance for both supported banks.

## Phase 2 — one dominant next action

Primary file: `web/src/app/r/[id]/page.tsx`; shared UI and i18n as needed.

- Present Reserve → Send payment → Verify receipt → Receive crypto, using existing
  contract states. Show the current step prominently and collapse completed details.
- Maintain a compact summary: exact TRY payment, net crypto receipt, seller and
  relevant deadline. On mobile, ensure any persistent action avoids keyboard overlap.
- Make the required payment reference visually prominent alongside amount and IBAN.
- Use plain-language buttons: “Show payment details”, “I've sent the transfer”,
  “Verify receipt”, “Receive [amount]”. Explain the transaction beneath the action.
- Separate wallet approval, submission, chain confirmation, receipt validation,
  proof generation and settlement states. Never show success ahead of confirmation.
- Pair errors with the correct next action; preserve known payment state through retry.
- Check elapsed-time and expiry copy against unpaid, declared-paid, released and
  late bond-claim cases; retain all existing protective guards.

Acceptance:
- Payee mismatch cannot lead into instructions to pay.
- Bank details and reference copy accurately, with accessible feedback.
- Insufficient remaining time prevents the payment action as today.
- Rejecting a wallet prompt leaves the user able to retry without duplicate actions.
- Invalid receipt, unavailable prover and failed settlement have distinct recovery.
- Confirmed settlement displays actual received amount and transaction evidence.
- Bond-claim screens describe the bond amount without promising recovery of all funds.

## Phase 3 — amount-first marketplace

Primary files: `web/src/app/market/page.tsx`, `web/src/app/ads/[id]/page.tsx`.

- Lead with TRY amount and desired asset; carry selected payer bank from readiness.
- Filter offers by valid amount limits, remaining liquidity, active status and expiry.
- Compare exact net receipt after the configured fee, not just advertised unit price.
- Preserve choices when opening an offer and returning to results.
- Keep an explicit full-market browsing option for experienced users.
- Show useful loading, stale-data, failure and no-match states, with an adjustable
  amount or asset rather than a dead end.

Acceptance:
- Filtering and displayed amounts use the canonical integer-based quote functions.
- Same input yields consistent payment and net receipt in market and offer detail.
- A changed price or depleted offer is revalidated before reservation.
- No sorting or badges imply unverified seller safety or reputation.

## Phase 4 — resume from activity

Primary files: `web/src/app/me/page.tsx`, reservation page and shared state helpers.

- Put unfinished trades above completed history, ordered by needed action/deadline.
- Replace generic “Open” with specific actions such as “Continue payment”,
  “Verify receipt”, or “Receive crypto”. Derive wording from confirmed state.
- Refresh on returning to the tab/app and after relevant mutations; use bounded
  polling for active trades, cleanup and retry/backoff for failures.
- Restore the correct trade after refresh and wallet reconnection. Treat missing or
  lost prover jobs as a recoverable state; do not imply local persistence survives a
  server restart.
- Show connection and stale-state feedback instead of empty or misleading lists.

Acceptance:
- Returning from a banking app refreshes the current trade state.
- Switching wallets never exposes the previous wallet's private trade details.
- Reload during proving resumes an existing job or explains why re-upload is needed.
- No raw receipt or bank data is added to local storage.
- Active/completed/error/empty states each provide an appropriate next action.

## Phase 5 — seller flow and application consistency

Primary files: `web/src/app/sell/page.tsx`, `web/src/app/ads/[id]/page.tsx`,
`web/src/components/Nav.tsx`, `web/src/components/ui.tsx`, i18n and styles.

- Simplify primary navigation to Buy, Sell, Activity and Help; keep anchor funding
  accessible from seller tools with an understandable label.
- Group seller setup into Amount and price → Bank details → Review.
- In review, show liquidity, additional bond, total token commitment, trade limits,
  price, duration and withdrawal conditions before the wallet transaction.
- Preserve form values when going back or cancelling a wallet prompt without
  persisting sensitive bank details unnecessarily.
- Apply approved Veya typography, wordmark, spacing and semantic color roles to all
  internal screens. Keep transactional layouts compact and legible.
- Complete EN/TR coverage of seller forms, activity, errors and recovery actions;
  eliminate mixed-language sentences while retaining exact bank field names.

Acceptance:
- Seller can explain total deposit and bond before publishing.
- Inline errors identify the field and preserve other entered values.
- Closing an ad explains its effect on active reservations before submission.
- Funding tools remain discoverable to sellers without occupying primary buyer nav.
- Keyboard navigation, focus, labels, status announcements and touch targets work.
- Light/dark mode and reduced motion retain equivalent functionality.

## Verification and evidence

1. Re-read local instructions, current source and configuration when implementation
   resumes; do not rely on this snapshot for live bank or service behavior.
2. Focused tests for meaningful state/quote/recovery behavior, then TypeScript,
   lint and production build. Current full-lint baseline has two existing anchor
   quote-effect errors; resolve or report them explicitly, never claim a clean suite.
3. Browser checks at 320/390px and desktop, EN/TR, light/dark, reduced motion,
   keyboard use and return-from-background behavior. Check real content, not only
   generic component fixtures.
4. Fixture-driven scenarios: missing wallet, rejected signature, unavailable offer,
   invalid amount, insufficient funds/trustline, expiry, payee mismatch, invalid email,
   prover unavailable/lost job, transaction failure, settlement and bond claim.
5. Separately document any actual wallet/bank/prover tests. UI tests or compilation
   are not evidence of real settlement. Do not initiate a bank transfer as part of
   implementing this plan without appropriate user authorization.
6. Conduct short task-based usability sessions: buy an amount, find a receipt,
   recover an interrupted trade, publish an offer. Record failures and revise.

If analytics is added later, define a privacy-reviewed event contract before sending
anything. Candidate measures: quote-to-reservation progression, receipt-step exits,
retry outcomes and successful trade resumption. No baseline or conversion lift is
claimed here; no receipt, IBAN, name or payment-reference content belongs in events.

## Implementation handoff — 15 September 2026

The user resumed implementation and authorized a PR. All five implementation phases
are included in `feat/veya-internal-ux`. See [VEYA-UX-REVIEW.md](VEYA-UX-REVIEW.md)
for corrected defects, tests, screenshots and remaining integration/usability evidence
gaps. The bank/prover/chain contract behavior remains unchanged. No deployment or
merge is included.
