import { existsSync } from "fs"
import { mkdir, readFile, writeFile, unlink } from "fs/promises"
import { join } from "path"
import type { Plugin } from "@opencode-ai/plugin"

const INSTANCES_DIR = join(process.env.HOME!, ".local/share/opencode/instances")

interface InstanceState {
  pid: number
  cwd: string
  status: string
  tmux_session: string | null
  tmux_pane: string | null
  tmux_target: string | null
  started_at: number
}

function getStateFilePath(pid: number): string {
  return join(INSTANCES_DIR, `${pid}.json`)
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

async function ensureInstancesDir(): Promise<void> {
  if (!existsSync(INSTANCES_DIR)) {
    await mkdir(INSTANCES_DIR, { recursive: true })
  }
}

async function writeState(state: InstanceState): Promise<void> {
  await ensureInstancesDir()
  const filePath = getStateFilePath(state.pid)
  await writeFile(filePath, JSON.stringify(state, null, 2))
}

async function readState(pid: number): Promise<InstanceState | null> {
  const filePath = getStateFilePath(pid)
  if (!existsSync(filePath)) {
    return null
  }
  const content = await readFile(filePath, "utf-8")
  return JSON.parse(content) as InstanceState
}

async function removeState(pid: number): Promise<void> {
  const filePath = getStateFilePath(pid)
  if (existsSync(filePath)) {
    await unlink(filePath)
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

  const initialState: InstanceState = {
    pid,
    cwd: directory,
    status: "starting",
    tmux_session: tmuxInfo.session,
    tmux_pane: tmuxInfo.pane,
    tmux_target: target,
    started_at: Date.now(),
  }

  await writeState(initialState)

  process.on("exit", () => {
    removeState(pid).catch(() => {})
  })

  process.on("SIGINT", () => {
    removeState(pid).catch(() => {})
    process.exit(0)
  })

  process.on("SIGTERM", () => {
    removeState(pid).catch(() => {})
    process.exit(0)
  })

  return {
    event: async ({ event }) => {
      if (event.type === "session.status") {
        const state = await readState(pid)
        if (state) {
          state.status = (event as any).status || "running"
          await writeState(state)
        }
      }

      if (event.type === "session.idle") {
        const state = await readState(pid)
        if (state) {
          state.status = "idle"
          await writeState(state)
        }
      }
    },
  }
}

export default InstanceTracker
