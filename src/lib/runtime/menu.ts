// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  PluginMenuDefinition,
  PluginMenuElementDefinition,
  PluginMenuHandle,
  PluginMenuOptionDefinition,
  PluginMenuRegistry,
  PluginMenuSurface,
} from '../types';

function normalizeId(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function cloneMenu(menu: PluginMenuDefinition): PluginMenuDefinition {
  return {
    ...menu,
    id: String(menu.id || '').trim(),
    label: String(menu.label || '').trim(),
    surface: menu.surface,
    elements: Array.isArray(menu.elements) ? menu.elements.map((element) => ({ ...element })) : [],
    options: Array.isArray(menu.options) ? menu.options.map((option) => ({ ...option })) : [],
  };
}

function sortMenus(menus: PluginMenuDefinition[]): PluginMenuDefinition[] {
  return menus.slice().sort((a, b) => {
    const aOrder = a.order ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.order ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const labelCompare = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    if (labelCompare !== 0) return labelCompare;
    return a.id.localeCompare(b.id, undefined, { sensitivity: 'base' });
  });
}

function sortOptions(options: PluginMenuOptionDefinition[]): PluginMenuOptionDefinition[] {
  return options.slice().sort((a, b) => {
    const aOrder = a.order ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.order ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const labelCompare = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    if (labelCompare !== 0) return labelCompare;
    return a.id.localeCompare(b.id, undefined, { sensitivity: 'base' });
  });
}

class MenuHandleImpl implements PluginMenuHandle {
  constructor(private readonly registry: PluginMenuRegistryImpl, private readonly menuId: string) {}

  read(): PluginMenuDefinition {
    return this.registry.readMenu(this.menuId);
  }

  rename(label: string): PluginMenuHandle {
    this.registry.updateMenu(this.menuId, { label: String(label || '').trim() });
    return this;
  }

  hide(hidden = true): PluginMenuHandle {
    this.registry.updateMenu(this.menuId, { hidden });
    return this;
  }

  addOption(option: PluginMenuOptionDefinition): PluginMenuHandle {
    this.registry.upsertOption(this.menuId, option);
    return this;
  }

  removeOption(id: string): PluginMenuHandle {
    this.registry.removeOption(this.menuId, id);
    return this;
  }

  hideOption(id: string, hidden = true): PluginMenuHandle {
    this.registry.updateOption(this.menuId, id, { hidden });
    return this;
  }

  renameOption(id: string, label: string): PluginMenuHandle {
    this.registry.updateOption(this.menuId, id, { label: String(label || '').trim() });
    return this;
  }

  updateOption(id: string, option: Partial<PluginMenuOptionDefinition>): PluginMenuHandle {
    this.registry.updateOption(this.menuId, id, option);
    return this;
  }

  addElement(element: PluginMenuElementDefinition): PluginMenuHandle {
    this.registry.upsertElement(this.menuId, element);
    return this;
  }

  removeElement(id: string): PluginMenuHandle {
    this.registry.removeElement(this.menuId, id);
    return this;
  }

  hideElement(id: string, hidden = true): PluginMenuHandle {
    this.registry.updateElement(this.menuId, id, { hidden });
    return this;
  }

  renameElement(id: string, label: string): PluginMenuHandle {
    this.registry.updateElement(this.menuId, id, { label: String(label || '').trim() });
    return this;
  }

  updateElement(id: string, element: Partial<PluginMenuElementDefinition>): PluginMenuHandle {
    this.registry.updateElement(this.menuId, id, element);
    return this;
  }
}

class PluginMenuRegistryImpl implements PluginMenuRegistry {
  private readonly menus = new Map<string, PluginMenuDefinition>();

  constructor(initial: PluginMenuDefinition[] = []) {
    for (const menu of initial) {
      this.add(menu);
    }
  }

  list(): PluginMenuDefinition[] {
    return sortMenus(Array.from(this.menus.values()).map((menu) => cloneMenu(menu)));
  }

  ids(): string[] {
    return this.list().map((menu) => menu.id);
  }

  get(id: string): PluginMenuHandle | null {
    const key = normalizeId(id);
    if (!key || !this.menus.has(key)) return null;
    return new MenuHandleImpl(this, key);
  }

  add(menu: PluginMenuDefinition): PluginMenuHandle {
    const snapshot = this.normalizeMenu(menu);
    this.menus.set(normalizeId(snapshot.id), snapshot);
    return new MenuHandleImpl(this, normalizeId(snapshot.id));
  }

  readMenu(menuId: string): PluginMenuDefinition {
    const key = normalizeId(menuId);
    const menu = this.menus.get(key);
    if (!menu) {
      throw new Error(`menu '${menuId}' not found`);
    }
    return cloneMenu(menu);
  }

  updateMenu(menuId: string, patch: Partial<PluginMenuDefinition>): void {
    const key = normalizeId(menuId);
    const menu = this.menus.get(key);
    if (!menu) return;
    const next = this.normalizeMenu({ ...menu, ...patch, id: menu.id, surface: menu.surface });
    this.menus.set(key, next);
  }

  removeMenu(menuId: string): void {
    this.menus.delete(normalizeId(menuId));
  }

  upsertOption(menuId: string, option: PluginMenuOptionDefinition): void {
    const key = normalizeId(menuId);
    const menu = this.ensureMenu(key, 'repository');
    const normalized = this.normalizeOption(option);
    const options = (menu.options || []).filter((item) => normalizeId(item.id) !== normalizeId(normalized.id));
    options.push(normalized);
    menu.options = sortOptions(options);
    this.menus.set(key, menu);
  }

  removeOption(menuId: string, optionId: string): void {
    this.updateOptions(menuId, optionId, null);
  }

  updateOption(menuId: string, optionId: string, patch: Partial<PluginMenuOptionDefinition>): void {
    const key = normalizeId(menuId);
    const menu = this.menus.get(key);
    if (!menu) return;
    const optionKey = normalizeId(optionId);
    const options = Array.isArray(menu.options) ? menu.options.slice() : [];
    const index = options.findIndex((opt) => normalizeId(opt.id) === optionKey);
    if (index < 0) return;
    const next = this.normalizeOption({ ...options[index], ...patch, id: options[index].id, action: options[index].action });
    options[index] = next;
    menu.options = sortOptions(options);
    this.menus.set(key, menu);
  }

  upsertElement(menuId: string, element: PluginMenuElementDefinition): void {
    const key = normalizeId(menuId);
    const menu = this.ensureMenu(key, 'settings');
    const normalized = this.normalizeElement(element);
    const elements = (menu.elements || []).filter((item) => normalizeId(item.id) !== normalizeId(normalized.id));
    elements.push(normalized);
    menu.elements = elements;
    this.menus.set(key, menu);
  }

  removeElement(menuId: string, elementId: string): void {
    const key = normalizeId(menuId);
    const menu = this.menus.get(key);
    if (!menu) return;
    menu.elements = (menu.elements || []).filter((item) => normalizeId(item.id) !== normalizeId(elementId));
  }

  updateElement(menuId: string, elementId: string, patch: Partial<PluginMenuElementDefinition>): void {
    const key = normalizeId(menuId);
    const menu = this.menus.get(key);
    if (!menu) return;
    const elementKey = normalizeId(elementId);
    const elements = Array.isArray(menu.elements) ? menu.elements.slice() : [];
    const index = elements.findIndex((item) => normalizeId(item.id) === elementKey);
    if (index < 0) return;
    const next = this.normalizeElement({ ...elements[index], ...patch, id: elements[index].id, type: elements[index].type });
    elements[index] = next;
    menu.elements = elements;
    this.menus.set(key, menu);
  }

  private normalizeMenu(menu: PluginMenuDefinition): PluginMenuDefinition {
    const surface = menu.surface === 'repository' ? 'repository' : 'settings';
    return {
      ...menu,
      id: String(menu.id || '').trim(),
      label: String(menu.label || '').trim(),
      surface,
      hidden: menu.hidden === true,
      order: typeof menu.order === 'number' ? menu.order : undefined,
      elements: Array.isArray(menu.elements) ? menu.elements.map((element) => this.normalizeElement(element)) : [],
      options: Array.isArray(menu.options) ? menu.options.map((option) => this.normalizeOption(option)) : [],
    };
  }

  private normalizeOption(option: PluginMenuOptionDefinition): PluginMenuOptionDefinition {
    return {
      ...option,
      id: String(option.id || '').trim(),
      label: String(option.label || '').trim(),
      action: String(option.action || '').trim(),
      title: String(option.title || '').trim() || undefined,
      hidden: option.hidden === true,
      order: typeof option.order === 'number' ? option.order : undefined,
    };
  }

  private normalizeElement(element: PluginMenuElementDefinition): PluginMenuElementDefinition {
    return {
      ...element,
      type: element.type === 'button' ? 'button' : 'text',
      id: String(element.id || '').trim(),
      content: String(element.content || '').trim() || undefined,
      label: String(element.label || '').trim() || undefined,
      title: String(element.title || '').trim() || undefined,
      hidden: element.hidden === true,
    };
  }

  private ensureMenu(key: string, surface: PluginMenuSurface): PluginMenuDefinition {
    const existing = this.menus.get(key);
    if (existing) return existing;
    const fallback: PluginMenuDefinition = {
      id: key,
      label: key,
      surface,
      options: [],
      elements: [],
    };
    this.menus.set(key, fallback);
    return fallback;
  }

  private updateOptions(menuId: string, optionId: string, option: PluginMenuOptionDefinition | null): void {
    const key = normalizeId(menuId);
    const menu = this.menus.get(key);
    if (!menu) return;
    menu.options = (menu.options || []).filter((item) => normalizeId(item.id) !== normalizeId(optionId));
    if (option) {
      menu.options.push(this.normalizeOption(option));
      menu.options = sortOptions(menu.options);
    }
    this.menus.set(key, menu);
  }
}

/** Creates a mutable plugin menu registry. */
export function createMenuRegistry(initial: PluginMenuDefinition[] = []): PluginMenuRegistry {
  return new PluginMenuRegistryImpl(initial);
}
