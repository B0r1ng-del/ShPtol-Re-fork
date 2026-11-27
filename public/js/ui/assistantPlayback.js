// Explicit cancellation invalidates outstanding media loads; normal completion releases the interaction.
export function createAssistantPlayback(makeAudio = url => new Audio(url)) {
  let current = null, generation = 0, settle = null;
  const stop = () => {
    generation++;
    const a = current, done = settle;
    current = null; settle = null;
    if (a) { a.onended = a.onerror = null; a.pause(); a.removeAttribute('src'); a.load(); }
    done?.('cancelled');
  };
  return {
    stop,
    get current() { return current; },
    play(url, settings = {}) {
      stop();
      if (!url) return Promise.resolve('silent');
      const token = generation;
      return new Promise(resolve => {
        let a;
        try { a = makeAudio(url); } catch { resolve('error'); return; }
        current = a; settle = resolve;
        const finish = result => {
          if (token !== generation || current !== a) return;
          current = null; settle = null; a.onended = a.onerror = null;
          resolve(result);
        };
        a.onended = () => finish('ended'); a.onerror = () => finish('error');
        a.muted = !!settings.muted; a.volume = Math.max(0, Math.min(1, settings.voice ?? .8)) ** 2;
        try {
          Promise.resolve(a.play()).then(() => {
            if (token !== generation) { a.pause(); a.removeAttribute('src'); a.load(); }
          }).catch(() => finish('error'));
        } catch { finish('error'); }
      });
    },
    volume(settings) { if (current) { current.muted = !!settings.muted; current.volume = Math.max(0, Math.min(1, settings.voice ?? .8)) ** 2; } },
  };
}
