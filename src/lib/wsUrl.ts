/**
 * Derive the WebSocket URL from the current browser location.
 * - Local dev (port 3000): connect to ws://localhost:3001
 * - Production (single-port): upgrade on the same host at /ws
 */
export function getWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3001';

  const { hostname, port, protocol } = window.location;

  // Local development: Next.js on 3000, WS server on 3001
  if (port === '3000') {
    return `ws://${hostname}:3001`;
  }

  // Production: combined server, upgrade at /ws
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}/ws`;
}
