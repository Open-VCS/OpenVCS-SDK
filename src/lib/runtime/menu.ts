// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MenubarItem } from '../types/menubar.js';
import type {
  PluginDelegates,
  PluginHandleActionParams,
  PluginMenuDefinition,
} from '../types/plugin.js';

import type { PluginRuntimeContext } from './contracts.js';

type MenubarMenuOptions = { before?: string; after?: string };
type MenuEntryKind = 'button' | 'text' | 'separator';
type MenuSurface = 'menubar' | 'settings';

type OpenVCSGlobal = typeof globalThis & {
  OpenVCS?: {
    invoke<T = unknown>(cmd: string, args?: unknown): Promise<T>;
    notify(msg: string): void;
  };
};

interface StoredMenuItem {
  kind: MenuEntryKind;
  id: string;
  label: string;
  title?: string;
  content?: string;
  action?: string;
  hidden?: boolean;
}

interface StoredMenuState {
  id: string;
  label: string;
  hidden?: boolean;
  /** Surface target for rendering (defaults to menubar for back-compat). */
  surface?: 'menubar' | 'settings';
  items: StoredMenuItem[];
}

interface SerializedMenuItem {
  type: 'button' | 'text';
  id: string;
  label?: string;
  content?: string;
}

interface SerializedMenuDefinition {
  id: string;
  label: string;
  order: number;
  surface: 'menubar' | 'settings';
  elements: SerializedMenuItem[];
}

const menus = new Map<string, StoredMenuState>();
const menuOrder: string[] = [];
const actionHandlers = new Map<string, (...args: unknown[]) => unknown>();
let syntheticId = 0;

/** Returns the host-side OpenVCS helper, when the environment provides one. */
function getOpenVCS() {
  return (globalThis as OpenVCSGlobal).OpenVCS;
}

/** Normalizes a menu id for stable map lookup. */
function normalizeMenuId(menuId: string): string {
  return String(menuId || '').trim();
}

/** Allocates a stable synthetic id for generated menu entries. */
function allocateSyntheticId(prefix: string): string {
  syntheticId += 1;
  return `${prefix}-${syntheticId}`;
}

/** Returns the stored menu state for one id, if present. */
function getStoredMenu(menuId: string): StoredMenuState | null {
  return menus.get(normalizeMenuId(menuId)) || null;
}

/** Removes one menu id from the ordering list. */
function removeMenuId(menuId: string): void {
  const id = normalizeMenuId(menuId);
  const index = menuOrder.indexOf(id);
  if (index >= 0) menuOrder.splice(index, 1);
}

/** Inserts one menu id into the ordering list. */
function placeMenuId(menuId: string, options?: MenubarMenuOptions): void {
  const id = normalizeMenuId(menuId);
  removeMenuId(id);

  const beforeId = normalizeMenuId(options?.before || '');
  const afterId = normalizeMenuId(options?.after || '');

  if (afterId) {
    const afterIndex = menuOrder.indexOf(afterId);
    if (afterIndex >= 0) {
      menuOrder.splice(afterIndex + 1, 0, id);
      return;
    }
  }

  if (beforeId) {
    const beforeIndex = menuOrder.indexOf(beforeId);
    if (beforeIndex >= 0) {
      menuOrder.splice(beforeIndex, 0, id);
      return;
    }
  }

  menuOrder.push(id);
}

/** Ensures a menu record exists for one id. */
function ensureStoredMenu(
  menuId: string,
  label: string,
  options?: MenubarMenuOptions,
  surface: MenuSurface = 'menubar',
): StoredMenuState {
  const id = normalizeMenuId(menuId);
  const safeLabel = String(label || '').trim() || id;
  let menu = menus.get(id);

  if (!menu) {
    menu = { id, label: safeLabel, surface, items: [] };
    menus.set(id, menu);
  } else {
    menu.label = safeLabel;
    // Preserve surface if already set, otherwise use provided.
    if (!menu.surface) menu.surface = surface;
  }

  placeMenuId(id, options);
  return menu;
}

