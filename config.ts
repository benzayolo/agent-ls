import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import type { AgentType } from "./daemon"

export interface Config {
  agents: AgentType[]
}

const CONFIG_DIR = join(process.env.HOME!, ".config/agent-ls")
const CONFIG_PATH = join(CONFIG_DIR, "config.json")

export function getConfigPath(): string {
  return CONFIG_PATH
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH)
}

export function loadConfig(): Config | null {
  if (!existsSync(CONFIG_PATH)) {
    return null
  }
  try {
    const content = readFileSync(CONFIG_PATH, "utf-8")
    return JSON.parse(content) as Config
  } catch {
    return null
  }
}

export function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

export function getDefaultConfig(): Config {
  return { agents: ["opencode"] }
}
