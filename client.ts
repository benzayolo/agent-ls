import * as net from "net"
import { existsSync, mkdirSync } from "fs"
import { join } from "path"
import { spawn } from "child_process"
import { spawnDaemon, SOCKET_PATH } from "./daemon"

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

export class DaemonClient {
  private socket: net.Socket | null = null
  private buffer = ""

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!existsSync(SOCKET_PATH)) {
        spawnDaemon()
      }

      this.socket = net.connect(SOCKET_PATH)

      this.socket.on("connect", () => resolve())
      this.socket.on("error", (err) => {
        this.socket = null
        reject(err)
      })

      this.socket.on("data", (data) => {
        this.buffer += data.toString()
      })
    })
  }

  private async sendAndWait(msg: Message): Promise<Message> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Not connected"))
        return
      }

      const timeout = setTimeout(() => {
        reject(new Error("Timeout"))
      }, 5000)

      const checkResponse = () => {
        const lines = this.buffer.split("\n")
        this.buffer = lines.pop() || ""

        for (const line of lines) {
          if (line.trim()) {
            clearTimeout(timeout)
            try {
              resolve(JSON.parse(line))
            } catch {
              reject(new Error("Invalid JSON response"))
            }
            return
          }
        }

        this.socket?.once("data", checkResponse)
      }

      this.socket.write(JSON.stringify(msg) + "\n")
      checkResponse()
    })
  }

  async register(info: InstanceInfo): Promise<boolean> {
    try {
      const response = await this.sendAndWait({ type: "REGISTER", payload: info })
      return response.type === "REGISTERED" && response.payload?.success
    } catch {
      return false
    }
  }

  async updateStatus(pid: number, status: string): Promise<boolean> {
    try {
      const response = await this.sendAndWait({ type: "UPDATE", payload: { pid, status } })
      return response.type === "UPDATED" && response.payload?.success
    } catch {
      return false
    }
  }

  async list(): Promise<InstanceInfo[]> {
    try {
      const response = await this.sendAndWait({ type: "LIST" })
      if (response.type === "INSTANCES") {
        return response.payload as InstanceInfo[]
      }
      return []
    } catch {
      return []
    }
  }

  close(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
  }
}

export async function getInstances(): Promise<InstanceInfo[]> {
  const client = new DaemonClient()
  try {
    await client.connect()
    return await client.list()
  } catch {
    return []
  } finally {
    client.close()
  }
}

export type { InstanceInfo }