/** Finds a stored item by action id. */
function findStoredItem(menu: StoredMenuState, actionId: string): StoredMenuItem | null {
  const id = normalizeMenuId(actionId);
  return menu.items.find((item) => item.action === id) || null;
}

/** Inserts a menu item at the requested position. */
function insertMenuItem(menu: StoredMenuState, item: StoredMenuItem, before?: string, after?: string): void {
  const beforeId = normalizeMenuId(before || '');
  const afterId = normalizeMenuId(after || '');

  const removeExisting = () => {
    const index = menu.items.findIndex((entry) => entry.id === item.id || entry.action === item.action);
    if (index >= 0) menu.items.splice(index, 1);
  };

  if (beforeId) {
    const beforeIndex = menu.items.findIndex((entry) => entry.action === beforeId);
    if (beforeIndex >= 0) {
      removeExisting();
      menu.items.splice(beforeIndex, 0, item);
      return;
    }
  }

  if (afterId) {
    const afterIndex = menu.items.findIndex((entry) => entry.action === afterId);
    if (afterIndex >= 0) {
      removeExisting();
      menu.items.splice(afterIndex + 1, 0, item);
      return;
    }
  }

  removeExisting();
  menu.items.push(item);
}

/** Converts one stored item into a serializable menu payload element. */
function serializeMenuItem(item: StoredMenuItem): SerializedMenuItem | null {
  if (item.hidden) return null;

  if (item.kind === 'separator') {
    return {
      type: 'text',
      id: item.id,
      content: item.content || '—',
    };
  }

  if (item.kind === 'text') {
    return {
      type: 'text',
      id: item.id,
      content: item.content || item.label,
    };
  }

  return {
    type: 'button',
    id: item.action || item.id,
    label: item.label,
  };
}

/** Serializes the local registry into plugin menu payloads. */
function serializeMenus(): SerializedMenuDefinition[] {
  return menuOrder
    .map((menuId, index) => {
      const menu = menus.get(menuId);
      if (!menu || menu.hidden) return null;
      return {
        id: menu.id,
        label: menu.label,
        order: index + 1,
        surface: menu.surface ?? 'menubar',
        elements: menu.items
          .map((item) => serializeMenuItem(item))
          .filter((item): item is SerializedMenuItem => Boolean(item)),
      };
    })
    .filter((menu): menu is SerializedMenuDefinition => Boolean(menu));
}

/** Runs a registered action handler by id. */
export async function runRegisteredAction(actionId: string, ...args: unknown[]): Promise<unknown> {
  const id = String(actionId || '').trim();
  if (!id) return null;

  const handler = actionHandlers.get(id);
  if (!handler) return null;

  return await handler(...args);
}

export interface MenuHandle {
  id: string;
  addItem(item: MenubarItem): void;
  addSeparator(beforeAction?: string): void;
  removeItem(actionId: string): void;
  hideItem(actionId: string): void;
  showItem(actionId: string): void;
}

/** Creates a stable handle for one stored menu. */
function createMenuHandle(menuId: string): MenuHandle {
  const id = normalizeMenuId(menuId);

  return {
    id,
    addItem(item: MenubarItem) {
      const label = String(item?.label || '').trim();
      const action = String(item?.action || '').trim();
      if (!label || !action) return;

      const menu = getStoredMenu(this.id) || ensureStoredMenu(this.id, this.id);
      insertMenuItem(menu, {
        kind: 'button',
        id: action,
        label,
        title: item.title,
        action,
      }, item.before, item.after);
    },
    addSeparator(beforeAction?: string) {
      const menu = getStoredMenu(this.id) || ensureStoredMenu(this.id, this.id);
      insertMenuItem(menu, {
        kind: 'separator',
        id: allocateSyntheticId(`${menu.id}-separator`),
        label: 'Separator',
        content: '—',
      }, beforeAction);
    },
    removeItem(actionId: string) {
      const menu = getStoredMenu(this.id);
      if (!menu) return;
      const idToRemove = normalizeMenuId(actionId);
      menu.items = menu.items.filter((item) => item.action !== idToRemove);
    },
    hideItem(actionId: string) {
      const menu = getStoredMenu(this.id);
      if (!menu) return;
      const item = findStoredItem(menu, actionId);
      if (item) item.hidden = true;
    },
    showItem(actionId: string) {
      const menu = getStoredMenu(this.id);
      if (!menu) return;
      const item = findStoredItem(menu, actionId);
      if (item) item.hidden = false;
    },
  };
}

