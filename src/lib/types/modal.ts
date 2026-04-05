// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/** Describes horizontal alignment hints for modal content. */
export type ModalContentAlign = 'left' | 'centered' | 'right';

/** Describes visual emphasis for modal buttons. */
export type ModalButtonVariant = 'default' | 'primary' | 'danger';

/** Describes the text input kinds supported by plugin modals. */
export type ModalInputKind = 'text' | 'search' | 'password' | 'url' | 'number';

/** Describes one button option rendered inside a modal. */
export interface ModalButtonDefinition {
  /** Stores the action id triggered when the button is pressed. */
  id: string;
  /** Stores the button label. */
  content: string;
  /** Stores the optional tooltip text. */
  title?: string;
  /** Stores the visual button variant. */
  variant?: ModalButtonVariant;
  /** Stores the button alignment hint. */
  align?: ModalContentAlign;
  /** Stores a static payload merged into the action payload. */
  payload?: Record<string, unknown>;
}

/** Describes one text block rendered inside a modal. */
export interface ModalTextDefinition {
  /** Always stores `text`. */
  type: 'text';
  /** Stores the block text. */
  content: string;
  /** Stores an optional tooltip. */
  title?: string;
  /** Stores the alignment hint. */
  align?: ModalContentAlign;
}

/** Describes one separator rendered inside a modal. */
export interface ModalSeparatorDefinition {
  /** Always stores `separator`. */
  type: 'separator';
}

/** Describes one button rendered inside a modal body. */
export interface ModalButtonItemDefinition extends ModalButtonDefinition {
  /** Always stores `button`. */
  type: 'button';
}

/** Describes one text input rendered inside a modal. */
export interface ModalInputDefinition {
  /** Always stores `input`. */
  type: 'input';
  /** Stores the input field id. */
  id: string;
  /** Stores the label text. */
  label: string;
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

/** Describes one select option rendered inside a modal. */
export interface ModalSelectOptionDefinition {
  /** Stores the option label. */
  label: string;
  /** Stores the option value. */
  value: string;
  /** Stores whether the option is selected by default. */
  selected?: boolean;
}

/** Describes one select field rendered inside a modal. */
export interface ModalSelectDefinition {
  /** Always stores `select`. */
  type: 'select';
  /** Stores the field id. */
  id: string;
  /** Stores the label text. */
  label: string;
  /** Stores the available options. */
  options: ModalSelectOptionDefinition[];
  /** Stores the default value. */
  value?: string;
  /** Stores the alignment hint. */
  align?: ModalContentAlign;
}

/** Describes one row-level action rendered in a list item. */
export interface ModalListActionDefinition extends ModalButtonDefinition {
  /** Always stores `button`. */
  type: 'button';
}

/** Describes one list row rendered inside a modal list. */
export interface ModalListRowDefinition {
  /** Stores the row id. */
  id: string;
  /** Stores the row title. */
  title: string;
  /** Stores a short status label. */
  status?: string;
  /** Stores a secondary metadata label. */
  meta?: string;
  /** Stores longer descriptive text. */
  description?: string;
  /** Stores the row actions. */
  actions?: ModalListActionDefinition[];
}

/** Describes one list block rendered inside a modal. */
export interface ModalListDefinition {
  /** Always stores `list`. */
  type: 'list';
  /** Stores the list id. */
  id: string;
  /** Stores the list label. */
  label?: string;
  /** Stores the empty-state text. */
  emptyText?: string;
  /** Stores the alignment hint. */
  align?: ModalContentAlign;
  /** Stores the list rows. */
  items: ModalListRowDefinition[];
}

/** Describes one plugin modal content item. */
export type PluginModalContentItem =
  | ModalTextDefinition
  | ModalSeparatorDefinition
  | ModalButtonItemDefinition
  | ModalInputDefinition
  | ModalSelectDefinition
  | ModalListDefinition;

/** Describes the structured payload used to render a plugin modal. */
export interface PluginModalDefinition {
  /** Stores the modal title. */
  title: string;
  /** Stores the ordered list of modal content items. */
  content: PluginModalContentItem[];
}
