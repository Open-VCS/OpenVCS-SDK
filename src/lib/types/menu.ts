// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/** Describes where a plugin menu should appear in the client UI. */
export type PluginMenuSurface = 'settings' | 'repository';

/** Describes a settings-panel element contributed by a plugin menu. */
export interface PluginMenuElementDefinition {
  /** Stores the element kind. */
  type: 'text' | 'button';
  /** Stores a stable element id. */
  id: string;
  /** Stores text content for text elements. */
  content?: string;
  /** Stores the label shown for button elements. */
  label?: string;
  /** Stores an optional tooltip for the rendered element. */
  title?: string;
  /** Stores whether the element is hidden from rendering. */
  hidden?: boolean;
}

/** Describes a repository-dropdown option contributed by a plugin. */
export interface PluginMenuOptionDefinition {
  /** Stores a stable option id. */
  id: string;
  /** Stores the visible option label. */
  label: string;
  /** Stores the plugin action id invoked when the option is selected. */
  action: string;
  /** Stores an optional tooltip for the option. */
  title?: string;
  /** Stores whether the option is hidden from rendering. */
  hidden?: boolean;
  /** Stores the option order within the menu. */
  order?: number;
}

/** Describes one plugin-contributed menu definition. */
export interface PluginMenuDefinition {
  /** Stores a stable plugin-local menu id. */
  id: string;
  /** Stores the user-visible menu label. */
  label: string;
  /** Stores the target surface that renders the menu. */
  surface: PluginMenuSurface;
  /** Stores an optional display ordering hint. */
  order?: number;
  /** Stores whether the menu is hidden from rendering. */
  hidden?: boolean;
  /** Stores renderable settings-panel elements for settings menus. */
  elements?: PluginMenuElementDefinition[];
  /** Stores dropdown options for repository menus. */
  options?: PluginMenuOptionDefinition[];
}

/** Describes the mutable menu registry exposed to plugin startup code. */
export interface PluginMenuRegistry {
  /** Returns the current menu definitions as serializable payloads. */
  list(): PluginMenuDefinition[];
  /** Returns a mutable handle for a menu by id. */
  get(id: string): PluginMenuHandle | null;
  /** Adds a new menu or replaces an existing menu with the same id. */
  add(menu: PluginMenuDefinition): PluginMenuHandle;
  /** Returns all current menu ids. */
  ids(): string[];
}

/** Describes a mutable handle for one plugin menu. */
export interface PluginMenuHandle {
  /** Returns the current menu definition snapshot. */
  read(): PluginMenuDefinition;
  /** Renames the menu label. */
  rename(label: string): PluginMenuHandle;
  /** Hides or shows the menu. */
  hide(hidden?: boolean): PluginMenuHandle;
  /** Adds or replaces a repository option. */
  addOption(option: PluginMenuOptionDefinition): PluginMenuHandle;
  /** Removes a repository option by id. */
  removeOption(id: string): PluginMenuHandle;
  /** Hides or shows a repository option by id. */
  hideOption(id: string, hidden?: boolean): PluginMenuHandle;
  /** Renames a repository option by id. */
  renameOption(id: string, label: string): PluginMenuHandle;
  /** Updates an individual repository option. */
  updateOption(id: string, option: Partial<PluginMenuOptionDefinition>): PluginMenuHandle;
  /** Adds or replaces a settings element. */
  addElement(element: PluginMenuElementDefinition): PluginMenuHandle;
  /** Removes a settings element by id. */
  removeElement(id: string): PluginMenuHandle;
  /** Hides or shows a settings element by id. */
  hideElement(id: string, hidden?: boolean): PluginMenuHandle;
  /** Renames a settings button element by id. */
  renameElement(id: string, label: string): PluginMenuHandle;
  /** Updates an individual settings element. */
  updateElement(id: string, element: Partial<PluginMenuElementDefinition>): PluginMenuHandle;
}
