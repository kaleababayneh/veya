# Fetching the e-dekont from Gmail (no .eml download)

The buyer flow can pull Ziraat's e-dekont straight from the buyer's Gmail instead of asking for a downloaded
`.eml`. It runs entirely in the browser:

1. Google Identity Services opens the consent popup and hands the page a **read-only** Gmail access token
   (`gmail.readonly`), valid for an hour, kept in memory only.
2. The page queries the Gmail API for `from:ileti.ziraatbank.com.tr subject:e-dekont has:attachment after:<reservation time>`,
   newest first.
3. For each hit it downloads the raw RFC 822 message (`messages.get?format=raw`, the same bytes as "Show original →
   Download original") and submits it to the prover, which checks the DKIM signature, the recipient, the amount and the
   wallet reference before proving. The first e-mail the prover accepts becomes the job.

Nothing about the mailbox touches our servers: the Google token and the inbox listing stay in the browser; only the one
matching e-mail goes to the prover, exactly as with a manual upload. Manual upload remains available for other mail providers.

## One-time setup (Google Cloud Console, ~10 minutes)

1. https://console.cloud.google.com → create a project (e.g. `zkotc`).
2. **APIs & Services → Library → Gmail API → Enable.**
3. **APIs & Services → OAuth consent screen**: User type *External*; app name `zkOTC`, support e-mail, developer e-mail.
   Scopes: add `https://www.googleapis.com/auth/gmail.readonly`. Publishing status: **Testing**, and add every Gmail address
   that will use the app as a *test user* (Google caps this at 100). Save.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**: type *Web application*; **Authorized JavaScript
   origins**: `http://localhost:3000` (and the production origin later). No redirect URI is needed (token flow). Copy the
   **Client ID** (`…apps.googleusercontent.com`).
5. `web/.env.local`: `NEXT_PUBLIC_GOOGLE_CLIENT_ID=<client id>` and restart `npm run dev`. The "Fetch the e-dekont from Gmail"
   button appears in step 3 of a reservation.

## Things to know

- `gmail.readonly` is a **restricted** scope. In *Testing* mode Google shows an "unverified app" interstitial (click
  *Continue*) and only listed test users can consent. Going public requires Google's app verification plus a CASA security
  assessment for restricted scopes — plan 4–8 weeks and a privacy policy URL before mainnet.
- The search window starts 10 minutes before the reservation to absorb clock skew; a dekont sent for an older transfer is
  rejected by the prover's date check anyway.
- If several e-dekonts arrived since the reservation (several transfers), each is tried in turn; the prover's error for the
  last one is shown if none matches (wrong amount, missing reference, wrong recipient).
- Apple Mail / Outlook users: manual upload (File → Save As → Raw Message Source). Microsoft Graph could be added the same
  way (`Mail.Read`, `/me/messages/{id}/$value`).
