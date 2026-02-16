import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import {
  ApiKeyPromptDialog,
  AppStorage,
  ChatPanel,
  IndexedDBStorageBackend,
  ProviderKeysStore,
  SessionsStore,
  SettingsStore,
  setAppStorage,
  defaultConvertToLlm,
  createJavaScriptReplTool,
} from "@mariozechner/pi-web-ui";
import "./app.css";
import { DesignSystemRuntimeProvider } from "./design-system-runtime-provider.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";

/**
 * Creates and mounts the design system chat interface into the given container.
 *
 * Sets up:
 * - IndexedDB storage for API keys and chat sessions
 * - Agent with design system system prompt
 * - JavaScript REPL tool with DesignSystemRuntimeProvider
 * - ChatPanel UI
 */
export async function createDesignSystemChat(
  container: HTMLElement
): Promise<void> {
  // --- Storage setup ---
  const settings = new SettingsStore();
  const providerKeys = new ProviderKeysStore();
  const sessions = new SessionsStore();

  const backend = new IndexedDBStorageBackend({
    dbName: "wiki-agent-chat",
    version: 1,
    stores: [
      settings.getConfig(),
      providerKeys.getConfig(),
      sessions.getConfig(),
      SessionsStore.getMetadataConfig(),
    ],
  });

  settings.setBackend(backend);
  providerKeys.setBackend(backend);
  sessions.setBackend(backend);

  const storage = new AppStorage(
    settings,
    providerKeys,
    sessions,
    undefined,
    backend
  );
  setAppStorage(storage);

  // --- Agent setup ---
  const designSystemProvider = new DesignSystemRuntimeProvider();

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: getModel("anthropic", "claude-sonnet-4-5-20250929"),
      thinkingLevel: "off",
      messages: [],
      tools: [],
    },
    convertToLlm: defaultConvertToLlm,
  });

  // --- UI setup ---
  const chatPanel = new ChatPanel();
  await chatPanel.setAgent(agent, {
    onApiKeyRequired: async (provider: string) => {
      return await ApiKeyPromptDialog.prompt(provider);
    },
    toolsFactory: (
      _agent,
      _agentInterface,
      _artifactsPanel,
      _runtimeProvidersFactory
    ) => {
      const replTool = createJavaScriptReplTool();
      replTool.runtimeProvidersFactory = () => [designSystemProvider];
      return [replTool];
    },
  });

  container.appendChild(chatPanel);
}
