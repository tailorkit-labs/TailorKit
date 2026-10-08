/** Retain equivalent serialized values without involving a framework's rendering API. */
export function createValueMemo<T>() {
  let initialized = false;
  let previousKey: string | undefined;
  let previous: T;
  return (value: T): T => {
    const key = JSON.stringify(value);
    if (!initialized || previousKey !== key) {
      initialized = true;
      previousKey = key;
      previous = value;
    }
    return previous;
  };
}
