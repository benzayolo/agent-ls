import { join } from "path"
import * as net from "net"
import type { Plugin } from "@opencode-ai/plugin"

const SOCKET_PATH = join(process.env.HOME!, ".local/share/opencode/daemon.sock")

interface InstanceInfo {
  pid: number
  cwd: string
  status: string
  tmux_session: string | null
  tmux_pane: string | null
  tmux_target: string | null
  started_at: number
}

function parseTmuxInfo(): { session: string | null; pane: string | null; target: string | null } {
  const tmuxEnv = process.env.TMUX
  if (!tmuxEnv) {
    return { session: null, pane: null, target: null }
  }

  const paneId = process.env.TMUX_PANE
  if (!paneId) {
    return { session: null, pane: null, target: null }
  }

  const parts = tmuxEnv.split(",")
  const sessionName = parts[0].split("/").pop() || null

  return {
    session: sessionName,
    pane: paneId,
    target: paneId,
  }
}

class DaemonConnection {
  private socket: net.Socket | null = null
  private connected = false

  async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.socket = net.connect(SOCKET_PATH)

        this.socket.on("connect", () => {
          this.connected = true
          resolve(true)
        })

        this.socket.on("error", () => {
          this.connected = false
          this.socket = null
          resolve(false)
        })

        this.socket.on("close", () => {
          this.connected = false
          this.socket = null
        })
      } catch {
        resolve(false)
      }
    })
  }

  async send(msg: object): Promise<void> {
    if (!this.socket || !this.connected) return
    this.socket.write(JSON.stringify(msg) + "\n")
  }

  isConnected(): boolean {
    return this.connected
  }
}

export const InstanceTracker: Plugin = async ({ directory, $ }) => {
  const pid = process.pid
  const tmuxInfo = parseTmuxInfo()

  let target = tmuxInfo.target
  if (tmuxInfo.pane) {
    try {
      const result =
        await $`tmux display-message -p '#{session_name}:#{window_index}.#{pane_index}'`.quiet()
      target = result.text().trim()
    } catch {
      target = tmuxInfo.pane
    }
  }

  const connection = new DaemonConnection()
  const connected = await connection.connect()

  if (!connected) {
    console.warn(
      "[instance-tracker] Warning: Could not connect to daemon, instance will not be tracked"
    )
  } else {
    const info: InstanceInfo = {
      pid,
      cwd: directory,
      status: "starting",
      tmux_session: tmuxInfo.session,
      tmux_pane: tmuxInfo.pane,
      tmux_target: target,
      started_at: Date.now(),
    }

    await connection.send({ type: "REGISTER", payload: info })
  }

  return {
    event: async ({ event }) => {
      if (!connection.isConnected()) return

      if (event.type === "session.status") {
        await connection.send({
          type: "UPDATE",
          payload: { pid, status: (event as any).status || "running" },
        })
      }

      if (event.type === "session.idle") {
        await connection.send({
          type: "UPDATE",
          payload: { pid, status: "idle" },
        })
      }
    },
  }
}

export default InstanceTracker
