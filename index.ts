#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs"
import { join } from "path"
import { $ } from "bun"
import { getInstances, getAllInstances, type InstanceInfo } from "./client"
import { startServer, type AgentType } from "./daemon"
import { configExists, loadConfig, saveConfig, getConfigPath, type Config } from "./config"

declare const VERSION: string | undefined

const PLUGIN_DIR = join(process.env.HOME!, ".config/opencode/plugins")
const PLUGIN_PATH = join(PLUGIN_DIR, "instance-tracker.ts")
const CLAUDE_SETTINGS_DIR = join(process.env.HOME!, ".claude")
const CLAUDE_SETTINGS_PATH = join(CLAUDE_SETTINGS_DIR, "settings.json")

async function getPluginCode(): Promise<string> {
  try {
    const { PLUGIN_CODE } = await import("./plugin-code")
    return PLUGIN_CODE
  } catch {
    return Bun.file(join(import.meta.dir, "instance-tracker.ts")).text()
  }
}

const PLUGIN_CODE = await getPluginCode()

if (process.argv.includes("--daemon")) {
  const agentArg = process.argv.find((arg) => arg.startsWith("--agent="))
  const agent: AgentType = agentArg ? (agentArg.split("=")[1] as AgentType) : "opencode"
  startServer(agent)
}

function ensurePlugin(): void {
  try {
    if (existsSync(PLUGIN_PATH)) {
      const existing = readFileSync(PLUGIN_PATH, "utf-8")
      if (existing === PLUGIN_CODE) {
        return
      }
    }

    if (!existsSync(PLUGIN_DIR)) {
      mkdirSync(PLUGIN_DIR, { recursive: true })
    }
    writeFileSync(PLUGIN_PATH, PLUGIN_CODE)
  } catch (err) {
    console.warn(`Warning: Could not install plugin: ${(err as Error).message}`)
  }
}

async function getShellHookScript(): Promise<string> {
  try {
    const { SHELL_HOOK_SCRIPT } = await import("./shell-hook-script")
    return SHELL_HOOK_SCRIPT
  } catch {
    return Bun.file(join(import.meta.dir, "scripts/agent-ls-session.sh")).text()
  }
}

const SHELL_HOOK_SCRIPT = await getShellHookScript()

async function promptAgentSelection(): Promise<AgentType[]> {
  console.log("\nagent-ls setup")
  console.log("Which agents do you want to track?\n")
  console.log("  1. opencode only")
  console.log("  2. claude only")
  console.log("  3. both\n")

  const choice = await new Promise<string>((resolve) => {
    process.stdout.write("Enter choice [1-3]: ")
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim())
    })
  })

  switch (choice) {
    case "1":
      return ["opencode"]
    case "2":
      return ["claude"]
    case "3":
      return ["opencode", "claude"]
    default:
      console.log("Invalid choice, defaulting to opencode only")
      return ["opencode"]
  }
}

function installOpencodeTracking(): void {
  try {
    if (!existsSync(PLUGIN_DIR)) {
      mkdirSync(PLUGIN_DIR, { recursive: true })
    }
    writeFileSync(PLUGIN_PATH, PLUGIN_CODE)
    console.log("  ✓ opencode plugin installed")
  } catch (err) {
    console.warn(`  ✗ Could not install opencode plugin: ${(err as Error).message}`)
  }
}

async function installClaudeTracking(): Promise<void> {
  try {
    const hooksDir = join(process.env.HOME!, ".claude/hooks")
    const hookScriptPath = join(hooksDir, "agent-ls-session.sh")

    if (!existsSync(hooksDir)) {
      mkdirSync(hooksDir, { recursive: true })
    }
    writeFileSync(hookScriptPath, SHELL_HOOK_SCRIPT)
    chmodSync(hookScriptPath, 0o755)

    let settings: any = {}
    if (existsSync(CLAUDE_SETTINGS_PATH)) {
      try {
        settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8"))
      } catch {
        settings = {}
      }
    }

    if (!existsSync(CLAUDE_SETTINGS_DIR)) {
      mkdirSync(CLAUDE_SETTINGS_DIR, { recursive: true })
    }

    const hookCommand = `bash ${hookScriptPath}`
    settings.hooks = settings.hooks || {}

    const addHook = (event: string, command: string) => {
      if (!Array.isArray(settings.hooks[event])) {
        settings.hooks[event] = []
      }
      const exists = settings.hooks[event].some((entry: any) =>
        entry.hooks?.some((h: any) => h.command === command)
      )
      if (!exists) {
        settings.hooks[event].push({
          hooks: [{ type: "command", command }],
        })
      }
    }

    addHook("SessionStart", hookCommand)
    addHook("Stop", hookCommand)
    addHook("UserPromptSubmit", hookCommand)
    addHook("SessionEnd", hookCommand)

    writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2))
    console.log("  ✓ claude hooks installed")
  } catch (err) {
    console.warn(`  ✗ Could not install claude hooks: ${(err as Error).message}`)
  }
}

async function runSetupWizard(): Promise<Config> {
  const agents = await promptAgentSelection()
  const config: Config = { agents }
  saveConfig(config)

  console.log("\nInstalling tracking...\n")

  if (agents.includes("opencode")) {
    installOpencodeTracking()
  }

  if (agents.includes("claude")) {
    await installClaudeTracking()
  }

  console.log(`\nConfig saved to ${getConfigPath()}`)
  return config
}

function displayTable(instances: InstanceInfo[]): void {
  if (instances.length === 0) {
    console.log("No instances running")
    return
  }

  const headers = ["#", "PID", "STATUS", "DIR", "TMUX", "AGENT"]
  const rows: string[][] = instances.map((inst, i) => [
    String(i + 1),
    String(inst.pid),
    inst.status,
    inst.cwd.replace(process.env.HOME!, "~"),
    inst.tmux_target || inst.tmux_pane || "-",
    inst.agent,
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

  if (args[0] === "setup") {
    await runSetupWizard()
    return
  }

  let config = loadConfig()
  if (!config) {
    console.log("First run detected. Starting setup wizard...\n")
    config = await runSetupWizard()
  }

  if (config.agents.includes("opencode")) {
    ensurePlugin()
  }

  if (args.includes("--json")) {
    const instances = await getAllInstances(config.agents)
    displayJson(instances)
    return
  }

  if (args[0] === "switch" && args[1]) {
    const n = parseInt(args[1], 10)
    if (isNaN(n)) {
      console.error("Usage: agent-ls switch <n>")
      process.exit(1)
    }
    const instances = await getAllInstances(config.agents)
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
    const instances = await getAllInstances(config.agents)
    const instance = instances[n - 1]
    if (!instance) {
      console.error(`Invalid instance number: ${n}`)
      process.exit(1)
    }
    await attachSession(instance)
    return
  }

  const instances = await getAllInstances(config.agents)
  displayTable(instances)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
