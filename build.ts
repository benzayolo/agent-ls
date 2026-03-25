#!/usr/bin/env bun
import { readFileSync, writeFileSync, unlinkSync } from "fs"

const version = JSON.parse(readFileSync("package.json", "utf-8")).version
const pluginCode = readFileSync("instance-tracker.ts", "utf-8")

const tempFile = "plugin-code.ts"
writeFileSync(tempFile, `export const PLUGIN_CODE = ${JSON.stringify(pluginCode)};`)

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
unlinkSync(tempFile)
