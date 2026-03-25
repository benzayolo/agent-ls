#!/usr/bin/env bun
import { unlinkSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import { spawn } from "child_process"
import * as net from "net"

const SOCKET_DIR = join(process.env.HOME!, ".local/share/opencode")
const SOCKET_PATH = join(SOCKET_DIR, "daemon.sock")

interface InstanceInfo {
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

function ensureSocketDir(): void {
  if (!existsSync(SOCKET_DIR)) {
    mkdirSync(SOCKET_DIR, { recursive: true })
  }
}

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
  const pid = clientPids.get(socket)
  if (pid !== undefined) {
    registry.delete(pid)
    clientPids.delete(socket)
  }
}

function isDaemonRunning(): boolean {
  if (!existsSync(SOCKET_PATH)) {
    return false
  }

  try {
    const client = net.connect(SOCKET_PATH)
    client.write(JSON.stringify({ type: "LIST" }) + "\n")
    client.destroy()
    return true
  } catch {
    return false
  }
}

export function startServer(): void {
  ensureSocketDir()

  if (existsSync(SOCKET_PATH)) {
    if (isDaemonRunning()) {
      console.log("Daemon already running")
      process.exit(0)
    }
    unlinkSync(SOCKET_PATH)
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

  server.listen(SOCKET_PATH, () => {
    console.log(`Daemon listening on ${SOCKET_PATH}`)
  })

  process.on("SIGINT", () => {
    server.close()
    if (existsSync(SOCKET_PATH)) {
      unlinkSync(SOCKET_PATH)
    }
    process.exit(0)
  })

  process.on("SIGTERM", () => {
    server.close()
    if (existsSync(SOCKET_PATH)) {
      unlinkSync(SOCKET_PATH)
    }
    process.exit(0)
  })
}

export function spawnDaemon(): void {
  if (isDaemonRunning()) {
    return
  }

  const child = spawn(process.execPath, ["--daemon"], {
    detached: true,
    stdio: "ignore",
  })
  child.unref()

  let attempts = 0
  while (!isDaemonRunning() && attempts < 50) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    attempts++
  }
}

export { SOCKET_PATH, isDaemonRunning }
