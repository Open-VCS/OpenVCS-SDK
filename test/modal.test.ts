// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ModalBuilder } from '../src/lib/runtime/index.js';

describe('ModalBuilder', () => {
  it('builds a structured modal definition', () => {
    const modal = new ModalBuilder('Manage Submodules')
      .text('Hello, World!')
      .verticalBox([
        {
          type: 'input',
          id: 'path',
          label: 'Submodule Path',
          placeholder: 'libs/example',
        },
        {
          type: 'grid',
          columns: 'minmax(0, 1fr) minmax(0, 1fr)',
          content: [
            {
              type: 'input',
              id: 'name',
              label: 'Submodule Name',
              placeholder: 'example',
            },
            {
              type: 'input',
              id: 'branch',
              label: 'Branch (optional)',
              placeholder: 'main',
            },
          ],
        },
      ])
      .horizontalBox(
        [
          { type: 'button', id: 'new-button', content: 'Test button, push me!', align: 'centered' },
          { type: 'button', id: 'secondary-button', content: 'Refresh' },
        ],
        { align: 'centered', wrap: true },
      )
      .build();

    assert.deepStrictEqual(modal, {
      title: 'Manage Submodules',
      content: [
        { type: 'text', content: 'Hello, World!' },
        {
          type: 'vertical-box',
          content: [
            {
              type: 'input',
              id: 'path',
              label: 'Submodule Path',
              placeholder: 'libs/example',
            },
            {
              type: 'grid',
              columns: 'minmax(0, 1fr) minmax(0, 1fr)',
              content: [
                {
                  type: 'input',
                  id: 'name',
                  label: 'Submodule Name',
                  placeholder: 'example',
                },
                {
                  type: 'input',
                  id: 'branch',
                  label: 'Branch (optional)',
                  placeholder: 'main',
                },
              ],
            },
          ],
        },
        {
          type: 'horizontal-box',
          align: 'centered',
          wrap: true,
          content: [
            { type: 'button', id: 'new-button', content: 'Test button, push me!', align: 'centered' },
            { type: 'button', id: 'secondary-button', content: 'Refresh' },
          ],
        },
      ],
    });
  });
});
