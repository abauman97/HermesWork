import { host } from "@hermes/plugin-sdk";

/** A sticky fence: returning to the same location does not revive old work. */
export function watchNavigation() {
  const hash = window.location.hash;
  const profile = host.state.profile.get();
  const connection = host.state.connectionId.get();
  let changed = false;
  const mark = () => {
    changed = true;
  };
  window.addEventListener("hashchange", mark);
  function track<T>(atom: { subscribe(cb: (value: T) => void): () => void }) {
    let initial = true;
    return atom.subscribe(() => {
      if (!initial) mark();
      initial = false;
    });
  }
  const unsubProfile = track(host.state.profile);
  const unsubConnection = track(host.state.connectionId);
  return {
    current: () =>
      !changed &&
      window.location.hash === hash &&
      host.state.profile.get() === profile &&
      host.state.connectionId.get() === connection,
    dispose: () => {
      window.removeEventListener("hashchange", mark);
      unsubProfile();
      unsubConnection();
    },
  };
}
