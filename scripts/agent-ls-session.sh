#!/bin/bash

SOCKET_DIR="$HOME/.local/share/claude"
SOCKET_PATH="$SOCKET_DIR/daemon.sock"

INPUT=$(cat)

if [ -z "$INPUT" ]; then
  exit 0
fi

if command -v jq &>/dev/null; then
  HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name' 2>/dev/null)
  SESSION_ID=$(echo "$INPUT" | jq -r '.session_id' 2>/dev/null)
  CWD=$(echo "$INPUT" | jq -r '.cwd' 2>/dev/null)
else
  HOOK_EVENT=$(echo "$INPUT" | grep -o '"hook_event_name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"hook_event_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
  SESSION_ID=$(echo "$INPUT" | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
  CWD=$(echo "$INPUT" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

get_tmux_info() {
  if [ -z "$TMUX" ]; then
    TMUX_SESSION=""
    TMUX_PANE=""
    TMUX_TARGET=""
    return
  fi

  TMUX_PANE="${TMUX_PANE:-}"
  TMUX_SESSION=$(echo "$TMUX" | cut -d',' -f1 | xargs basename 2>/dev/null)

  if [ -n "$TMUX_PANE" ]; then
    TMUX_TARGET=$(tmux display-message -p '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null || echo "$TMUX_PANE")
  else
    TMUX_TARGET=""
  fi
}

ensure_socket_dir() {
  if [ ! -d "$SOCKET_DIR" ]; then
    mkdir -p "$SOCKET_DIR"
  fi
}

send_to_daemon() {
  local msg="$1"
  ensure_socket_dir
  if command -v nc &>/dev/null; then
    echo "$msg" | nc -q 0 -U "$SOCKET_PATH" 2>/dev/null
  fi
}

handle_session_start() {
  get_tmux_info
  local msg=$(cat <<EOF
{"type":"REGISTER","payload":{"pid":$$,"cwd":"$CWD","status":"starting","session_id":"$SESSION_ID","tmux_session":"$TMUX_SESSION","tmux_pane":"$TMUX_PANE","tmux_target":"$TMUX_TARGET","started_at":$(date +%s)000}}
EOF
)
  send_to_daemon "$msg"
}

handle_stop() {
  local msg='{"type":"UPDATE","payload":{"pid":'"$$"',"status":"idle"}}'
  send_to_daemon "$msg"
}

handle_user_prompt_submit() {
  local msg='{"type":"UPDATE","payload":{"pid":'"$$"',"status":"running"}}'
  send_to_daemon "$msg"
}

handle_session_end() {
  local msg='{"type":"UNREGISTER","payload":{"pid":'"$$"'}}'
  send_to_daemon "$msg"
}

case "$HOOK_EVENT" in
  SessionStart)
    handle_session_start
    ;;
  Stop)
    handle_stop
    ;;
  UserPromptSubmit)
    handle_user_prompt_submit
    ;;
  SessionEnd)
    handle_session_end
    ;;
esac

exit 0
