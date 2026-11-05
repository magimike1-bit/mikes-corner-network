#!/bin/sh
# Run before every planprice sevalla-deploy.sh invocation; a nonzero exit blocks the deploy.
#
# Runs the checked-date audit (tools/audit-literals.py) against the tree
# being deployed. Any argument is forwarded to the audit (e.g. --today).
# The exit code is the audit's exit code: 0 = clean, 1 = findings,
# 2 = audit could not run.

set -eu
TOOLS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$TOOLS_DIR/audit-literals.py" --root "$TOOLS_DIR/.." "$@"
