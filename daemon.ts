#!/usr/bin/env bun
import { unlinkSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import { spawn } from "child_process"
import * as net from "net"

export type AgentType = "opencode" | "claude"

export const SOCKET_PATHS: Record<AgentType, string> = {
  opencode: join(process.env.HOME!, ".local/share/opencode/daemon.sock"),
  claude: join(process.env.HOME!, ".local/share/claude/daemon.sock"),
}

const SOCKET_PATH = SOCKET_PATHS.opencode

export interface InstanceInfo {
  pid: number
  cwd: string
  status: string
  tmux_session: string | null
  tmux_pane: string | null
  tmux_target: string | null
  started_at: number
}

interface Message {
  type: string
  payload?: any
}

const registry = new Map<number, InstanceInfo>()
const clientPids = new Map<net.Socket, number>()

function handleMessage(socket: net.Socket, data: string): void {
  let msg: Message
  try {
    msg = JSON.parse(data)
  } catch {
    socket.write(JSON.stringify({ type: "ERROR", payload: { message: "Invalid JSON" } }) + "\n")
    return
  }

  switch (msg.type) {
    case "REGISTER": {
      const info: InstanceInfo = {
        pid: msg.payload.pid,
        cwd: msg.payload.cwd,
        status: msg.payload.status || "starting",
        tmux_session: msg.payload.tmux_session || null,
        tmux_pane: msg.payload.tmux_pane || null,
        tmux_target: msg.payload.tmux_target || null,
        started_at: msg.payload.started_at || Date.now(),
      }
      registry.set(info.pid, info)
      clientPids.set(socket, info.pid)
      socket.write(JSON.stringify({ type: "REGISTERED", payload: { success: true } }) + "\n")
      break
    }

    case "UPDATE": {
      const pid = msg.payload.pid
      const existing = registry.get(pid)
      if (existing) {
        existing.status = msg.payload.status || existing.status
        socket.write(JSON.stringify({ type: "UPDATED", payload: { success: true } }) + "\n")
      } else {
        socket.write(
          JSON.stringify({ type: "ERROR", payload: { message: "Instance not found" } }) + "\n"
        )
      }
      break
    }

    case "LIST": {
      const instances = Array.from(registry.values()).sort((a, b) => a.started_at - b.started_at)
      socket.write(JSON.stringify({ type: "INSTANCES", payload: instances }) + "\n")
      break
    }

    case "UNREGISTER": {
      const pid = msg.payload.pid
      if (registry.has(pid)) {
        registry.delete(pid)
        clientPids.delete(socket)
        socket.write(JSON.stringify({ type: "UNREGISTERED", payload: { success: true } }) + "\n")
      } else {
        socket.write(
          JSON.stringify({ type: "ERROR", payload: { message: "Instance not found" } }) + "\n"
        )
      }
      break
    }

    default:
      socket.write(
        JSON.stringify({
          type: "ERROR",
          payload: { message: `Unknown message type: ${msg.type}` },
        }) + "\n"
      )
  }
}

function handleDisconnect(socket: net.Socket): void {
  clientPids.delete(socket)
}

function isDaemonRunning(socketPath: string = SOCKET_PATH): boolean {
  if (!existsSync(socketPath)) {
    return false
  }

  try {
    const client = net.connect(socketPath)
    client.write(JSON.stringify({ type: "LIST" }) + "\n")
    client.destroy()
    return true
  } catch {
    return false
  }
}

export function startServer(agent: AgentType = "opencode"): void {
  const socketPath = SOCKET_PATHS[agent]
  const socketDir = join(socketPath, "..")

  if (!existsSync(socketDir)) {
    mkdirSync(socketDir, { recursive: true })
  }

  if (existsSync(socketPath)) {
    if (isDaemonRunning(socketPath)) {
      console.log("Daemon already running")
      process.exit(0)
    }
    unlinkSync(socketPath)
  }

  const server = net.createServer((socket) => {
    let buffer = ""

    socket.on("data", (data) => {
      buffer += data.toString()
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line.trim()) {
          handleMessage(socket, line)
        }
      }
    })

    socket.on("close", () => handleDisconnect(socket))
    socket.on("error", () => handleDisconnect(socket))
  })

  server.listen(socketPath, () => {
    console.log(`Daemon listening on ${socketPath}`)
  })

  process.on("SIGINT", () => {
    server.close()
    if (existsSync(socketPath)) {
      unlinkSync(socketPath)
    }
    process.exit(0)
  })

  process.on("SIGTERM", () => {
    server.close()
    if (existsSync(socketPath)) {
      unlinkSync(socketPath)
    }
    process.exit(0)
  })
}

export function spawnDaemon(agent: AgentType = "opencode"): void {
  const socketPath = SOCKET_PATHS[agent]
  if (isDaemonRunning(socketPath)) {
    return
  }

  const child = spawn(process.execPath, [import.meta.path, "--daemon", `--agent=${agent}`], {
    detached: true,
    stdio: "ignore",
  })
  child.unref()

  let attempts = 0
  while (!isDaemonRunning(socketPath) && attempts < 50) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    attempts++
  }
}

if (import.meta.main) {
  if (process.argv.includes("--daemon")) {
    const agentArg = process.argv.find((arg) => arg.startsWith("--agent="))
    const agent: AgentType = agentArg ? (agentArg.split("=")[1] as AgentType) : "opencode"
    startServer(agent)
  }
}

export { SOCKET_PATH, isDaemonRunning }
