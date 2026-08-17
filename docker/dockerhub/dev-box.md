# happierdev/dev-box

Run Happier CLI + daemon inside a container, and pair it to your account without opening a browser.

The image contains the published `happier` CLI binary and runs as the non-root `happier` user. It does not include a Happier source checkout or `hstack`.

Quick start (preview):

```bash
docker run --rm -it happierdev/dev-box:preview
```

Recommended: persist `~/.happier` so credentials and machine state survive restarts:

```bash
docker run --rm -it \
  -v happier-home:/home/happier/.happier \
  happierdev/dev-box:preview
```

Optional: install provider CLIs on first boot via `happier install provider`:

```bash
docker run --rm -it \
  -e HAPPIER_PROVIDER_CLIS=claude,codex \
  happierdev/dev-box:preview
```

Optional: start the local Happier server when the container starts:

```bash
docker run --rm -it \
  -v /path/to/workspace:/workspace \
  -v happier-home:/home/happier/.happier \
  -e HAPPIER_DEV_BOX_AUTOSTART_SERVER=1 \
  happierdev/dev-box:preview
```

Docs:

- Dev Containers: https://docs.happier.dev/development/devcontainers
