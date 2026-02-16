# Agent Chat Architecture

A web-based chat interface where users can have conversations with an LLM about the Vanilla Framework design system documentation. The agent explores the documentation the same way as the [pi agent skill](../packages/agent-skill/) — querying structured JSON data — but adapted for the browser.

## Overview

```
┌──────────────────────────────────────────────────────────────┐
│  @wiki/app (Astro)                                           │
│                                                              │
│  src/pages/chat.astro                                        │
│    - Standalone page (no BaseLayout, no Vanilla Framework)   │
│    - Imports createDesignSystemChat from @wiki/agent-chat    │
│    - Mounts ChatPanel into a <div>                           │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  @wiki/agent-chat (new package)                              │
│                                                              │
│  createDesignSystemChat(container)                           │
│    1. Sets up AppStorage (IndexedDB for keys + sessions)     │
│    2. Creates Agent with design system prompt                │
│    3. Configures JS REPL tool + DesignSystemRuntimeProvider  │
│    4. Mounts ChatPanel into container                        │
│    5. API keys handled by pi-web-ui's ApiKeyPromptDialog     │
└──────────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
┌────────────────────┐    ┌────────────────────────────────────┐
│  pi-web-ui         │    │  DesignSystemRuntimeProvider        │
│  - ChatPanel       │    │  (implements SandboxRuntimeProvider) │
│  - AppStorage      │    │                                    │
│  - JS REPL tool    │    │  getData():                        │
│  - ApiKeyPrompt    │    │    Injects JSON data onto window   │
│                    │    │                                    │
│                    │    │  getRuntime():                     │
│                    │    │    Exposes helper functions:        │
│                    │    │    - listComponents()              │
│                    │    │    - searchComponents(query)       │
│                    │    │    - getComponent(slug)            │
│                    │    │    - getComponentField(slug, field)│
│                    │    │                                    │
│                    │    │  getDescription():                 │
│                    │    │    Documents the API for the LLM   │
└────────────────────┘    └────────────────────────────────────┘
```

## Data flow

The agent skill for CLI tools uses `jq` and `bash` to query JSON files on disk. In the browser there is no `bash`. Instead, the agent uses the **JavaScript REPL** tool that is already built into pi-web-ui, with a custom **`SandboxRuntimeProvider`** that injects the design system data into the sandbox.

```
CLI skill workflow:              Browser workflow:
─────────────────────            ────────────────────────────────
LLM decides to query      →     LLM decides to query
  ↓                                ↓
Calls bash tool            →     Calls javascript_repl tool
  ↓                                ↓
Runs jq on JSON files      →     Runs JS on window.designSystem
  ↓                                ↓
Returns text output        →     Returns text output
  ↓                                ↓
LLM cites sources          →     LLM cites sources
```

### Data injection

The design system JSON data (`data/agent/`, ~372K total) is bundled into the `@wiki/agent-chat` package at build time via standard Vite JSON imports. At runtime, `DesignSystemRuntimeProvider.getData()` places it on `window.designSystem`:

```typescript
// Available in the JS REPL sandbox as window.designSystem
{
  index: { ... },           // data/agent/index.json
  components: {             // data/agent/components/*.json
    "button": { ... },
    "input": { ... },
    ...
  }
}
```

### Helper functions

`DesignSystemRuntimeProvider.getRuntime()` exposes convenience functions in the sandbox. These are documented in `getDescription()` so the LLM knows how to use them:

| Function | Description |
|---|---|
| `listComponents()` | Returns all components from the index (name, slug, type, tiers, description) |
| `searchComponents(query)` | Case-insensitive search across component names and descriptions |
| `getComponent(slug)` | Returns full component detail by slug |
| `getComponentField(slug, field)` | Returns a specific field (properties, anatomy, usage, etc.) |

The agent can also write arbitrary JavaScript against `window.designSystem` for ad-hoc queries that the helpers don't cover — just like the CLI skill uses arbitrary `jq` expressions.

## System prompt

The system prompt is adapted from the agent skill's [`SKILL.md`](../packages/agent-skill/src/SKILL.md). It keeps:

- **Citation rules** — every claim sourced from data, numbered references, never fabricate
- **Data structure documentation** — what fields exist on each component
- **Exploration workflow** — start with index, filter, drill into details

It changes:

- ~~"Use `jq` and `bash` to query JSON files"~~ → "Use the JavaScript REPL to query the design system data"
- ~~jq examples~~ → JavaScript equivalents using the helper functions
- ~~File paths~~ → Removed (data is on `window.designSystem`, not on disk)

## Package structure

```
packages/agent-chat/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                         # exports createDesignSystemChat()
│   ├── system-prompt.ts                 # adapted from SKILL.md
│   ├── design-system-runtime-provider.ts # SandboxRuntimeProvider implementation
│   └── data/                            # symlink → ../../data/agent/
│       ├── index.json
│       └── components/
│           ├── button.json
│           └── ... (49 component files)
```

### Dependencies

```json
{
  "name": "@wiki/agent-chat",
  "dependencies": {
    "@mariozechner/pi-web-ui": "...",
    "@mariozechner/pi-agent-core": "...",
    "@mariozechner/pi-ai": "..."
  }
}
```

### Exports

```typescript
// Single entry point
export async function createDesignSystemChat(container: HTMLElement): Promise<void>;
```

This function:

1. **Sets up storage** — `IndexedDB` backend with `SettingsStore`, `ProviderKeysStore`, `SessionsStore` for persisting API keys and chat sessions across page reloads
2. **Creates the Agent** — with the design system prompt, model defaults, and `convertToLlm` transformer
3. **Configures the JS REPL tool** — with `DesignSystemRuntimeProvider` attached via `runtimeProvidersFactory`
4. **Creates and mounts `ChatPanel`** — with `onApiKeyRequired` wired to `ApiKeyPromptDialog`

## Astro integration

A single standalone page with no shared layout:

```
packages/wiki/src/pages/chat.astro
```

```astro
---
// No layout — fully standalone page
---
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>Design System Chat</title>
  </head>
  <body>
    <div id="app"></div>
    <script>
      import { createDesignSystemChat } from '@wiki/agent-chat';
      createDesignSystemChat(document.getElementById('app')!);
    </script>
  </body>
</html>
```

- **No Vanilla Framework CSS** — only pi-web-ui's Tailwind styles load (imported inside `@wiki/agent-chat`)
- **No BaseLayout / sidebar** — the chat is the entire page
- **Vite handles bundling** — Astro processes the `<script>` tag, resolves the workspace package import, bundles the JS REPL, design system data, and pi-web-ui components
- **Route** — accessible at `/chat`

## API key management

API keys are managed entirely within the pi-web-ui layer:

- On first use, `ApiKeyPromptDialog` prompts the user for their API key
- Keys are stored in `IndexedDB` via `ProviderKeysStore`
- Keys persist across sessions/page reloads
- Users can manage keys through `SettingsDialog`
- No server-side API key handling

## Open questions

- **Link from wiki to chat** — Should there be a nav link on wiki pages to `/chat`? A floating button? Or just a known URL for now?
- **Pre-filled context** — Should navigating from a component page (e.g., `/button`) to chat pre-fill a question about that component?
- **Model defaults** — Which model/provider should be the default? (Currently set to Claude Sonnet in the example.)
