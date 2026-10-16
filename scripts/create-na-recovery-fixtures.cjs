/** Deterministic, artificial datasets for automated and hands-on import QA. */
const fs = require('node:fs');
const path = require('node:path');

function createFixtures(destination) {
  fs.mkdirSync(destination, { recursive: true });
  const cases = [
    { name: 'clean' },
    { name: 'sparse-targets', sparse: true },
    { name: 'missing-spectra', sparse: true, missingX: true },
    { name: 'sparse-classes', sparse: true, classification: true },
    { name: 'decimal-comma', sparse: true, decimal: ',' },
    { name: 'headerless', sparse: true, headerless: true },
  ];
  const expected = {};
  for (const spec of cases) {
    const directory = path.join(destination, spec.name);
    fs.mkdirSync(directory, { recursive: true });
    const write = (filename, header, rows) => fs.writeFileSync(path.join(directory, filename),
      [...(spec.headerless ? [] : [header]), ...rows].map(row => row.join(';')).join('\r\n') + '\r\n');
    const number = value => value.toFixed(5).replace('.', spec.decimal ?? '.');
    for (const [partition, start, length] of [['cal', 0, 36], ['val', 36, 12]]) {
      const x = [], y = [], metadata = [];
      let missingY = 0, missingM = 0, missingX = 0;
      for (let row = 0; row < length; row++) {
        const index = start + row;
        const spectrum = Array.from({ length: 16 }, (_, col) => number(2 + index * 0.05 + Math.sin(col / 3 + index / 20)));
        if (spec.missingX && row === 5) { spectrum[4] = 'NA'; missingX++; }
        x.push(spectrum);
        const targets = spec.classification ? [index % 2 ? 'pass' : 'fail'] : [number(1 + index * 0.3), number(5 + index * 0.1)];
        if (spec.sparse && row % 7 === 2) { targets[0] = ['', 'NA', 'NaN', 'N/A', 'null'][Math.floor(row / 7) % 5]; missingY++; }
        if (spec.sparse && !spec.classification && row % 11 === 3) { targets[1] = ''; missingY++; }
        y.push(targets);
        const meta = [`sample-${String(index).padStart(3, '0')}`, `batch-${index % 3}`];
        if (spec.sparse && row % 9 === 4) { meta[1] = ''; missingM++; }
        metadata.push(meta);
      }
      write(`X${partition}.csv`, Array.from({ length: 16 }, (_, col) => String(1000 + col * 10)), x);
      write(`Y${partition}.csv`, spec.classification ? ['class'] : ['protein', 'fat'], y);
      write(`M${partition}.csv`, ['sample_id', 'batch'], metadata);
      expected[`${spec.name}/${partition}`] = { rows: length, features: 16, targets: spec.classification ? 1 : 2, missingY, missingM, missingX };
    }
  }
  fs.writeFileSync(path.join(destination, 'expected.json'), JSON.stringify(expected, null, 2));
  return expected;
}
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Provide a QA output directory');
  const destination = path.resolve(process.argv[2]);
  console.log(JSON.stringify({ destination, expected: createFixtures(destination) }, null, 2));
}
module.exports = { createFixtures };
