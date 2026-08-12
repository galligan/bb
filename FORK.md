# gg Fork Workflow

This fork keeps `main` as an exact mirror of `get-bb/bb` and keeps fork-only
work on the long-lived `gg` branch.

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
- Upstream contribution: branch from `main` and open the PR against
  `get-bb/bb:main`. After it lands, sync `main` and merge upstream into `gg`.

Do not merge `gg` into `main`.
