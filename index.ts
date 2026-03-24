#!/usr/bin/env bun
import { $ } from "bun"
import { getInstances, type InstanceInfo } from "./client"

declare const VERSION: string | undefined

function displayTable(instances: InstanceInfo[]): void {
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

function displayJson(instances: InstanceInfo[]): void {
  console.log(JSON.stringify(instances, null, 2))
}

async function switchPane(instance: InstanceInfo): Promise<void> {
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

async function attachSession(instance: InstanceInfo): Promise<void> {
  if (!instance.tmux_session) {
    console.error("Instance not running in tmux")
    process.exit(1)
  }

  await $`tmux attach-session -t ${instance.tmux_session}`
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION ?? "dev")
    return
  }

  if (args.includes("--json")) {
    const instances = await getInstances()
    displayJson(instances)
    return
  }

  if (args[0] === "switch" && args[1]) {
    const n = parseInt(args[1], 10)
    if (isNaN(n)) {
      console.error("Usage: agent-ls switch <n>")
      process.exit(1)
    }
    const instances = await getInstances()
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
      console.error("Usage: agent-ls attach <n>")
      process.exit(1)
    }
    const instances = await getInstances()
    const instance = instances[n - 1]
    if (!instance) {
      console.error(`Invalid instance number: ${n}`)
      process.exit(1)
    }
    await attachSession(instance)
    return
  }

  const instances = await getInstances()
  displayTable(instances)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
