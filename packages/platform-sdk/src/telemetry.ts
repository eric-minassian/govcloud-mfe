import type { ClientEvent } from '@govcloud-mfe/contracts';

const reported = new Set<string>();

/**
 * Reports a client-side failure to the frontend API, which turns it into the `ClientErrors`
 * CloudWatch metric for the module (or `web`). The delivery pipeline's bake watches every
 * module's alarm, and each module's alarm guards its own flag rollouts, so a bad release or a bad
 * flag rolls itself back and the alarm name says whose module it was.
 *
 * Fire-and-forget: telemetry must never break the page. Duplicate events are sent once per page
 * load so a render loop can't flood the metric.
 */
export function reportClientEvent(event: ClientEvent): void {
  const fingerprint = `${event.type}|${event.app}|${event.message}`;
  if (reported.has(fingerprint)) return;
  reported.add(fingerprint);

  fetch('/api/client-events', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [{ ...event, message: event.message.slice(0, 500) }] }),
    // Lets the request finish even if the page is being unloaded.
    keepalive: true,
  }).catch(() => {
    // Nothing useful to do; the page is already in a degraded state.
  });
}
