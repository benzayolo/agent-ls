import * as net from "net"
import { existsSync } from "fs"
import { spawnDaemon, SOCKET_PATHS } from "./daemon"
import type { AgentType, InstanceInfo as DaemonInstanceInfo } from "./daemon"

interface InstanceInfo extends DaemonInstanceInfo {
  agent: AgentType
}

interface Message {
  type: string
  payload?: any
}

export class DaemonClient {
  private socket: net.Socket | null = null
  private buffer = ""
  private socketPath: string
  private agent: AgentType

  constructor(agent: AgentType = "opencode") {
    this.agent = agent
    this.socketPath = SOCKET_PATHS[agent]
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!existsSync(this.socketPath)) {
        spawnDaemon(this.agent)
      }

      this.socket = net.connect(this.socketPath)

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

  async register(info: DaemonInstanceInfo): Promise<boolean> {
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

  async unregister(pid: number): Promise<boolean> {
    try {
      const response = await this.sendAndWait({ type: "UNREGISTER", payload: { pid } })
      return response.type === "UNREGISTERED" && response.payload?.success
    } catch {
      return false
    }
  }

  async list(): Promise<DaemonInstanceInfo[]> {
    try {
      const response = await this.sendAndWait({ type: "LIST" })
      if (response.type === "INSTANCES") {
        return response.payload as DaemonInstanceInfo[]
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

export async function getInstances(agent: AgentType = "opencode"): Promise<InstanceInfo[]> {
  const client = new DaemonClient(agent)
  try {
    await client.connect()
    const instances = await client.list()
    return instances.map((inst) => ({ ...inst, agent }))
  } catch {
    return []
  } finally {
    client.close()
  }
}

export async function getAllInstances(
  agents: AgentType[] = ["opencode", "claude"]
): Promise<InstanceInfo[]> {
  const allInstances: InstanceInfo[] = []

  for (const agent of agents) {
    const instances = await getInstances(agent)
    allInstances.push(...instances)
  }

  return allInstances.sort((a, b) => a.started_at - b.started_at)
}

export type { InstanceInfo }
