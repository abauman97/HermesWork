#!/usr/bin/env bash
# CI-only: run in a disposable checkout with origin pointing to the trusted repository.
set -euo pipefail

# Both validation jobs must have passed for this exact revision, including manual runs.
validated_sha=$(git rev-parse --verify "${VALIDATED_SHA:?VALIDATED_SHA is required}^{commit}")
bot_name='github-actions[bot]'
bot_email='41898282+github-actions[bot]@users.noreply.github.com'
git config user.name "$bot_name"
git config user.email "$bot_email"

# A competing publisher may have advanced main without triggering another workflow.
# Accept only a linear chain of our asset-only commits above the validated revision.
main_is_validated() {
  git merge-base --is-ancestor "$validated_sha" origin/main || return 1
  local commit
  for commit in $(git rev-list "$validated_sha..origin/main"); do
    [ "$(git show -s --format=%P "$commit" | wc -w)" -eq 1 ] || return 1
    [ "$(git show -s --format='%an <%ae>%n%cn <%ce>%n%s' "$commit")" = \
"$bot_name <$bot_email>
$bot_name <$bot_email>
chore(build): update compiled plugin assets" ] || return 1
    [ "$(git diff-tree --no-commit-id --name-only -r "$commit")" = \
      'desktop/plugin.js' ] || return 1
  done
}

skip_newer_main() {
  echo "main differs from validated revision $validated_sha; skipping publication for its newer workflow."
}

git fetch origin +refs/heads/main:refs/remotes/origin/main
if ! main_is_validated; then
  skip_newer_main
  exit 0
fi

# Build only the triggering revision. Never run newer main's code under old check results.
git reset --hard "$validated_sha"
rm -f desktop/plugin.js
npm --prefix frontend ci
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
test -s desktop/plugin.js
test ! -L desktop/plugin.js
npm --prefix frontend test
bundle_blob=$(git hash-object -w desktop/plugin.js)

for attempt in 1 2 3; do
  git fetch origin +refs/heads/main:refs/remotes/origin/main
  if ! main_is_validated; then
    skip_newer_main
    exit 0
  fi
  publish_base=$(git rev-parse origin/main)
  # Only generated assets may differ from the validated tree at this point.
  git reset --hard "$publish_base"
  mkdir -p desktop
  rm -f desktop/plugin.js
  git cat-file blob "$bundle_blob" > desktop/plugin.js
  git add -f -- desktop/plugin.js
  if git diff --cached --quiet; then
    echo 'Build assets are unchanged.'
    exit 0
  fi
  git commit -m 'chore(build): update compiled plugin assets'
  # HEAD is a direct child of publish_base, so a successful update is fast-forward.
  # Require the remote to still equal that exact base atomically: an ordinary push
  # would also accept a rollback to an ancestor and silently undo it.
  if git push --force-with-lease="refs/heads/main:$publish_base" origin HEAD:refs/heads/main; then
    exit 0
  fi
  git fetch origin +refs/heads/main:refs/remotes/origin/main
  if ! main_is_validated; then
    skip_newer_main
    exit 0
  fi
  if [ "$publish_base" = "$(git rev-parse origin/main)" ]; then
    echo '::error::Push rejected; check Actions write permissions and main branch rules.'
    exit 1
  fi
  if ! git merge-base --is-ancestor "$publish_base" origin/main; then
    echo 'main was rolled back or rewritten before push; skipping publication.'
    exit 0
  fi
  echo "Asset publisher advanced main before push; retrying (attempt $attempt/3)."
done

echo '::error::Asset publishers kept advancing main; rerun the workflow.'
exit 1
