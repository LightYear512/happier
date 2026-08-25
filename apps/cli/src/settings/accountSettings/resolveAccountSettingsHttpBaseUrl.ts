import { resolveRuntimeServerHttpBaseUrl } from '@/session/transport/http/serverHttpBaseUrl';

export function resolveAccountSettingsHttpBaseUrl(): string {
  return resolveRuntimeServerHttpBaseUrl();
}
