import { type SelectionResultSchema } from '@figma-agent/protocol';
import type { z } from 'zod';

import { serializeNodeSummary } from '../serialization/node-summary.js';

type SelectionResult = z.infer<typeof SelectionResultSchema>;

export function getSelection(): SelectionResult {
  return {
    page: { id: figma.currentPage.id, name: figma.currentPage.name },
    selection: figma.currentPage.selection.map(serializeNodeSummary),
  };
}

