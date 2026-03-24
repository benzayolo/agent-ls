#!/usr/bin/env bun
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "fs"
import { join } from "path"
import { $ } from "bun"

const PLUGIN_SOURCE = join(import.meta.dir, "instance-tracker.ts")
const PLUGIN_TARGET = join(process.env.HOME!, ".config/opencode/plugins/instance-tracker.ts")
const CONFIG_DIR = join(process.env.HOME!, ".config/opencode")
const CONFIG_PACKAGE = join(CONFIG_DIR, "package.json")

async function prompt(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(message)
    process.stdin.once("data", (data) => {
      const answer = data.toString().trim().toLowerCase()
      resolve(answer === "y" || answer === "yes")
    })
  })
}

async function ensureConfigDir(): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
  const pluginsDir = join(CONFIG_DIR, "plugins")
  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true })
  }
}

async function ensurePluginDependency(): Promise<void> {
  if (!existsSync(CONFIG_PACKAGE)) {
    writeFileSync(
      CONFIG_PACKAGE,
      JSON.stringify(
        {
          dependencies: {
            "@opencode-ai/plugin": "1.3.0",
          },
        },
        null,
        2
      )
    )
  }
  try {
    await $`cd ${CONFIG_DIR} && bun install --silent`
  } catch {
    // Ignore install errors
  }
}

async function main(): Promise<void> {
  console.log("\nols setup\n")

  if (existsSync(PLUGIN_TARGET)) {
    const overwrite = await prompt("Plugin already installed. Overwrite? (y/n): ")
    if (!overwrite) {
      console.log("Skipping plugin installation.")
      return
    }
  }

  const confirmed = await prompt("Install opencode plugin to ~/.config/opencode/plugins/? (y/n): ")
  if (!confirmed) {
    console.log("Setup cancelled.")
    return
  }

  await ensureConfigDir()
  await ensurePluginDependency()
  copyFileSync(PLUGIN_SOURCE, PLUGIN_TARGET)

  console.log("Plugin installed to ~/.config/opencode/plugins/instance-tracker.ts")
  console.log("\nSetup complete!")
  console.log(
    "Run 'ols' to list instances, 'ols switch <n>' or 'ols attach <n>' for tmux commands."
  )
  console.log("Restart opencode instances for the plugin to take effect.")
}

main().catch((err) => {
  console.error("Setup failed:", err.message)
  process.exit(1)
})
