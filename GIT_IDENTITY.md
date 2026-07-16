# Git Identity and Remote Safety

The development machine has both personal and work GitHub accounts. DoneBond must use only the personal account.

## Required identity

```text
GitHub username: Vedant817
Git author/committer name: Vedant817
Git author/committer email: vedantmahajan271@gmail.com
Preferred SSH host alias: github-personal
Repository owner: Vedant817
```

## Initial repository setup

Run inside the DoneBond repository only:

```bash
git config --local user.name "Vedant817"
git config --local user.email "vedantmahajan271@gmail.com"
```

Never use `--global`, because that could alter work repositories.

Create or correct the remote using the personal SSH alias:

```bash
git remote remove origin 2>/dev/null || true
git remote add origin git@github-personal:Vedant817/donebond.git
```

When the repository has a different final name, replace only `donebond.git`; retain `github-personal` and `Vedant817`.

## Authentication verification

```bash
ssh -T git@github-personal
```

The response should identify the personal GitHub user. Authentication messages may say GitHub does not provide shell access; that is normal. The important part is that it identifies `Vedant817`.

## Mandatory pre-commit/pre-push checks

```bash
bash scripts/verify-git-identity.sh
git config --local --get user.name
git config --local --get user.email
git remote get-url origin
git log -1 --format='author=%an <%ae>%ncommitter=%cn <%ce>' 2>/dev/null || true
```

Expected:

```text
Vedant817
vedantmahajan271@gmail.com
git@github-personal:Vedant817/<repository>.git
```

## Forbidden configurations

- A work email in local author/committer settings
- A remote owned by a work organization/user
- Generic `git@github.com:...` when multiple account keys are configured
- HTTPS credentials that may select the work account
- Running `git config --global user.name` or `user.email`
- Force-pushing primary/release branches without explicit user instruction
- Rewriting authorship or dates to disguise project history

## Optional repository hooks

Install the included checker as both a pre-commit and pre-push hook:

```bash
mkdir -p .git/hooks
ln -sf ../../scripts/verify-git-identity.sh .git/hooks/pre-commit
ln -sf ../../scripts/verify-git-identity.sh .git/hooks/pre-push
```

Because worktrees can have different Git directory layouts, verify hook paths in every worktree. A portable alternative is to configure a repository-local hooks directory:

```bash
git config --local core.hooksPath .githooks
```

Then commit wrapper hooks under `.githooks/` that call the script. Do not set a global hooks path.

## Commit verification after creation

```bash
git show -s --format=fuller HEAD
```

Both Author and Commit fields must use the personal identity. If a wrong identity was used, stop before push and correct only the affected unpublished commit through an intentional amend. Do not rewrite shared/pushed history casually.
