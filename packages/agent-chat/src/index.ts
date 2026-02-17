import { Agent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import {
  type AgentState,
  ApiKeyPromptDialog,
  AppStorage,
  ChatPanel,
  IndexedDBStorageBackend,
  ProviderKeysStore,
  ProxyTab,
  SessionListDialog,
  SessionsStore,
  SettingsDialog,
  SettingsStore,
  setAppStorage,
  defaultConvertToLlm,
  createJavaScriptReplTool,
  ApiKeysTab,
} from "@mariozechner/pi-web-ui";
import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import { History, Plus, Settings } from "lucide";
import { html, render } from "lit";
import "./app.css";
import { DesignSystemRuntimeProvider } from "./design-system-runtime-provider.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";

/**
 * Creates and mounts the design system chat interface into the given container.
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

  // --- State ---
  const designSystemProvider = new DesignSystemRuntimeProvider();
  let currentSessionId: string | undefined;
  let currentTitle = "";
  let agent: Agent;
  let chatPanel: ChatPanel;
  let agentUnsubscribe: (() => void) | undefined;

  // --- Helpers ---
  const generateTitle = (messages: AgentMessage[]): string => {
    const firstUserMsg = messages.find(
      (m) => m.role === "user" || m.role === "user-with-attachments"
    );
    if (
      !firstUserMsg ||
      (firstUserMsg.role !== "user" &&
        firstUserMsg.role !== "user-with-attachments")
    )
      return "";

    let text = "";
    const content = firstUserMsg.content;
    if (typeof content === "string") {
      text = content;
    } else {
      text = content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text || "")
        .join(" ");
    }
    text = text.trim();
    if (!text) return "";

    const sentenceEnd = text.search(/[.!?]/);
    if (sentenceEnd > 0 && sentenceEnd <= 50) {
      return text.substring(0, sentenceEnd + 1);
    }
    return text.length <= 50 ? text : `${text.substring(0, 47)}...`;
  };

  const shouldSaveSession = (messages: AgentMessage[]): boolean => {
    const hasUser = messages.some(
      (m: any) => m.role === "user" || m.role === "user-with-attachments"
    );
    const hasAssistant = messages.some((m: any) => m.role === "assistant");
    return hasUser && hasAssistant;
  };

  const saveSession = async () => {
    if (!currentSessionId || !agent || !currentTitle) return;
    const state = agent.state;
    if (!shouldSaveSession(state.messages)) return;

    try {
      const now = new Date().toISOString();
      await storage.sessions.save(
        {
          id: currentSessionId,
          title: currentTitle,
          model: state.model!,
          thinkingLevel: state.thinkingLevel,
          messages: state.messages,
          createdAt: now,
          lastModified: now,
        },
        {
          id: currentSessionId,
          title: currentTitle,
          createdAt: now,
          lastModified: now,
          messageCount: state.messages.length,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          modelId: state.model?.id || null,
          thinkingLevel: state.thinkingLevel,
          preview: generateTitle(state.messages),
        }
      );
    } catch (err) {
      console.error("Failed to save session:", err);
    }
  };

  const updateUrl = (sessionId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("session", sessionId);
    window.history.replaceState({}, "", url);
  };

  const createAgent = async (initialState?: Partial<AgentState>) => {
    if (agentUnsubscribe) agentUnsubscribe();

    agent = new Agent({
      initialState: initialState || {
        systemPrompt: SYSTEM_PROMPT,
        model: getModel("anthropic", "claude-sonnet-4-5-20250929"),
        thinkingLevel: "off",
        messages: [],
        tools: [],
      },
      convertToLlm: defaultConvertToLlm,
    });

    agentUnsubscribe = agent.subscribe((event: any) => {
      if (event.type === "state-update") {
        const messages = event.state.messages;
        if (!currentTitle && shouldSaveSession(messages)) {
          currentTitle = generateTitle(messages);
        }
        if (!currentSessionId && shouldSaveSession(messages)) {
          currentSessionId = crypto.randomUUID();
          updateUrl(currentSessionId);
        }
        if (currentSessionId) saveSession();
        renderApp();
      }
    });

    await chatPanel.setAgent(agent, {
      onApiKeyRequired: async (provider: string) => {
        return await ApiKeyPromptDialog.prompt(provider);
      },
      toolsFactory: (_agent, _agentInterface, _artifactsPanel, _runtimeProvidersFactory) => {
        const replTool = createJavaScriptReplTool();
        replTool.runtimeProvidersFactory = () => [designSystemProvider];
        return [replTool];
      },
    });
  };

  const loadSession = async (sessionId: string): Promise<boolean> => {
    const sessionData = await storage.sessions.get(sessionId);
    if (!sessionData) {
      console.error("Session not found:", sessionId);
      return false;
    }

    currentSessionId = sessionId;
    const metadata = await storage.sessions.getMetadata(sessionId);
    currentTitle = metadata?.title || "";

    await createAgent({
      model: sessionData.model,
      thinkingLevel: sessionData.thinkingLevel,
      messages: sessionData.messages,
      tools: [],
    });

    updateUrl(sessionId);
    renderApp();
    return true;
  };

  const newSession = () => {
    const url = new URL(window.location.href);
    url.search = "";
    window.location.href = url.toString();
  };

  // --- Render ---
  const renderApp = () => {
    const appHtml = html`
      <div class="w-full h-screen flex flex-col bg-background text-foreground overflow-hidden">
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-border shrink-0">
          <div class="flex items-center gap-2 px-4 py-2">
            ${Button({
              variant: "ghost",
              size: "sm",
              children: icon(History, "sm"),
              onClick: () => {
                SessionListDialog.open(
                  async (sessionId) => {
                    await loadSession(sessionId);
                  },
                  (deletedSessionId) => {
                    if (deletedSessionId === currentSessionId) {
                      newSession();
                    }
                  }
                );
              },
              title: "Sessions",
            })}
            ${Button({
              variant: "ghost",
              size: "sm",
              children: icon(Plus, "sm"),
              onClick: newSession,
              title: "New Session",
            })}
            <span class="text-base font-semibold text-foreground">
              ${currentTitle || "Design System Chat"}
            </span>
          </div>
          <div class="flex items-center gap-1 px-2">
            <theme-toggle .includeSystem=${true}></theme-toggle>
            ${Button({
              variant: "ghost",
              size: "sm",
              children: icon(Settings, "sm"),
              onClick: () => SettingsDialog.open([new ApiKeysTab(), new ProxyTab()]),
              title: "Settings",
            })}
          </div>
        </div>
        <!-- Chat Panel -->
        ${chatPanel}
      </div>
    `;

    render(appHtml, container);
  };

  // --- Init ---
  chatPanel = new ChatPanel();

  const urlParams = new URLSearchParams(window.location.search);
  const sessionIdFromUrl = urlParams.get("session");

  if (sessionIdFromUrl) {
    const loaded = await loadSession(sessionIdFromUrl);
    if (!loaded) {
      newSession();
      return;
    }
  } else {
    await createAgent();
  }

  renderApp();
}
