import { describe, expect, it } from 'vitest';

import { buildFileTree, type FileNode } from './file-tree.js';

const shape = (nodes: FileNode[]): unknown[] =>
  nodes.map(n => (n.file ? n.label : { [n.label]: shape(n.children) }));

describe('buildFileTree', () => {
  it('nests files by folder, folders before files, by name', () => {
    const tree = buildFileTree([
      { file: 'src/routes/b/+page.svelte', name: '+page' },
      { file: 'src/App.svelte', name: 'App' },
      { file: 'src/routes/a/+page.svelte', name: '+page' },
      { file: 'src/routes/+layout.svelte', name: '+layout' },
    ]);
    expect(shape(tree)).toEqual([
      {
        src: [
          { routes: [{ a: ['+page.svelte'] }, { b: ['+page.svelte'] }, '+layout.svelte'] },
          'App.svelte',
        ],
      },
    ]);
  });

  it('merges folder chains with a single child folder into one row', () => {
    const tree = buildFileTree([
      { file: 'src/lib/components/A.svelte', name: 'A' },
      { file: 'src/lib/components/B.svelte', name: 'B' },
    ]);
    expect(shape(tree)).toEqual([{ 'src/lib/components': ['A.svelte', 'B.svelte'] }]);
    expect(tree[0]!.key).toBe('src/lib/components/');
  });

  it('merges chains below a folder with siblings and chains that end in one file', () => {
    const tree = buildFileTree([
      { file: 'src/lib/a/b/X.svelte', name: 'X' },
      { file: 'src/App.svelte', name: 'App' },
    ]);
    expect(shape(tree)).toEqual([{ src: [{ 'lib/a/b': ['X.svelte'] }, 'App.svelte'] }]);
  });

  it('keeps folder keys apart from file keys and reads Windows separators', () => {
    const tree = buildFileTree([
      { file: 'a\\X.svelte', name: 'X' },
      { file: 'b\\Y.svelte', name: 'Y' },
    ]);
    expect(tree.map(n => n.key)).toEqual(['a/', 'b/']);
    expect(tree[0]!.children[0]!.key).toBe('a\\X.svelte');
  });

  it('labels a path without a file name with the path itself', () => {
    const tree = buildFileTree([{ file: '/', name: 'X' }]);
    expect(tree.map(n => [n.key, n.label])).toEqual([['/', '/']]);
  });
});
