import type { SandboxRuntimeProvider } from "@mariozechner/pi-web-ui";

// Import the JSON data — Vite handles these as static imports.
// Paths resolve to data/agent/ at the monorepo root.
import index from "../../../data/agent/index.json";

// Dynamically import all component JSON files using Vite's glob import
const componentModules = import.meta.glob<{ default: any }>(
  "../../../data/agent/components/*.json",
  { eager: true }
);

// Build a slug → component-data map
const components: Record<string, any> = {};
for (const [path, mod] of Object.entries(componentModules)) {
  // path looks like "../../../data/agent/components/button.json" → extract "button"
  const slug = path.split("/").pop()!.replace(".json", "");
  components[slug] = mod.default;
}

/**
 * SandboxRuntimeProvider that injects Vanilla Framework design system data
 * into the JavaScript REPL sandbox.
 *
 * Exposes:
 * - window.designSystem.index  — the full index
 * - window.designSystem.components — slug-keyed component details
 * - listComponents()           — returns all components from index
 * - searchComponents(query)    — case-insensitive search across names & descriptions
 * - getComponent(slug)         — returns full component detail
 * - getComponentField(slug, f) — returns a specific field from a component
 */
export class DesignSystemRuntimeProvider implements SandboxRuntimeProvider {
  getData(): Record<string, any> {
    return {
      designSystem: {
        index,
        components,
      },
    };
  }

  getRuntime(): (sandboxId: string) => void {
    // This function is stringified and injected into the sandbox.
    // It CANNOT reference external variables or imports.
    return (_sandboxId: string) => {
      const ds = (window as any).designSystem;

      /**
       * List all components from the index.
       * Returns: Array of { name, slug, type, tiers, description }
       */
      (window as any).listComponents = () => {
        return ds.index.components;
      };

      /**
       * Case-insensitive search across component names and descriptions.
       * Returns matching index entries.
       */
      (window as any).searchComponents = (query: string) => {
        const q = query.toLowerCase();
        return ds.index.components.filter((c: any) => {
          return (
            c.name.toLowerCase().includes(q) ||
            (c.description && c.description.toLowerCase().includes(q))
          );
        });
      };

      /**
       * Get full component detail by slug.
       * Returns the complete component object or throws if not found.
       */
      (window as any).getComponent = (slug: string) => {
        const component = ds.components[slug];
        if (!component) {
          const available = Object.keys(ds.components).sort().join(", ");
          throw new Error(
            `Component "${slug}" not found. Available slugs: ${available}`
          );
        }
        return component;
      };

      /**
       * Get a specific field from a component by slug.
       * Returns the field value or throws if component/field not found.
       */
      (window as any).getComponentField = (slug: string, field: string) => {
        const component = (window as any).getComponent(slug);
        if (!(field in component)) {
          const available = Object.keys(component).sort().join(", ");
          throw new Error(
            `Field "${field}" not found on component "${slug}". Available fields: ${available}`
          );
        }
        return component[field];
      };
    };
  }

  getDescription(): string {
    return `## Design System Data

The sandbox has access to Canonical's Vanilla Framework design system documentation (49 components).

### Available functions:

- \`listComponents()\` — Returns all components from the index. Each has: name, slug, type, tiers, description.
- \`searchComponents(query)\` — Case-insensitive search across component names and descriptions. Returns matching index entries.
- \`getComponent(slug)\` — Returns the full component detail object by slug. Fields include: name, slug, type, tiers, url, description, usage, examples, interactions, properties, anatomy, mentionedIn, mentionsComponents, changeLog, decisionLog, figmaLink, codeLink.
- \`getComponentField(slug, field)\` — Returns a specific field from a component. Use this to avoid loading entire component objects when you only need one field.

### Raw data access:

- \`window.designSystem.index\` — The full index object
- \`window.designSystem.components\` — Object keyed by slug with full component details

### Tips:
- Start with \`listComponents()\` or \`searchComponents()\` to find relevant components
- Use \`getComponentField(slug, "properties")\` to get just properties without loading everything
- All standard JavaScript array methods work: \`.filter()\`, \`.map()\`, \`.find()\`, \`.sort()\`, etc.
`;
  }
}
