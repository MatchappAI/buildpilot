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
