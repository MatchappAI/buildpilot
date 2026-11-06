# Publishing BuildPilot

Store name: **BuildPilot for Claude Code**. "BuildPilot" alone is taken on the VS Code Marketplace by `mr-srs.buildpilot`, an unrelated Jenkins tool. Display names must be unique there. Checked 2026-11-06: "BuildPilot for Claude Code" was free on both stores.

The package is ready: `npm run package` builds `dist/buildpilot.vsix` with the Marketplace README (`docs/marketplace/README.md`), `CHANGELOG.md`, the icon and the macOS menu-bar widget. Nothing has been published.

## Decisions only you can make
1. **Publisher ID.** This is the permanent first half of the extension ID (for example `mohilgupta.buildpilot`). Today it's the placeholder `buildpilot-local`. Change `"publisher"` in `package.json`. Everything else follows automatically: vscode:// links, the widget, the Desktop scripts and the walkthrough.
2. **License.** Today it's proprietary ("All rights reserved"). That's allowed on both stores. Choose MIT or similar if you want others to fork it.
3. **Public source repo (optional).** It lets the listing show screenshots and an issue link. Add `"repository"` to `package.json` and remove `--allow-missing-repository` from the `package` script.

## VS Code Marketplace (free)
1. Sign in at https://marketplace.visualstudio.com/manage with a Microsoft account, then **Create publisher** using the ID you chose.
2. Create a Personal Access Token at https://dev.azure.com: User settings → Personal access tokens → New. Set Organization to **All accessible organizations** and Scopes to **Marketplace → Manage**.
3. Run:
   ```bash
   cd ~/buildpilot
   npx vsce login <publisher-id>        # paste the token
   npm run package && npm run publish:vscode
   ```
4. The listing appears within a few minutes at `https://marketplace.visualstudio.com/items?itemName=<publisher-id>.buildpilot`.

## Open VSX (Cursor, Windsurf, VSCodium)
1. Sign in at https://open-vsx.org with GitHub, sign the publisher agreement, and create an access token.
2. Create the namespace once: `npx ovsx create-namespace <publisher-id> -p <token>`
3. Publish: `OVSX_PAT=<token> npm run publish:openvsx`

## Every release
`npm run ci` → bump `version` → add a `CHANGELOG.md` entry → `npm run package` → `npm run publish:vscode` and `npm run publish:openvsx` → `npm run desktop`.

## Notes
- The VSIX contains a macOS app (the menu-bar widget, zipped). It's ad-hoc signed, which is fine because it's installed by the extension (no browser download, so no Gatekeeper prompt). Distributing the widget as a separate download would need an Apple Developer ID ($99/year) and notarization.
- The listing says BuildPilot is independent and not affiliated with Anthropic. Keep that line.

## Claude Code plugin (one-line install for every Claude Code user)
The plugin lives in `plugin/`, and the marketplace file is `.claude-plugin/marketplace.json`, both in this repo. Claude Code's validator passes both (`claude plugin validate ./plugin`, `claude plugin validate .`). It was installed and checked in a scratch config: hooks fired, and events reached the spool.
1. Push this repo to a **public** GitHub repo. The README assumes `buildpilot/buildpilot`; if yours differs, change the two install lines in `README.md` and `docs/marketplace/README.md`.
2. Users run `/plugin marketplace add <owner>/<repo>` and then `/plugin install buildpilot@buildpilot`. On Claude Code 2.1.275 or later, `/plugin install buildpilot --marketplace <owner>/<repo>` does both in one step.
3. Every release: `npm run build` (it refreshes `plugin/bin/cli.js`), then bump `version` in `plugin/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, then commit and push.
4. Optional: submit to Anthropic's plugin directory once the repo is public.

## Payments (Stripe → license key)
Pro isn't on sale until you do this. Until then BuildPilot never blocks anything; everyone just has the full product.
1. **Stripe:** create a product "BuildPilot Pro" at $9/month. Recommended: also offer $79/year. Create a **Payment Link**. Under *After payment*, set the confirmation page to `https://<your-worker>/success?session_id={CHECKOUT_SESSION_ID}`. Paste the `https://buy.stripe.com/...` link into `CHECKOUT_URL` in `src/core/license.ts`.
2. **Worker:**
   ```bash
   cd ~/buildpilot/server
   npx wrangler login
   npx wrangler kv namespace create LICENSES       # paste the id into wrangler.toml
   npx wrangler secret put LICENSE_PRIVATE_KEY     # paste ~/.buildpilot-issuer/private.pem
   npx wrangler secret put STRIPE_WEBHOOK_SECRET   # from step 3
   npx wrangler deploy
   ```
3. **Stripe webhook:** add an endpoint at `https://<your-worker>/stripe/webhook` for the event `checkout.session.completed`. Copy its signing secret into step 2.
4. **Optional anonymous counts:** set `COUNT_URL` in `src/core/counts.ts` to `https://<your-worker>/v1/count`.
5. Test with Stripe test mode: buy → the thank-you page shows the key → `bp license <key>` → the "Pro" pill appears.
6. To make a key by hand (gifts, refunds, press): `node scripts/issue-license.mjs "<name>" pro [days]`.

The private key (`~/.buildpilot-issuer/private.pem`) is the only thing that can make keys. Back it up somewhere safe. If it's lost, existing keys keep working, but you can't make new ones without shipping a new public key.