/** Returns a menu by id, or null when it does not exist. */
export function getMenu(menuId: string): MenuHandle | null {
  const stored = getStoredMenu(menuId);
  if (!stored) return null;
  return createMenuHandle(stored.id);
}

/** Returns a menu by id, creating it if needed.
 * @param menuId - Menu identifier
 * @param label - User-visible label
 * @param options - Optional surface target ('menubar' or 'settings'), defaults to 'menubar'
 */
export function getOrCreateMenu(
  menuId: string,
  label: string,
  options?: MenubarMenuOptions & { surface?: MenuSurface },
): MenuHandle | null {
  const surface = options?.surface ?? 'menubar';
  const { surface: _, ...restOptions } = options ?? {};
  const stored = ensureStoredMenu(menuId, label, restOptions, surface);
  return createMenuHandle(stored.id);
}

/** Creates a menu at a specific position (alias for getOrCreateMenu). */
export const createMenu = getOrCreateMenu;

/** Adds one item to a menu. */
export function addMenuItem(menuId: string, item: MenubarItem): void {
  createMenuHandle(menuId).addItem(item);
}

/** Adds one separator to a menu. */
export function addMenuSeparator(menuId: string, beforeAction?: string): void {
  createMenuHandle(menuId).addSeparator(beforeAction);
}

/** Removes one menu from the registry. */
export function removeMenu(menuId: string): void {
  const id = normalizeMenuId(menuId);
  menus.delete(id);
  removeMenuId(id);
}

/** Hides one menu from the registry. */
export function hideMenu(menuId: string): void {
  const menu = getStoredMenu(menuId);
  if (menu) menu.hidden = true;
}

/** Shows one menu from the registry. */
export function showMenu(menuId: string): void {
  const menu = getStoredMenu(menuId);
  if (menu) menu.hidden = false;
}

/** Registers an action handler by id. */
export function registerAction(id: string, handler: (...args: unknown[]) => unknown): void {
  const key = String(id || '').trim();
  if (!key) return;
  actionHandlers.set(key, handler);
}

/** Invokes a host command when a host helper is available. */
export function invoke<T = unknown>(cmd: string, args?: unknown): Promise<T> {
  const openvcs = getOpenVCS();
  if (!openvcs) {
    return Promise.reject(new Error('OpenVCS host is not available in this runtime'));
  }
  return openvcs.invoke(cmd, args);
}

/** Emits a notification when the host helper is available. */
export function notify(msg: string): void {
  const openvcs = getOpenVCS();
  openvcs?.notify(msg);
}

/** Builds SDK delegates from the local menu/action registries. */
export function createMenuPluginDelegates(): PluginDelegates<PluginRuntimeContext> {
  return {
    async 'plugin.get_menus'(): Promise<PluginMenuDefinition[]> {
      return serializeMenus() as unknown as PluginMenuDefinition[];
    },
    async 'plugin.handle_action'(params: PluginHandleActionParams): Promise<unknown> {
      const actionId = String(params?.action_id || params?.id || '').trim();
      if (actionId) {
        return await runRegisteredAction(actionId, params?.payload);
      }
      return null;
    },
  };
}
