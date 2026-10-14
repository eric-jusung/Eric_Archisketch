export function createStore() {
  let shapes = [];
  let past = [];
  let future = [];
  let gesture = null;
  const listeners = new Set();

  function snapshot() {
    return structuredClone(shapes);
  }

  function emit() {
    for (const listener of listeners) listener(shapes);
  }

  return {
    get() {
      return shapes;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(shapes);
      return () => listeners.delete(listener);
    },
    load(next) {
      shapes = structuredClone(next);
      past = [];
      future = [];
      gesture = null;
      emit();
    },
    begin() {
      if (!gesture) gesture = snapshot();
    },
    apply(next) {
      shapes = structuredClone(next);
      emit();
    },
    end() {
      if (!gesture) return;
      if (JSON.stringify(gesture) !== JSON.stringify(shapes)) {
        past.push(gesture);
        future = [];
      }
      gesture = null;
      emit();
    },
    cancel() {
      if (!gesture) return;
      shapes = gesture;
      gesture = null;
      emit();
    },
    commit(next) {
      past.push(snapshot());
      future = [];
      shapes = structuredClone(next);
      gesture = null;
      emit();
    },
    undo() {
      if (gesture || past.length === 0) return false;
      future.push(snapshot());
      shapes = past.pop();
      emit();
      return true;
    },
    redo() {
      if (gesture || future.length === 0) return false;
      past.push(snapshot());
      shapes = future.pop();
      emit();
      return true;
    },
    canUndo() {
      return !gesture && past.length > 0;
    },
    canRedo() {
      return !gesture && future.length > 0;
    },
  };
}
