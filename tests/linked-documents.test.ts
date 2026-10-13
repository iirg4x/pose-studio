import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateDocument,
  documentIdentity,
  documentRevision,
  linkedDocument,
  openedDocument,
  rememberDocument,
} from '../src/platform/linkedDocuments';
import type { AnimationLibrary } from '../src/core/library';
const library = { clips: [{ id: 'reload' }, { id: 'equip' }] } as AnimationLibrary;
const source = {
  uri: 'content://private-drive/document/123',
  name: 'Weapons.pose',
  hash: 'a'.repeat(64),
  identity: documentIdentity(library),
};
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());
describe('private project document links', () => {
  it('does not put account-specific document addresses into saved or exported projects', () => {
    rememberDocument(library, source);
    expect(openedDocument(library)).toEqual(source);
    expect(JSON.stringify(library)).not.toContain('content://');
    expect(openedDocument(structuredClone(library))).toBeUndefined();
  });
  it('activates only the accepted document and clears it for a new project', () => {
    rememberDocument(library, source);
    expect(linkedDocument(library)).toBeUndefined();
    activateDocument(source);
    expect(linkedDocument(library)).toEqual(source);
    expect(
      linkedDocument({
        ...library,
        clips: [...library.clips, { id: 'new-local-action' } as AnimationLibrary['clips'][number]],
      }),
    ).toEqual(source);
    expect(linkedDocument({ clips: [{ id: 'other' }] } as AnimationLibrary)).toBeUndefined();
    activateDocument();
    expect(linkedDocument(library)).toBeUndefined();
  });
  it('recognizes the same library despite tab order, and handles ignored revisions separately from the saved baseline', () => {
    expect(documentIdentity({ ...library, clips: [...library.clips].reverse() })).toBe(
      source.identity,
    );
    expect(documentRevision(source, source.hash)).toBe(false);
    expect(documentRevision(source, 'b'.repeat(64))).toBe(true);
    expect(documentRevision({ ...source, ignoredHash: 'b'.repeat(64) }, 'b'.repeat(64))).toBe(
      false,
    );
    expect(documentRevision({ ...source, ignoredHash: 'b'.repeat(64) }, 'c'.repeat(64))).toBe(true);
  });
});
