// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MenubarItem } from '../types/menubar.js';

type MenubarMenuOptions = { before?: string; after?: string };

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

function getOpenVCS() {
  return (globalThis as OpenVCSGlobal).OpenVCS;
}

export interface MenuHandle {
  id: string;
  addItem(item: MenubarItem): void;
  addSeparator(beforeAction?: string): void;
  removeItem(actionId: string): void;
  hideItem(actionId: string): void;
  showItem(actionId: string): void;
}

function castMenuHandle(menu: unknown): MenuHandle | null {
  if (!menu) return null;
  return menu as MenuHandle;
}

export function getMenu(menuId: string): MenuHandle | null {
  const openvcs = getOpenVCS();
  if (!openvcs?.menus) return null;
  return castMenuHandle(openvcs.menus.get(menuId));
}

export function getOrCreateMenu(menuId: string, label: string): MenuHandle | null {
  const openvcs = getOpenVCS();
  if (!openvcs?.menus) return null;
  return castMenuHandle(openvcs.menus.getOrCreate(menuId, label));
}

export function createMenu(menuId: string, label: string, options?: MenubarMenuOptions): MenuHandle | null {
  const openvcs = getOpenVCS();
  if (!openvcs?.menus) return null;
  return castMenuHandle(openvcs.menus.create(menuId, label, options));
}

export function addMenuItem(menuId: string, item: MenubarItem): void {
  const openvcs = getOpenVCS();
  openvcs?.menus?.addMenuItem(menuId, item);
}

export function addMenuSeparator(menuId: string, beforeAction?: string): void {
  const openvcs = getOpenVCS();
  openvcs?.menus?.addMenuSeparator(menuId, beforeAction);
}

export function removeMenu(menuId: string): void {
  const openvcs = getOpenVCS();
  openvcs?.menus?.remove(menuId);
}

export function hideMenu(menuId: string): void {
  const openvcs = getOpenVCS();
  openvcs?.menus?.hide(menuId);
}

export function showMenu(menuId: string): void {
  const openvcs = getOpenVCS();
  openvcs?.menus?.show(menuId);
}

export function registerAction(id: string, handler: (...args: unknown[]) => unknown): void {
  const openvcs = getOpenVCS();
  openvcs?.registerAction(id, handler);
}

export function invoke<T = unknown>(cmd: string, args?: unknown): Promise<T> {
  const openvcs = getOpenVCS();
  if (!openvcs) {
    return Promise.reject(new Error('OpenVCS not available'));
  }
  return openvcs.invoke(cmd, args);
}

export function notify(msg: string): void {
  const openvcs = getOpenVCS();
  openvcs?.notify(msg);
}
