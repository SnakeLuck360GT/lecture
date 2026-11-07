#!/usr/bin/env bash
# Blocks every tool call while there is an unacknowledged team broadcast.
INPUT="$(cat)"
P="${CLAUDE_PROJECT_DIR:-$(pwd)}"
COMMS="$P/../$(basename "$P")-comms"
ACK_FILE="$P/.claude/broadcast_ack"
STAMP="$P/.claude/.broadcast_fetch"
case "$INPUT" in *broadcast_ack*) exit 0;; esac   # let the ack itself through
[ -d "$COMMS" ] || exit 0
now=$(date +%s); last=$(cat "$STAMP" 2>/dev/null || echo 0)
if [ $((now - last)) -ge 10 ]; then
  echo "$now" > "$STAMP"
  git -C "$COMMS" fetch -q origin main 2>/dev/null
fi
MSG="$(git -C "$COMMS" show origin/main:coord/BROADCAST.md 2>/dev/null)" || exit 0
ID=$(printf '%s\n' "$MSG" | sed -n 's/^id: *\([0-9][0-9]*\).*/\1/p' | head -1)
ACK=$(cat "$ACK_FILE" 2>/dev/null || echo 0)
{ [ -n "$ID" ] && [ "$ID" -gt "$ACK" ]; } 2>/dev/null || exit 0
{
  echo "🛑 TEAM BROADCAST #$ID: STOP what you are doing and read this."
  echo "$MSG"
  echo
  echo "MASTER AGENT: stop your subagents, run: echo $ID > .claude/broadcast_ack, post 'ack #$ID' in your coord file, then follow the broadcast."
  echo "SUBAGENT: do NOT ack. Stop now and return to your master with: HALTED by broadcast #$ID"
} >&2
exit 2
