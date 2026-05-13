# @happier-dev/visual-runner

Visual Runner is the experimental MCP runner package for AI-visible browser work in Happier.

Current package scope:

- starts an MCP stdio server with `happier-visual-runner mcp`
- exposes URL policy, text redaction, session metadata, navigation, click, type, inspect, console, network, screenshot, and trace tools
- launches an isolated Playwright Chromium context on first navigation
- writes PNG screenshot and Playwright trace ZIP artifacts under the session working directory
- prunes session artifacts with TTL and quota enforcement
- returns a localhost dashboard URL for browsing session artifacts

Happier MCP configuration:

```json
{
  "mcpServers": {
    "visual_runner": {
      "command": "npx",
      "args": ["-y", "@happier-dev/visual-runner@latest", "mcp"]
    }
  }
}
```

Run the real visual e2e test:

```sh
yarn playwright install chromium
yarn workspace @happier-dev/visual-runner test:e2e
```
