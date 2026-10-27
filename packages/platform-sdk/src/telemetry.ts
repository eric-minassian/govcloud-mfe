import type { ClientEvent } from '@govcloud-mfe/contracts';

const reported = new Set<string>();

/**
 * Reports a client-side failure to the frontend API, which turns it into the `ClientErrors`
 * CloudWatch metric for the app. That metric's alarm is what the pipeline watches after a deploy
 * and what AppConfig watches during a flag rollout — so a bad release rolls itself back.
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
