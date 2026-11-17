// Add ?diag to the URL for a panel listing what the page couldn't do and each WebGL take's state.
// For phones, which have no dev tools: a screenshot of the panel is the bug report. It only reads
// this page's own state and sends nothing anywhere.

/** each WebGL take's state, written by sections/index.ts */
export const takeState: Record<string, string> = {};

export function initDiag(): void {
  if (!/[?&]diag\b/.test(location.search)) return;
  const lines: string[] = [];
  const note = (s: string) => {
    lines.push(s.slice(0, 240));
    if (lines.length > 12) lines.shift();
  };
  addEventListener('error', (e) => note(`error: ${e.message} (${String(e.filename).split('/').pop()}:${e.lineno})`));
  addEventListener('unhandledrejection', (e) => note(`rejection: ${String((e.reason as Error)?.message ?? e.reason)}`));
  const consoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    note(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
    consoleError(...args);
  };
  // the GPU as the page sees it, from a throwaway context
  let gpu = 'no WebGL2';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch (err) {
    gpu = `WebGL2 threw: ${(err as Error).message}`;
  }
  const el = document.createElement('pre');
  el.className = 'diag';
  document.body.appendChild(el);
  setInterval(() => {
    el.textContent = [
      `${innerWidth}×${innerHeight} @${devicePixelRatio}x · ${gpu}`,
      navigator.userAgent,
      ...Object.entries(takeState).map(([k, v]) => `${k}: ${v}`),
      ...(lines.length ? lines : ['no errors']),
    ].join('\n');
  }, 500);
}
