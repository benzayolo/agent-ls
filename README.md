# ols

CLI tool for managing opencode instances.

## Install

Download the latest binary from GitHub Releases:

```bash
curl -LO https://github.com/anomalyco/ols/releases/latest/download/ols
chmod +x ols
mv ols ~/bin/
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
     --define="VERSION=\"\$VERSION\"" --outfile ols
   ```
3. Release: `gh release create v<version> ./ols --title "v<version>"`
