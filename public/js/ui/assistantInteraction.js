// One accepted click owns the voice and motion until both finish. Closing text is independent.
export function createAssistantInteraction(onBusy = () => {}) {
  let active = null;
  const release = (turn, part) => {
    if (active !== turn) return;
    turn[part] = true;
    if (turn.speech && turn.motion) { active = null; onBusy(false); }
  };
  return {
    get busy() { return active !== null; },
    begin() {
      if (active) return null;
      const turn = active = { speech: false, motion: false };
      onBusy(true);
      return { speechDone: () => release(turn, 'speech'), motionDone: () => release(turn, 'motion') };
    },
    cancel() { if (active) { active = null; onBusy(false); } },
  };
}
