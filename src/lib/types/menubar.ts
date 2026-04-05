// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/** API for manipulating top-level application menus. */
export interface MenubarManager {
  /** Gets a menu by ID (e.g., 'file', 'repository', 'help'). Returns null if not found. */
  get(menuId: string): MenubarMenu | null;
  /** Gets a menu by ID, creating it if it doesn't exist. */
  getOrCreate(menuId: string, label: string): MenubarMenu;
  /** Creates a new menu at the specified position. */
  create(menuId: string, label: string, options?: { before?: string; after?: string }): MenubarMenu;
  /** Removes a menu entirely. */
  remove(menuId: string): void;
  /** Hides a menu (visibility: hidden). */
  hide(menuId: string): void;
  /** Shows a hidden menu. */
  show(menuId: string): void;
}

/** Handle for manipulating a specific menu. */
export interface MenubarMenu {
  /** Menu ID. */
  id: string;
  /** Adds an item to this menu. */
  addItem(item: MenubarItem): void;
  /** Adds a separator to this menu. */
  addSeparator(beforeAction?: string): void;
  /** Removes an item by action ID. */
  removeItem(actionId: string): void;
  /** Hides an item by action ID. */
  hideItem(actionId: string): void;
  /** Shows a hidden item. */
  showItem(actionId: string): void;
}

/** Descriptor for a menu item. */
export interface MenubarItem {
  /** Display label. */
  label: string;
  /** Action ID (plugin must register handler separately). */
  action: string;
  /** Optional tooltip. */
  title?: string;
  /** Insert before this action ID. */
  before?: string;
  /** Insert after this action ID. */
  after?: string;
}
