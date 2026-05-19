import {
  createSessionDevPreviewRegistry,
  type SessionDevPreviewRegistry,
} from './createSessionDevPreviewRegistry';

let sharedRegistry: SessionDevPreviewRegistry | null = null;

export function getSharedSessionDevPreviewRegistry(): SessionDevPreviewRegistry {
  if (sharedRegistry) {
    return sharedRegistry;
  }
  sharedRegistry = createSessionDevPreviewRegistry();
  return sharedRegistry;
}
