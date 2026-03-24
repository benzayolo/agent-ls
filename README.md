# agent-ls

CLI tool for managing opencode instances.

## Install

Download the latest binary from GitHub Releases:

```bash
curl -LO https://github.com/anomalyco/agent-ls/releases/latest/download/agent-ls
chmod +x agent-ls
mv agent-ls ~/bin/
```

## Development

Install dependencies:

```bash
bun install
```

Run:

```bash
bun run index.ts
```

## Release

1. Bump version in `package.json`
2. Build:
   ```bash
   VERSION=$(jq -r .version package.json) \
     bun build index.ts --compile --target=bun-linux-x64 \
      --define="VERSION=\"\$VERSION\"" --outfile agent-ls
   ```
3. Release: `gh release create v<version> ./agent-ls --title "v<version>"`
