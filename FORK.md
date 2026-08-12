# gg Fork Workflow

This fork keeps `main` as an exact mirror of `get-bb/bb` and keeps fork-only
work on the long-lived `gg` branch.

Root `AGENTS.md` points agents here. Codex/ChatGPT reads `AGENTS.md` directly;
Claude reads it through the repository's `CLAUDE.md` pointer. Keep shared fork
workflow guidance provider-neutral in `AGENTS.md` or this document rather than
duplicating it across harness-specific files.

## Run gg beside bb

Install the local command once:

```sh
scripts/gg-install
```

Then use `gg start`, `gg stop`, and ordinary bb CLI commands such as
`gg thread list`. The wrapper builds the current checkout before running it.

The profile is isolated from bb by default:

- data: `~/.gg`
- server: `127.0.0.1:48886`
- host daemon: `127.0.0.1:48887`

Override those values with `GG_DATA_DIR`, `GG_SERVER_PORT`, and
`GG_HOST_DAEMON_PORT`.

### Build the GG desktop app

```sh
pnpm gg:desktop:package
```

The packaged app is written to `apps/desktop/release/mac-arm64/GG.app`. It has
its own macOS bundle identity (`dev.outfitter.gg`), Electron user-data directory,
`~/.gg` runtime data, ports `48886`/`48887`, and fork-owned `desktop-gg` update
feed, so it can run beside the published BB app without sharing state.

## Bring in upstream changes

```sh
git switch gg
scripts/gg-sync-main
scripts/gg-merge-upstream
git push origin gg
```

The first script only fast-forwards the local and fork copies of `main` to
`upstream/main`; it refuses divergent history instead of rewriting it. The
second merges `upstream/main` into `gg`, where conflicts can be resolved without
polluting `main`.

## Choose a branch base

- Fork-only work: branch from `gg`, then merge back into `gg`.
- Upstream contribution: use a contribution worktree created from
  `upstream/main`, then open the PR against `get-bb/bb:main`.

Do not merge `gg` into `main`.

## Upstream contribution worktrees

Create or reuse a named worktree slot:

```sh
scripts/gg-worktree setup contrib-1
scripts/gg-worktree setup contrib-1 fix/example-upstream-change
cd ../worktrees/upstream/contrib-1
```

Each slot starts from `upstream/main`, installs its own dependencies, and gets
fork-local Claude/Codex setup plus a pre-push contamination check. Those local
files are excluded from Git and cannot enter the contribution.

Before pushing, inspect the exact contribution:

```sh
scripts/gg-contribute-check
git push --set-upstream origin HEAD
```

After the branch is clean and pushed, park the worktree for reuse:

```sh
cd /path/to/bb
scripts/gg-worktree teardown contrib-1
```

`teardown` stops that worktree's dev processes and detaches it at the latest
`upstream/main`. It preserves the worktree and its dependencies. Use
`scripts/gg-worktree remove contrib-1` only when the parked slot is no longer
wanted.

## Agent lifecycle configuration

`biner.toml` is canonical for Claude and Codex setup/cleanup wiring. Regenerate
and verify the native files with:

```sh
pnpm gg:biner:apply
pnpm gg:biner:check
```

Setup verifies Node and pnpm, installs the frozen dependency graph, and prints
the worktree identity. Cleanup is conservative: it stops linked-worktree dev
processes but does not delete source, branches, dependencies, or unpushed work.
