# Security release checklist

How a vulnerability report becomes a fixed, published release on every supported line. The commitments come from [SECURITY.md](https://github.com/asemqaffaf/rust-fetch/blob/main/SECURITY.md); this page is the procedure behind them. It describes what the repository and `release.yml` do today, and marks what has not been tested.

## State as checked on 2026-11-06

| Item | State | Consequence |
| --- | --- | --- |
| Private vulnerability reporting (GitHub) | Disabled | The "advisory" link in SECURITY.md returns an error for outside reporters. The email address in SECURITY.md is the only working private channel until the repository owner enables it (Settings, Code security). |
| Branch protection and rulesets on `main` | None | A push to `main` needs no review. The release process below relies on the maintainer's discipline, not on enforcement. |
| Secret scanning push protection | Disabled | A committed secret is detected only after the push. |
| People who can publish to npm | One maintainer | There is no second publisher. If that account is unavailable, nobody can ship a fix. |
| Release drill | Not run | The timings in the drill table below are blank on purpose. |

Re-check these with `gh api repos/asemqaffaf/rust-fetch` (security_and_analysis), `gh api repos/asemqaffaf/rust-fetch/rulesets` and the npm package's maintainer list before relying on this table.

## Clock

| Step | Target | Source |
| --- | --- | --- |
| Acknowledge the report | 48 to 72 hours after receipt | SECURITY.md |
| Triage (confirm, rate, name affected lines) | 7 days after receipt | This page, not yet promised publicly |
| Fix released on every supported line | As soon as the fix is reviewed; no fixed date is promised | SECURITY.md |
| Advisory published | Same day as the last release | SECURITY.md |

The 7-day triage target is an internal goal. It is not in SECURITY.md and nothing enforces it.

## Procedure

### 1. Receive and acknowledge

1. Open the report in a private place only: the maintainer inbox, or a draft security advisory if private reporting has been enabled. Never create a public issue or PR for it.
2. Reply to the reporter within 72 hours: confirm receipt, give one point of contact, say whether more detail is needed.
3. Record the receipt date and time (JST) in the private notes. Every later date counts from it.

### 2. Triage

1. Reproduce on the newest release and on `main`. Use the reporter's environment: Node version, browser, and whether the native addon is loaded (`RUST_FETCH_NATIVE`).
2. Decide which transports are affected: `node:http`, the native addon, browser `fetch`, XHR, WebSocket. A fix that covers one transport and not another is not done.
3. Find the first affected release and the last. `SECURITY.md` lists the supported lines; each line that is affected and supported needs its own release.
4. Rate it (CVSS v3.1 or v4.0) and write the one-sentence impact.
5. If a secret, credential or user data leaked in a published artifact, rotate it first, then continue.

### 3. Fix privately

1. Work in a private fork or a temporary private fork of a draft advisory, not in a public branch.
2. Write the regression test first and see it fail. Put it next to the related security test (`wasm-module/js/test/`, or a Rust test in `wasm-module/src/`).
3. Fix on the newest line first. Run `npm run test:js`, `cargo test` for `wasm-module` and `native`, and `node scripts/check-unsafe.mjs` if Rust changed.
4. Cherry-pick onto each supported older line. The older lines have no long-lived branch: create `release/X.Y.Z` from the last tag of that line (for example `git switch -c release/2.6.3 v2.6.2`), apply the fix, and rerun that line's tests. A fix that does not apply cleanly is re-written, not forced.
5. Do not mention the vulnerability in commit messages or PR titles until publication. Use a neutral summary such as "harden header handling".

### 4. Prepare each release

For every affected line `X.Y.Z`:

1. Set the version in `package.json`, `wasm-module/Cargo.toml`, and `native/Cargo.toml`. `npm run build` regenerates `wasm-module/pkg/package.json` from `wasm-module/Cargo.toml`. `release.yml` builds, then fails when the tag differs from that generated version.
2. Move the `Unreleased` entries in `CHANGELOG.md` under `## [X.Y.Z] - YYYY-MM-DD`. Keep the entry vague until publication, then fill in the advisory link.
3. Update the "Latest patch" column in `SECURITY.md`.
4. Merge through a PR once CI is green. On a private fork, merge the fork PR at publication time instead.

### 5. Publish

1. Tag the merge commit of each release and push the tag. The order does not matter: `release.yml` compares the version with the highest one on npm and never moves `latest` backwards.
   ```bash
   git tag -a vX.Y.Z -m "rust-fetch X.Y.Z"
   git push origin vX.Y.Z
   ```
2. `release.yml` then runs on each tag. It picks the npm dist-tag itself: `latest` when the version is the highest published, `release-X.Y` for an older line, `next` for a pre-release. It publishes with provenance and verifies the installed package with `npm audit signatures`. If the run fails after publishing, re-run it: an already-published version is skipped.
3. Check each version yourself:
   ```bash
   npm view rust-fetch dist-tags
   npm view rust-fetch@X.Y.Z version dist.attestations
   mkdir /tmp/verify && cd /tmp/verify && npm init -y && npm install rust-fetch@X.Y.Z && npm audit signatures
   ```

### 6. Disclose

1. Publish the GitHub Security Advisory with the affected and patched version ranges, and request the CVE through it.
2. Credit the reporter if they agreed to it.
3. Update the CHANGELOG entries with the advisory link.
4. If a vulnerable version should no longer be installed, run `npm deprecate "rust-fetch@<range>" "Security fix in X.Y.Z, see the advisory"`. Deprecate; do not unpublish.
5. Reply to the reporter with the release links.

### 7. Afterwards

1. Run the new regression test against the oldest affected release to confirm it fails there, so the advisory's range is correct.
2. Add the case to the claims table in [Security](./security) if it changes a stated guarantee.
3. Write down what slowed the process and change this page.

## Dry run

Rehearse everything except the publish:

1. Create a private note with a fake report dated today.
2. Branch `release/0.0.0-drill` from `main`, make a one-line harmless change, bump the version to `0.0.0-drill.1`.
3. Push the branch (not a tag) and confirm CI is green.
4. Run `release.yml` logic locally up to the publish step: `npm ci`, the build, and `node scripts/check-package.mjs --strict --no-bench`. Do not push a `v*` tag; that publishes.
5. Fill in the table below and delete the branch.

| Step | Started (JST) | Finished (JST) | Duration | Problem found |
| --- | --- | --- | --- | --- |
| Acknowledge | | | | |
| Triage | | | | |
| Fix and test on the newest line | | | | |
| Backport to one older line | | | | |
| Version bump and changelog | | | | |
| CI green on the release PR | | | | |
| Pre-publish package check | | | | |

Status: NOT RUN. No drill has been performed, and the publish step, the tag-triggered workflow and the advisory step have never been exercised for a security fix.

## Gaps this page does not close

- No second person can publish or approve. A bus-factor of one is a delivery risk for the 48 to 72 hour and release commitments.
- Private vulnerability reporting is off (see the first table).
- The `release-*` backport branches are not kept. Each backport starts from a tag, which is slower than a maintained branch.
- `security.txt` has an `Expires` date. After it passes, scanners treat the file as stale. Renew it at least 14 days before 2027-05-06 and bump the date in `docs/public/.well-known/security.txt`.

<!-- drill: harmless one-line change, 2026-11-07 -->
