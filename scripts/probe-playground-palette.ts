import { writeFileSync } from 'node:fs';
import preprocessing from '../src/data/nodes/definitions/preprocessing';
import augmentation from '../src/data/nodes/definitions/augmentation';
import { nodeToOperatorDefinition } from '../src/lib/playground/operatorPaletteData';
import { createOperatorFromDefinition, unifiedToPlaygroundStep } from '../src/lib/playground/operatorFormat';

// Feed the exact renderer conversion into the scientific facade probe.
const nodes = [...preprocessing.filter(node => node.tier !== 'advanced'), ...augmentation];
const cases = nodes.map(node => {
  const type = node.type === 'preprocessing' ? 'preprocessing' : 'augmentation';
  const selected = createOperatorFromDefinition(nodeToOperatorDefinition(node, type));
  if (type === 'augmentation') selected.params.n_augmented_copies = 1;
  if ('random_state' in selected.params) selected.params.random_state = 42;
  return { id: node.id, step: unifiedToPlaygroundStep(selected) };
});
writeFileSync(process.argv[2], JSON.stringify(cases));
