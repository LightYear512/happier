#!/bin/sh
set -eu

LOG_PATH="${YARN_INSTALL_LOG_PATH:-${TMPDIR:-/tmp}/yarn-install.log}"
MAX_ATTEMPTS="${YARN_INSTALL_MAX_ATTEMPTS:-3}"
SLEEP_SECONDS="${YARN_INSTALL_RETRY_SLEEP_SECONDS:-5}"
ATTEMPT_TIMEOUT_SECONDS="${YARN_INSTALL_ATTEMPT_TIMEOUT_SECONDS:-1800}"
DEFAULT_REGISTRY="${YARN_INSTALL_REGISTRY:-https://registry.npmjs.org}"

case "$ATTEMPT_TIMEOUT_SECONDS" in
    ''|*[!0-9]*)
        echo "YARN_INSTALL_ATTEMPT_TIMEOUT_SECONDS must be a non-negative integer (got: ${ATTEMPT_TIMEOUT_SECONDS})" >&2
        exit 1
        ;;
esac

is_transient_yarn_error() {
    log_path="$1"
    # Retry only when the failure is very likely transient (registry/network throttling).
    # Do not retry on lockfile/schema/package errors.
    grep -Eq 'Request failed "(5[0-9]{2}|429)' "$log_path" && return 0
    grep -Eq 'prebuild-install http (5[0-9]{2}|429) ' "$log_path" && return 0
    grep -Eq 'EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ESOCKETTIMEDOUT|socket hang up' "$log_path" && return 0
    grep -Eq 'trouble with your network connection' "$log_path" && return 0
    grep -Eq 'yarn install timed out after [0-9]+ seconds' "$log_path" && return 0
    return 1
}

configure_registry() {
    current_registry="${npm_config_registry:-}"
    if [ -z "$current_registry" ] || [ "$current_registry" = "https://registry.yarnpkg.com" ] || [ "$current_registry" = "https://registry.yarnpkg.com/" ]; then
        npm_config_registry="${DEFAULT_REGISTRY}"
    fi
    export npm_config_registry
    : "${NPM_CONFIG_REGISTRY:=${npm_config_registry}}"
    export NPM_CONFIG_REGISTRY
    yarn config set registry "${npm_config_registry%/}/" >/dev/null
}

run_yarn_install() {
    if [ "$ATTEMPT_TIMEOUT_SECONDS" -eq 0 ]; then
        yarn install "$@" >"$LOG_PATH" 2>&1
        return $?
    fi

    yarn install "$@" >"$LOG_PATH" 2>&1 &
    install_pid="$!"
    elapsed_seconds=0

    while kill -0 "$install_pid" 2>/dev/null; do
        if [ "$elapsed_seconds" -ge "$ATTEMPT_TIMEOUT_SECONDS" ]; then
            echo "yarn install timed out after ${ATTEMPT_TIMEOUT_SECONDS} seconds" >>"$LOG_PATH"
            kill "$install_pid" 2>/dev/null || true
            sleep 2
            kill -9 "$install_pid" 2>/dev/null || true
            wait "$install_pid" 2>/dev/null || true
            return 124
        fi
        sleep 1
        elapsed_seconds=$((elapsed_seconds + 1))
    done

    wait "$install_pid"
    return $?
}

clear_cache_after_transient_failure() {
    yarn cache clean >/dev/null 2>&1 || true
}

configure_registry

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
    if run_yarn_install "$@"; then
        rm -f "$LOG_PATH" || true
        exit 0
    fi

    if is_transient_yarn_error "$LOG_PATH"; then
        cat "$LOG_PATH" >&2
        if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
            clear_cache_after_transient_failure
            echo "yarn install failed due to transient network/registry issue (attempt ${attempt}/${MAX_ATTEMPTS}), retrying..." >&2
            sleep "$SLEEP_SECONDS"
            attempt=$((attempt + 1))
            continue
        fi
        echo "yarn install failed with repeated transient network/registry failures after ${attempt} attempts." >&2
        exit 1
    fi

    cat "$LOG_PATH" >&2
    echo "yarn install failed with a non-transient error (attempt ${attempt}); not retrying." >&2
    exit 1
done

echo "yarn install failed after ${MAX_ATTEMPTS} attempts." >&2
exit 1
