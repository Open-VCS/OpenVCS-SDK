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

type OpenVCSGlobal = typeof globalThis & {
  OpenVCS?: {
    menus?: {
      get(menuId: string): unknown;
      getOrCreate(menuId: string, label: string): unknown;
      create(menuId: string, label: string, options?: MenubarMenuOptions): unknown;
      addMenuItem(menuId: string, item: MenubarItem): void;
      addMenuSeparator(menuId: string, beforeAction?: string): void;
      remove(menuId: string): void;
      hide(menuId: string): void;
      show(menuId: string): void;
    };
    registerAction(id: string, handler: (...args: unknown[]) => unknown): void;
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
  elements: SerializedMenuItem[];
}

const menus = new Map<string, StoredMenuState>();
const menuOrder: string[] = [];
const actionHandlers = new Map<string, (...args: unknown[]) => unknown>();
let nextSyntheticId = 0;

/** Returns the OpenVCS global, when the host exposes one. */
function getOpenVCS() {
  return (globalThis as OpenVCSGlobal).OpenVCS;
}

/** Normalizes menu ids for stable map lookups. */
function normalizeMenuId(menuId: string): string {
  return String(menuId || '').trim();
}

/** Allocates a stable synthetic id for a generated menu item. */
function allocateSyntheticId(prefix: string): string {
  nextSyntheticId += 1;
  return `${prefix}-${nextSyntheticId}`;
}

/** Returns a stored menu state or null if it does not exist. */
function getStoredMenu(menuId: string): StoredMenuState | null {
  return menus.get(normalizeMenuId(menuId)) || null;
}

/** Inserts a menu id into the ordering list. */
function placeMenuId(menuId: string, options?: MenubarMenuOptions): void {
  const id = normalizeMenuId(menuId);
  const existingIndex = menuOrder.indexOf(id);
  if (existingIndex >= 0) {
    menuOrder.splice(existingIndex, 1);
  }

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

/** Ensures a menu record exists for the provided id. */
function ensureStoredMenu(menuId: string, label: string, options?: MenubarMenuOptions): StoredMenuState {
  const id = normalizeMenuId(menuId);
  const safeLabel = String(label || '').trim() || id;
  let menu = menus.get(id);

  if (!menu) {
    menu = { id, label: safeLabel, items: [] };
    menus.set(id, menu);
    placeMenuId(id, options);
    return menu;
  }

  menu.label = safeLabel;
  placeMenuId(id, options);
  return menu;
}

/** Finds one menu item by action id. */
function findMenuItem(menu: StoredMenuState, actionId: string): StoredMenuItem | null {
  const id = normalizeMenuId(actionId);
  return menu.items.find((item) => item.action === id) || null;
}

/** Inserts a menu item relative to before/after anchors when provided. */
function insertMenuItem(menu: StoredMenuState, item: StoredMenuItem, before?: string, after?: string): void {
  const beforeId = normalizeMenuId(before || '');
  const afterId = normalizeMenuId(after || '');

  const insertAt = (index: number) => {
    const existingIndex = menu.items.findIndex((entry) => entry.id === item.id || entry.action === item.action);
    if (existingIndex >= 0) {
      menu.items.splice(existingIndex, 1);
    }
    menu.items.splice(index, 0, item);
  };

  if (beforeId) {
    const beforeIndex = menu.items.findIndex((entry) => entry.action === beforeId);
    if (beforeIndex >= 0) {
      insertAt(beforeIndex);
      return;
    }
  }

  if (afterId) {
    const afterIndex = menu.items.findIndex((entry) => entry.action === afterId);
    if (afterIndex >= 0) {
      insertAt(afterIndex + 1);
      return;
    }
  }

  insertAt(menu.items.length);
}

/** Converts one stored menu item into a serializable plugin payload element. */
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

/** Serializes the current menu registry for the host runtime. */
function serializeMenus(): SerializedMenuDefinition[] {
  return menuOrder
    .map((menuId, index) => {
      const menu = menus.get(menuId);
      if (!menu || menu.hidden) return null;
      return {
        id: menu.id,
        label: menu.label,
        order: index + 1,
        elements: menu.items
          .map((item) => serializeMenuItem(item))
        .filter((item): item is SerializedMenuItem => Boolean(item)),
      };
    })
    .filter((menu): menu is SerializedMenuDefinition => Boolean(menu));
}

/** Runs one registered action handler by id. */
export async function runRegisteredAction(actionId: string, ...args: unknown[]): Promise<boolean> {
  const id = String(actionId || '').trim();
  if (!id) return false;

  const handler = actionHandlers.get(id);
  if (!handler) return false;

  await handler(...args);
  return true;
}

export interface MenuHandle {
  id: string;
  addItem(item: MenubarItem): void;
  addSeparator(beforeAction?: string): void;
  removeItem(actionId: string): void;
  hideItem(actionId: string): void;
  showItem(actionId: string): void;
}

/** Creates a stable, mutation-based handle for one menu id. */
function createMenuHandle(menuId: string): MenuHandle {
  const id = normalizeMenuId(menuId);

  return {
    id,
    addItem(item: MenubarItem) {
      const menu = getStoredMenu(this.id) || ensureStoredMenu(this.id, this.id);
      const label = String(item?.label || '').trim();
      const action = String(item?.action || '').trim();
      if (!label || !action) return;

      const entry: StoredMenuItem = {
        kind: 'button',
        id: action,
        label,
        title: item.title,
        action,
      };
      insertMenuItem(menu, entry, item.before, item.after);

      const openvcs = getOpenVCS();
      if (!openvcs?.menus) return;
      openvcs.menus.getOrCreate(menu.id, menu.label);
      openvcs.menus.addMenuItem(menu.id, item);
    },
    addSeparator(beforeAction?: string) {
      const menu = getStoredMenu(this.id) || ensureStoredMenu(this.id, this.id);
      const entry: StoredMenuItem = {
        kind: 'separator',
        id: allocateSyntheticId(`${menu.id}-separator`),
        label: 'Separator',
        content: '—',
      };
      insertMenuItem(menu, entry, beforeAction);

      const openvcs = getOpenVCS();
      if (!openvcs?.menus) return;
      openvcs.menus.getOrCreate(menu.id, menu.label);
      openvcs.menus.addMenuSeparator(menu.id, beforeAction);
    },
    removeItem(actionId: string) {
      const menu = getStoredMenu(this.id);
      if (!menu) return;
      const idToRemove = normalizeMenuId(actionId);
      menu.items = menu.items.filter((item) => item.action !== idToRemove);

      const openvcs = getOpenVCS();
      if (openvcs?.menus) {
        const handle = openvcs.menus.get(this.id) as MenuHandle | null;
        handle?.removeItem(idToRemove);
      }
    },
    hideItem(actionId: string) {
      const menu = getStoredMenu(this.id);
      if (!menu) return;
      const item = findMenuItem(menu, actionId);
      if (item) item.hidden = true;

      const openvcs = getOpenVCS();
      if (!openvcs?.menus) return;
      const handle = openvcs.menus.get(this.id) as MenuHandle | null;
      handle?.hideItem(actionId);
    },
    showItem(actionId: string) {
      const menu = getStoredMenu(this.id);
      if (!menu) return;
      const item = findMenuItem(menu, actionId);
      if (item) item.hidden = false;

      const openvcs = getOpenVCS();
      if (!openvcs?.menus) return;
      const handle = openvcs.menus.get(this.id) as MenuHandle | null;
      handle?.showItem(actionId);
    },
  };
}

/** Returns a menu by id, or null when it does not exist. */
export function getMenu(menuId: string): MenuHandle | null {
  const stored = getStoredMenu(menuId);
  if (!stored) return null;
  return createMenuHandle(stored.id);
}

/** Returns a menu by id, creating it when necessary. */
export function getOrCreateMenu(menuId: string, label: string): MenuHandle | null {
  const stored = ensureStoredMenu(menuId, label);
  return createMenuHandle(stored.id);
}

/** Creates a menu at a specific insertion point. */
export function createMenu(menuId: string, label: string, options?: MenubarMenuOptions): MenuHandle | null {
  const stored = ensureStoredMenu(menuId, label, options);
  return createMenuHandle(stored.id);
}

/** Adds one action item to a menu. */
export function addMenuItem(menuId: string, item: MenubarItem): void {
  const menu = getStoredMenu(menuId) || ensureStoredMenu(menuId, menuId);
  const handle = createMenuHandle(menu.id);
  handle.addItem(item);
}

/** Adds one separator item to a menu. */
export function addMenuSeparator(menuId: string, beforeAction?: string): void {
  const menu = getStoredMenu(menuId) || ensureStoredMenu(menuId, menuId);
  const handle = createMenuHandle(menu.id);
  handle.addSeparator(beforeAction);
}

/** Removes one menu entirely. */
export function removeMenu(menuId: string): void {
  const id = normalizeMenuId(menuId);
  menus.delete(id);
  const index = menuOrder.indexOf(id);
  if (index >= 0) menuOrder.splice(index, 1);

  const openvcs = getOpenVCS();
  openvcs?.menus?.remove(id);
}

/** Hides one menu from the host UI. */
export function hideMenu(menuId: string): void {
  const menu = getStoredMenu(menuId);
  if (menu) menu.hidden = true;

  const openvcs = getOpenVCS();
  openvcs?.menus?.hide(normalizeMenuId(menuId));
}

/** Shows one previously hidden menu. */
export function showMenu(menuId: string): void {
  const menu = getStoredMenu(menuId);
  if (menu) menu.hidden = false;

  const openvcs = getOpenVCS();
  openvcs?.menus?.show(normalizeMenuId(menuId));
}

/** Registers an action handler by id. */
export function registerAction(id: string, handler: (...args: unknown[]) => unknown): void {
  const key = String(id || '').trim();
  if (!key) return;
  actionHandlers.set(key, handler);

  const openvcs = getOpenVCS();
  openvcs?.registerAction(key, handler);
}

/** Invokes a host command when the host exposes a direct invoke helper. */
export function invoke<T = unknown>(cmd: string, args?: unknown): Promise<T> {
  const openvcs = getOpenVCS();
  if (!openvcs) {
    return Promise.reject(new Error('OpenVCS not available'));
  }
  return openvcs.invoke(cmd, args);
}

/** Emits a user notification when the host exposes one. */
export function notify(msg: string): void {
  const openvcs = getOpenVCS();
  openvcs?.notify(msg);
}

/** Builds the SDK plugin delegates contributed by the menu registry. */
export function createMenuPluginDelegates(): PluginDelegates<PluginRuntimeContext> {
  return {
    async 'plugin.get_menus'(): Promise<PluginMenuDefinition[]> {
      return serializeMenus() as unknown as PluginMenuDefinition[];
    },
    async 'plugin.handle_action'(params: PluginHandleActionParams): Promise<null> {
      const actionId = String(params?.action_id || '').trim();
      if (!actionId) return null;
      await runRegisteredAction(actionId);
      return null;
    },
  };
}
