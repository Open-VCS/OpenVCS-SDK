// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ModalBuilder } from '../src/lib/runtime/index.js';

describe('ModalBuilder', () => {
  it('builds a structured modal definition', () => {
    const modal = new ModalBuilder('Manage Submodules')
      .text('Hello, World!')
      .button('new-button', 'Test button, push me!', { align: 'centered' })
      .build();

    assert.deepStrictEqual(modal, {
      title: 'Manage Submodules',
      content: [
        { type: 'text', content: 'Hello, World!' },
        { type: 'button', id: 'new-button', content: 'Test button, push me!', align: 'centered' },
      ],
    });
  });
});
