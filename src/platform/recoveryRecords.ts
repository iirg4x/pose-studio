/** Immutable source bytes owned by a single validated opening operation. */
export interface ProjectRecoverySource {
  readonly bytes: Uint8Array | Blob;
  readonly clipIds: ReadonlySet<string>;
}
