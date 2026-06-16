#!/bin/sh
set -eu

providers_raw="${HAPPIER_PROVIDER_CLIS:-}"
providers="$(printf "%s" "$providers_raw" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"

if [ -n "$providers" ]; then
  if command -v hstack >/dev/null 2>&1; then
    echo "[dev-box] Installing provider CLIs via hstack: $providers"
    hstack providers install --providers="$providers" >/dev/null
  else
    # Fallback for older images: keep minimal install logic here.
    # (Prefer using hstack so the install recipes stay centralized.)
    echo "[dev-box] Warning: hstack not found; falling back to legacy provider install logic." >&2
    old_ifs="$IFS"
    IFS=","
    for p in $providers; do
      case "$p" in
        "" )
          ;;
        "claude" )
          if command -v claude >/dev/null 2>&1; then
            continue
          fi
          echo "[dev-box] Installing Claude Code CLI (native installer)..."
          curl -fsSL https://claude.ai/install.sh | bash
          ;;
        "codex" )
          if command -v codex >/dev/null 2>&1; then
            continue
          fi
          echo "[dev-box] Installing OpenAI Codex CLI (@openai/codex)..."
          npm install -g @openai/codex
          ;;
        "gemini" )
          if command -v gemini >/dev/null 2>&1; then
            continue
          fi
          echo "[dev-box] Installing Google Gemini CLI (@google/gemini-cli)..."
          npm install -g @google/gemini-cli
          ;;
        * )
          echo "[dev-box] Unknown provider CLI: $p" >&2
          return 1
          ;;
      esac
    done
    IFS="$old_ifs"
  fi
fi

autostart_server="$(printf "%s" "${HAPPIER_DEV_BOX_AUTOSTART_SERVER:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
case "$autostart_server" in
  1|true|yes|on)
    if ! command -v hstack >/dev/null 2>&1; then
      echo "[dev-box] Cannot autostart server: hstack not found." >&2
      exit 1
    fi

    server_workspace="${HAPPIER_DEV_BOX_WORKSPACE:-/workspace/happier}"
    if [ ! -d "$server_workspace" ]; then
      echo "[dev-box] Cannot autostart server: workspace not found: $server_workspace" >&2
      exit 1
    fi

    HAPPIER_STACK_SERVER_PORT="${HAPPIER_STACK_SERVER_PORT:-4101}"
    HAPPIER_SERVER_URL="${HAPPIER_SERVER_URL:-http://127.0.0.1:${HAPPIER_STACK_SERVER_PORT}}"
    export HAPPIER_STACK_SERVER_PORT HAPPIER_SERVER_URL

    server_flavor="${HAPPIER_DEV_BOX_SERVER_FLAVOR:-light}"
    server_bind="${HAPPIER_DEV_BOX_SERVER_BIND:-loopback}"

    echo "[dev-box] Starting Happier server in $server_workspace at $HAPPIER_SERVER_URL"
    (
      cd "$server_workspace"
      hstack start --server-flavor="$server_flavor" --bind="$server_bind" --restart
    ) &
    ;;
esac

exec "$@"
