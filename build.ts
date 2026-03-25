#!/usr/bin/env bun
import { readFileSync, writeFileSync, unlinkSync } from "fs"

const version = JSON.parse(readFileSync("package.json", "utf-8")).version
const pluginCode = readFileSync("instance-tracker.ts", "utf-8")
const shellHookScript = readFileSync("scripts/agent-ls-session.sh", "utf-8")

const tempPluginFile = "plugin-code.ts"
const tempShellHookFile = "shell-hook-script.ts"

writeFileSync(tempPluginFile, `export const PLUGIN_CODE = ${JSON.stringify(pluginCode)};`)
writeFileSync(
  tempShellHookFile,
  `export const SHELL_HOOK_SCRIPT = ${JSON.stringify(shellHookScript)};`
)

const proc = Bun.spawn([
  "bun",
  "build",
  "index.ts",
  "--compile",
  "--target=bun-linux-x64",
  `--define=VERSION="${version}"`,
  "--outfile=agent-ls",
])

await proc.exited
unlinkSync(tempPluginFile)
unlinkSync(tempShellHookFile)
