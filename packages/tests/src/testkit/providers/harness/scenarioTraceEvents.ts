import type { ProviderProtocol, ProviderScenario, ProviderTraceEvent, ProviderUnderTest } from '../types';
import { filterImportedTraceEvents } from '../satisfaction/traceSatisfaction';

function resolveTraceProtocols(params: {
  provider: Pick<ProviderUnderTest, 'protocol'>;
  scenario: Pick<ProviderScenario, 'traceProtocols'>;
}): readonly string[] {
  const protocols = params.scenario.traceProtocols;
  if (Array.isArray(protocols) && protocols.length > 0) {
    return protocols;
  }
  return [params.provider.protocol];
}

export function filterScenarioRelevantTraceEvents(params: {
  provider: Pick<ProviderUnderTest, 'protocol' | 'traceProvider'>;
  scenario: Pick<ProviderScenario, 'traceProtocols'>;
  events: ProviderTraceEvent[];
}): ProviderTraceEvent[] {
  const protocols = new Set(resolveTraceProtocols(params));
  return filterImportedTraceEvents(params.events).filter(
    (event) =>
      event?.v === 1 &&
      protocols.has(event.protocol as ProviderProtocol) &&
      (typeof event.provider === 'string' ? event.provider === params.provider.traceProvider : false),
  );
}
