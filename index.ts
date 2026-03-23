#!/usr/bin/env bun
import { readdirSync, existsSync, unlinkSync, readFileSync } from "fs"
import { join } from "path"
import { $ } from "bun"

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

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function discoverInstances(): InstanceState[] {
  if (!existsSync(INSTANCES_DIR)) {
    return []
  }

  const files = readdirSync(INSTANCES_DIR).filter((f) => f.endsWith(".json"))
  const instances: InstanceState[] = []

  for (const file of files) {
    const pid = parseInt(file.replace(".json", ""), 10)

    if (!isProcessRunning(pid)) {
      unlinkSync(join(INSTANCES_DIR, file))
      continue
    }

    try {
      const content = readFileSync(join(INSTANCES_DIR, file), "utf-8")
      instances.push(JSON.parse(content) as InstanceState)
    } catch {
      // Invalid JSON, skip
    }
  }

  return instances.sort((a, b) => a.started_at - b.started_at)
}

function displayTable(instances: InstanceState[]): void {
  if (instances.length === 0) {
    console.log("No opencode instances running")
    return
  }

  const headers = ["#", "PID", "STATUS", "DIR", "TMUX"]
  const rows: string[][] = instances.map((inst, i) => [
    String(i + 1),
    String(inst.pid),
    inst.status,
    inst.cwd.replace(process.env.HOME!, "~"),
    inst.tmux_target || inst.tmux_pane || "-",
  ])

  const colWidths = headers.map((h, i) => {
    const maxRowLen = Math.max(...rows.map((r) => r[i]?.length ?? 0))
    return Math.max(h.length, maxRowLen)
  })

  const formatRow = (row: string[]) => row.map((cell, i) => cell.padEnd(colWidths[i]!)).join("  ")

  console.log(formatRow(headers))
  console.log(headers.map((_, i) => "-".repeat(colWidths[i]!)).join("  "))
  rows.forEach((row) => console.log(formatRow(row)))
}

function displayJson(instances: InstanceState[]): void {
  console.log(JSON.stringify(instances, null, 2))
}

async function switchPane(instance: InstanceState): Promise<void> {
  const target = instance.tmux_target || instance.tmux_pane
  if (!target) {
    console.error("Instance not running in tmux")
    process.exit(1)
  }

  if (target.includes(":") && target.includes(".")) {
    const [sessionWindow, paneIndex] = target.split(".")
    if (!sessionWindow || paneIndex === undefined) {
      console.error("Invalid tmux target format")
      process.exit(1)
    }
    const [session] = sessionWindow.split(":")

    const currentSession = (await $`tmux display-message -p #{session_name}`.quiet()).text().trim()

    if (session && session !== currentSession) {
      await $`tmux switch-client -t ${session}`
    }
    await $`tmux select-window -t ${sessionWindow}`
    await $`tmux select-pane -t ${paneIndex}`
  } else {
    await $`tmux select-pane -t ${target}`
  }
}

async function attachSession(instance: InstanceState): Promise<void> {
  if (!instance.tmux_session) {
    console.error("Instance not running in tmux")
    process.exit(1)
  }

  await $`tmux attach-session -t ${instance.tmux_session}`
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes("--json")) {
    const instances = discoverInstances()
    displayJson(instances)
    return
  }

  if (args[0] === "switch" && args[1]) {
    const n = parseInt(args[1], 10)
    if (isNaN(n)) {
      console.error("Usage: ols switch <n>")
      process.exit(1)
    }
    const instances = discoverInstances()
    const instance = instances[n - 1]
    if (!instance) {
      console.error(`Invalid instance number: ${n}`)
      process.exit(1)
    }
    await switchPane(instance)
    return
  }

  if (args[0] === "attach" && args[1]) {
    const n = parseInt(args[1], 10)
    if (isNaN(n)) {
      console.error("Usage: ols attach <n>")
      process.exit(1)
    }
    const instances = discoverInstances()
    const instance = instances[n - 1]
    if (!instance) {
      console.error(`Invalid instance number: ${n}`)
      process.exit(1)
    }
    await attachSession(instance)
    return
  }

  const instances = discoverInstances()
  displayTable(instances)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
