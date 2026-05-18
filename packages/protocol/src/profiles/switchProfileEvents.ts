export type SwitchProfileEvent =
  | { type: 'switch_pending'; targetProfileId: string }
  | { type: 'switch_complete'; targetProfileId: string }
  | { type: 'switch_interrupted'; reason: 'turn_in_progress' | 'spawn_failed'; targetProfileId: string };
