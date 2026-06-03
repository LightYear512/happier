export function parseBootedAndroidAdbSerials(output: string): readonly string[] {
  const serials: string[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('List of devices')) continue;
    const [serial, state] = trimmed.split(/\s+/u);
    if (serial && state === 'device') {
      serials.push(serial);
    }
  }
  return serials;
}

export function parseAndroidEmulatorAvdName(output: string): string {
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'OK') continue;
    return trimmed;
  }
  return '';
}
