# Working together

`main` always works: tests pass and the app starts. Nobody pushes to it directly. All work goes through a branch and
a Pull Request (PR), reviewed by the other person.

## One change, one branch

```bash
git switch main && git pull
git switch -c backend/gemini-timeouts      # prefix: backend/, frontend/, docs/ or fix/
# ...work, then:
git add -A && git commit -m "Short imperative summary"
git push -u origin backend/gemini-timeouts
```

Open a PR on GitHub into `main`. Keep it small and about one thing.

## Pull Request rules

1. Describe what changed and why, and how you checked it. Say plainly what you did not check (for example "not tried with a real API key").
2. Backend PRs: `pytest` passes. Frontend PRs: `typecheck`, `lint`, `test` and `build` pass.
3. The other person reviews and approves, then the author merges with "Squash and merge".
4. After merging, delete the branch and update your `main`.

## Who edits what

Backend work stays in `backend/`, frontend work in `frontend/`, so you rarely touch the same files.
A change to `backend/docs/api-contract.md` is the exception: it changes both sides, so it goes in its own PR, both of
you approve it, and the code PRs that depend on it come after.

## Keeping up with `main`

```bash
git switch your-branch
git fetch origin
git rebase origin/main      # or: git merge origin/main
```

If there are conflicts, fix the files Git lists, `git add` them, then `git rebase --continue`.
Never force-push a branch someone else also uses. Force-pushing your own unmerged branch after a rebase is fine,
and `git push --force-with-lease` is the safe form.

## Never commit

`.env` files, API keys, `backend/data/`, `node_modules`, `.venv`. If `git status` lists any of them, stop and check `.gitignore`.
