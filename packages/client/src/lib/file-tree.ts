import type { SvelteFileEntry } from './rpc.js';

/** `file` is null for folders. */
export interface FileNode {
  key: string;
  label: string;
  file: SvelteFileEntry | null;
  children: FileNode[];
}

/**
 * Folder tree of root-relative file paths. A folder whose only child is a
 * folder is merged into one row (`src/lib/components`), like editor explorers.
 */
export function buildFileTree(files: readonly SvelteFileEntry[]): FileNode[] {
  // Folder keys end in '/' so they never collide with a file path.
  const root: FileNode = { key: '/', label: '', file: null, children: [] };
  const folders = new Map<string, FileNode>([['', root]]);
  for (const f of files) {
    // Analyzer paths come from path.relative, so they carry `\` on Windows.
    const parts = f.file.replaceAll('\\', '/').split('/').filter(Boolean);
    const name = parts.pop() ?? f.file;
    let parent = root;
    let dir = '';
    for (const part of parts) {
      dir += part + '/';
      let node = folders.get(dir);
      if (!node) {
        node = { key: dir, label: part, file: null, children: [] };
        folders.set(dir, node);
        parent.children.push(node);
      }
      parent = node;
    }
    parent.children.push({ key: f.file, label: name, file: f, children: [] });
  }
  return finish(root.children);
}

function finish(nodes: FileNode[]): FileNode[] {
  return nodes
    .map(n => {
      let node = n;
      while (!node.file && node.children.length === 1 && !node.children[0]!.file) {
        const only = node.children[0]!;
        node = { ...only, label: `${node.label}/${only.label}` };
      }
      return { ...node, children: finish(node.children) };
    })
    .toSorted((a, b) => Number(!!a.file) - Number(!!b.file) || a.label.localeCompare(b.label));
}
