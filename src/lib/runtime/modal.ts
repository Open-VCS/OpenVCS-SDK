// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  ModalButtonDefinition,
  ModalButtonVariant,
  ModalContentAlign,
  ModalInputDefinition,
  ModalInputKind,
  ModalListDefinition,
  ModalListRowDefinition,
  ModalSelectDefinition,
  ModalSelectOptionDefinition,
  PluginModalContentItem,
  PluginModalDefinition,
} from '../types/modal.js';

import { invoke } from './menu.js';

/** Describes the options accepted by `ModalBuilder.button()`. */
export interface ModalBuilderButtonOptions {
  /** Stores the optional tooltip text. */
  title?: string;
  /** Stores the visual button variant. */
  variant?: ModalButtonVariant;
  /** Stores the alignment hint. */
  align?: ModalContentAlign;
  /** Stores a static payload merged into the action payload. */
  payload?: Record<string, unknown>;
}

/** Describes the options accepted by `ModalBuilder.text()`. */
export interface ModalBuilderTextOptions {
  /** Stores the optional tooltip text. */
  title?: string;
  /** Stores the alignment hint. */
  align?: ModalContentAlign;
}

/** Describes the options accepted by `ModalBuilder.input()`. */
export interface ModalBuilderInputOptions {
  /** Stores the input kind. */
  kind?: ModalInputKind;
  /** Stores the default value. */
  value?: string;
  /** Stores the placeholder text. */
  placeholder?: string;
  /** Stores whether the field is required. */
  required?: boolean;
  /** Stores the alignment hint. */
  align?: ModalContentAlign;
}

/** Describes the options accepted by `ModalBuilder.select()`. */
export interface ModalBuilderSelectOptions {
  /** Stores the available options. */
  options: ModalSelectOptionDefinition[];
  /** Stores the default value. */
  value?: string;
  /** Stores the alignment hint. */
  align?: ModalContentAlign;
}

/** Describes the options accepted by `ModalBuilder.list()`. */
export interface ModalBuilderListOptions {
  /** Stores the list label. */
  label?: string;
  /** Stores the empty-state text. */
  emptyText?: string;
  /** Stores the alignment hint. */
  align?: ModalContentAlign;
  /** Stores the list rows. */
  items: ModalListRowDefinition[];
}

/** Builds a structured modal definition with a fluent class API. */
export class ModalBuilder {
  private readonly definition: PluginModalDefinition;

  /** Creates a new modal builder with the provided title. */
  constructor(title: string) {
    this.definition = {
      title: String(title || '').trim(),
      content: [],
    };
  }

  /** Adds a text block to the modal body. */
  text(content: string, options: ModalBuilderTextOptions = {}): this {
    this.definition.content.push({
      type: 'text',
      content: String(content || ''),
      ...(options.title ? { title: options.title } : {}),
      ...(options.align ? { align: options.align } : {}),
    });
    return this;
  }

  /** Adds a separator to the modal body. */
  separator(): this {
    this.definition.content.push({ type: 'separator' });
    return this;
  }

  /** Adds a button to the modal body. */
  button(id: string, content: string, options: ModalBuilderButtonOptions = {}): this {
    this.definition.content.push({
      type: 'button',
      id: String(id || '').trim(),
      content: String(content || ''),
      ...(options.title ? { title: options.title } : {}),
      ...(options.variant && options.variant !== 'default' ? { variant: options.variant } : {}),
      ...(options.align ? { align: options.align } : {}),
      ...(options.payload ? { payload: options.payload } : {}),
    });
    return this;
  }

  /** Adds a text input to the modal body. */
  input(id: string, label: string, options: ModalBuilderInputOptions = {}): this {
    this.definition.content.push({
      type: 'input',
      id: String(id || '').trim(),
      label: String(label || '').trim(),
      ...(options.kind ? { kind: options.kind } : {}),
      ...(options.value !== undefined ? { value: options.value } : {}),
      ...(options.placeholder ? { placeholder: options.placeholder } : {}),
      ...(options.required ? { required: true } : {}),
      ...(options.align ? { align: options.align } : {}),
    });
    return this;
  }

  /** Adds a select field to the modal body. */
  select(id: string, label: string, options: ModalBuilderSelectOptions): this {
    this.definition.content.push({
      type: 'select',
      id: String(id || '').trim(),
      label: String(label || '').trim(),
      options: Array.isArray(options.options) ? options.options : [],
      ...(options.value !== undefined ? { value: options.value } : {}),
      ...(options.align ? { align: options.align } : {}),
    });
    return this;
  }

  /** Adds a list block to the modal body. */
  list(id: string, options: ModalBuilderListOptions): this {
    this.definition.content.push({
      type: 'list',
      id: String(id || '').trim(),
      ...(options.label ? { label: options.label } : {}),
      ...(options.emptyText ? { emptyText: options.emptyText } : {}),
      ...(options.align ? { align: options.align } : {}),
      items: Array.isArray(options.items) ? options.items : [],
    });
    return this;
  }

  /** Returns the serialized modal payload. */
  build(): PluginModalDefinition {
    return {
      title: this.definition.title,
      content: this.definition.content.map((item) => ({ ...item })) as PluginModalContentItem[],
    };
  }

  /** Requests the host to open the modal with the current definition. */
  async open(): Promise<void> {
    await invoke('open_plugin_modal', { modal: this.build() });
  }
}
