#!/usr/bin/env bash
set -euo pipefail

EXPECTED_NAME="Vedant817"
EXPECTED_EMAIL="vedantmahajan271@gmail.com"
EXPECTED_OWNER="Vedant817"
PREFERRED_HOST="github-personal"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Not inside a Git repository."
cd "$repo_root"

name="$(git config --local --get user.name 2>/dev/null || true)"
email="$(git config --local --get user.email 2>/dev/null || true)"
remote="$(git remote get-url origin 2>/dev/null || true)"

[[ "$name" == "$EXPECTED_NAME" ]] || fail "Local user.name must be '$EXPECTED_NAME'; found '${name:-unset}'. Run: git config --local user.name '$EXPECTED_NAME'"
[[ "$email" == "$EXPECTED_EMAIL" ]] || fail "Local user.email must be '$EXPECTED_EMAIL'; found '${email:-unset}'. Run: git config --local user.email '$EXPECTED_EMAIL'"
[[ -n "$remote" ]] || fail "origin remote is missing. Use the personal SSH alias and repository owner."

case "$remote" in
  git@${PREFERRED_HOST}:${EXPECTED_OWNER}/*)
    ;;
  *)
    fail "origin must use the personal SSH alias and owner, e.g. git@${PREFERRED_HOST}:${EXPECTED_OWNER}/donebond.git; found '$remote'."
    ;;
esac

# Reject obvious credential-bearing URLs even if future checks are relaxed.
if [[ "$remote" == *"@github.com/"* ]] || [[ "$remote" == http://* ]] || [[ "$remote" == https://* ]]; then
  fail "Do not use generic/HTTPS GitHub remotes on this two-account machine. Use '$PREFERRED_HOST'."
fi

# Inspect the latest commit when one exists.
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  author_name="$(git log -1 --format='%an')"
  author_email="$(git log -1 --format='%ae')"
  committer_name="$(git log -1 --format='%cn')"
  committer_email="$(git log -1 --format='%ce')"

  [[ "$author_name" == "$EXPECTED_NAME" ]] || fail "Latest commit author name is '$author_name', expected '$EXPECTED_NAME'."
  [[ "$author_email" == "$EXPECTED_EMAIL" ]] || fail "Latest commit author email is '$author_email', expected '$EXPECTED_EMAIL'."
  [[ "$committer_name" == "$EXPECTED_NAME" ]] || fail "Latest commit committer name is '$committer_name', expected '$EXPECTED_NAME'."
  [[ "$committer_email" == "$EXPECTED_EMAIL" ]] || fail "Latest commit committer email is '$committer_email', expected '$EXPECTED_EMAIL'."
fi

printf 'Git identity OK\n'
printf '  repository: %s\n' "$repo_root"
printf '  identity:   %s <%s>\n' "$name" "$email"
printf '  origin:     %s\n' "$remote"
