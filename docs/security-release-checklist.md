# Security release checklist

How a vulnerability report becomes a fixed, published release on every supported line. The commitments come from [SECURITY.md](https://github.com/asemqaffaf/rust-fetch/blob/main/SECURITY.md); this page is the procedure behind them. It describes what the repository and `release.yml` do today, and marks what has not been tested.

## State as checked on 2026-11-07

| Item | State | Consequence |
| --- | --- | --- |
| Private vulnerability reporting (GitHub) | Enabled on 2026-11-07 | The "advisory" link in SECURITY.md works for outside reporters. It was disabled when this page was first written (2026-11-06). |
| Rulesets on `main` | "Protect main", active | No deletion or force push; a pull request and nine passing status checks are required, with no approval count (one maintainer). Repository admins can bypass it. Tags are not covered: signed tags would block the tag push that publishes. |
| Secret scanning push protection | Enabled on 2026-11-07 | A committed secret that matches a known pattern is blocked at push. |
| People who can publish a release | One maintainer | A tag push runs `release.yml`, which publishes with the `NPM_TOKEN` secret, so it is the people with Write access who can ship. There is one. If that account is unavailable, nobody can ship a fix. See "Adding a second person who can ship a fix" below. |
| Release drill | Dry run done on 2026-11-07, publish not exercised | See the dry run table below. |

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
| Acknowledge | 13:14:24 | 13:14:24 | 0 s | A fake report was written to a local note. No template exists for the reply, and nothing measures the 48 to 72 hour commitment |
| Triage | 13:14:24 | 13:14:33 | 9 s | The claimed header injection (a bare CR, a bare LF, CRLF) does not reproduce: all three are refused with `InvalidInputError`, and `security.test.mjs` passes. A real report would need the affected lines named, which this step does not exercise |
| Fix and test on the newest line | 13:14:33 | 13:14:43 | 10 s | None for a one-line documentation change |
| Backport to one older line | 13:14:43 | 13:14:50 | 7 s | `git cherry-pick` onto `v2.6.2` conflicted (modify/delete): the file did not exist on that line. The change had to be applied by hand. Real fixes touch code that moved between lines, so expect this |
| Version bump and changelog | 13:14:50 | 13:15:00 | 10 s | Eight files in three ecosystems change (`package.json`, `package-lock.json`, two `Cargo.toml`, three `Cargo.lock` files, `CHANGELOG.md`). There is no bump script, and a BSD `sed` edit of `package.json` silently changed nothing |
| CI green on the release PR | 13:15:17 | 13:31:14 | 15 min 57 s | A pushed branch runs no CI; a draft pull request was needed. All 29 checks passed, 3 skipped |
| Pre-publish package check | 13:15:27 | 13:16:07 | 40 s | None: `npm ci`, the build and `check-package.mjs --strict --no-bench` passed (36 of 36) |

These timings are of an automated run by the maintainer's assistant, with no waiting for a second person. They show that the steps work and where they snag, not how long a human response takes.

Status: DRY RUN DONE on 2026-11-07 (draft pull request #266, closed, branch deleted). Not exercised: the publish step, the tag-triggered `release.yml` (including the new reproducibility gate on a real tag), the advisory and CVE steps, the backport of a code fix, and a second person doing any step.

## Adding a second person who can ship a fix

What publishes a release is a tag. `release.yml` runs on a push of `v<major>.<minor>.<patch>` and publishes with the repository secret `NPM_TOKEN`. So the people who can ship a fix are the people who can push a tag to this repository, and a second person needs repository access, not an npm account. The owner does the following in the GitHub web interface (none of it can be done from CI or by an assistant):

1. **Settings, Collaborators:** invite the person with the **Write** role, not Admin. Write can push branches and tags and re-run workflows. It cannot read or change secrets, change repository settings or edit the ruleset on `main`.
2. **Settings, Rules, Rulesets:** add a ruleset for tags matching `v*` that restricts creation to the owner and this person, so that nobody else with Write access can publish. A ruleset on tags does not stop a repository admin, who can bypass it.
3. **Security, Advisories:** a draft advisory is shared per advisory. Add the person as a collaborator on each one, and tell them the private reporting address from `SECURITY.md`.
4. **npm (optional):** for the case where GitHub Actions is down, add them with `npm owner add <npm-user> rust-fetch` and require two-factor authentication on that account. This is the only step that gives a person the power to publish outside `release.yml`, and publications from outside it have no provenance.
5. **Rehearse together:** the person runs the procedure above from the acknowledgement to the pre-publish check on a dry run, with the owner watching but not typing. Record their timings in the dry run table.

This page's acceptance bar for "a second person able to publish a security release" is step 5 done by someone other than the owner. Until a person is named and has done it, that bar is not met, whatever the repository settings say.

## Gaps this page does not close

- No second person can publish or approve, and the owner has not named one. A bus-factor of one is a delivery risk for the 48 to 72 hour and release commitments. The steps to fix it are above; they need a person.
- The `release-*` backport branches are not kept. Each backport starts from a tag, which is slower than a maintained branch.
- `security.txt` has an `Expires` date. After it passes, scanners treat the file as stale. Renew it at least 14 days before 2027-05-06 and bump the date in `docs/public/.well-known/security.txt`.
