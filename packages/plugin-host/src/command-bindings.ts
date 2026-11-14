import type { Disposable, PluginCommand, PluginKeymap } from "@md-editor/plugin-sdk";

export interface PluginCommandBinding {
  readonly id: string;
  readonly pluginId: string;
  readonly title: string;
  readonly description?: string;
  /** Suggested key, never registered without an explicit user binding. */
  readonly key: string;
  readonly legacyIds: readonly string[];
  readonly effectiveKey: string | null;
  readonly overrideError?: {
    readonly kind: "invalid" | "conflict" | "registration";
    readonly message: string;
  };
}

interface BindingOptions {
  commands: { register(command: PluginCommand): Disposable };
  keymaps: {
    register(keymap: PluginKeymap): Disposable;
    findConflict(key: string): { readonly id: string } | undefined;
  };
  getBindings(pluginId: string): Readonly<Record<string, string>>;
  validateKey(key: string): string | null;
  onChange(): void;
}

/** User bindings belong to commands; legacy keymap contributions only supply suggestions. */
export function createPluginCommandBindings(options: BindingOptions) {
  const commands = new Map<
    string,
    { command: PluginCommand; pluginId: string; binding?: Disposable }
  >();
  const suggestions = new Map<string, { keymap: PluginKeymap; pluginId: string }>();
  const statuses = new Map<string, PluginCommandBinding>();

  function refresh(commandId: string) {
    const entry = commands.get(commandId);
    if (!entry) return;
    entry.binding?.dispose();
    entry.binding = undefined;
    const declarations = [...suggestions.values()].filter(
      (item) => item.pluginId === entry.pluginId && item.keymap.commandId === commandId,
    );
    const bindings = options.getBindings(entry.pluginId);
    // An explicitly cleared command binding must take precedence over any older keymap binding.
    const configured =
      bindings[commandId] ??
      declarations.map(({ keymap }) => bindings[keymap.id]).find((key) => key !== undefined);
    let overrideError: PluginCommandBinding["overrideError"];
    let effectiveKey: string | null = null;
    if (configured) {
      const invalid = options.validateKey(configured);
      const conflict = invalid ? undefined : options.keymaps.findConflict(configured);
      if (invalid) overrideError = { kind: "invalid", message: invalid };
      else if (conflict) overrideError = { kind: "conflict", message: conflict.id };
      else {
        try {
          entry.binding = options.keymaps.register({ id: commandId, commandId, key: configured });
          effectiveKey = configured;
        } catch (error) {
          // A runtime registry failure disables only this shortcut, never the plugin's commands.
          overrideError = {
            kind: "registration",
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }
    statuses.set(commandId, {
      id: commandId,
      pluginId: entry.pluginId,
      title: entry.command.title,
      ...(entry.command.description ? { description: entry.command.description } : {}),
      key: entry.command.suggestedKey ?? declarations[0]?.keymap.key ?? "",
      legacyIds: declarations.map(({ keymap }) => keymap.id),
      effectiveKey,
      ...(overrideError ? { overrideError } : {}),
    });
    options.onChange();
  }

  return {
    commands: {
      register(command: PluginCommand, pluginId: string): Disposable {
        const registration = options.commands.register(command);
        commands.set(command.id, { command, pluginId });
        try {
          refresh(command.id);
        } catch (error) {
          commands.get(command.id)?.binding?.dispose();
          commands.delete(command.id);
          statuses.delete(command.id);
          registration.dispose();
          throw error;
        }
        return {
          dispose() {
            commands.get(command.id)?.binding?.dispose();
            commands.delete(command.id);
            statuses.delete(command.id);
            registration.dispose();
            options.onChange();
          },
        };
      },
    },
    keymaps: {
      register(keymap: PluginKeymap, pluginId: string): Disposable {
        suggestions.set(keymap.id, { keymap, pluginId });
        try {
          refresh(keymap.commandId);
        } catch (error) {
          suggestions.delete(keymap.id);
          throw error;
        }
        return {
          dispose() {
            suggestions.delete(keymap.id);
            refresh(keymap.commandId);
          },
        };
      },
    },
    getStatuses: (): readonly PluginCommandBinding[] => [...statuses.values()],
  };
}
