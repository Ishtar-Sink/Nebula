/**
 * Keeping the OS media controls alive across a track change.
 *
 * Chrome hangs the system media controls off an element that has actually played the resource
 * it currently holds. Skipping while paused replaces `src` with something that has never
 * played, so the controls disappear and the next key press goes nowhere — which is why the
 * play key looked dead right after skipping a paused track.
 *
 * Playing muted for one turn is enough to re-register the new resource. The audible cost is
 * nil: `pause()` lands before the element renders a frame.
 */
export function primeSilently(el: HTMLAudioElement, stillPaused: () => boolean): void {
  const wasMuted = el.muted;
  const restore = () => { el.muted = wasMuted; };

  let started: Promise<void> | undefined;
  el.muted = true;
  try {
    started = el.play();
  } catch {
    restore();
    return;
  }
  if (!started) { restore(); return; }

  void started
    .then(() => {
      // A real play command may have arrived while this was in flight — pausing then would
      // silence a track the listener just started.
      if (stillPaused()) el.pause();
      restore();
    })
    // NotAllowedError (no gesture yet) and AbortError (a newer src won) are both fine here:
    // there is simply nothing to keep alive.
    .catch(restore);
}
