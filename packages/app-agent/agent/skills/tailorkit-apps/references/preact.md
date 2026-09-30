# Preact composition, state, and performance

## Compose local components

### Keep responsibilities clear

- Start with a view and a few focused components. Extract a row, editor, or
  repeated section when it has a distinct responsibility. Do not build a generic
  component framework for one small app.
- Prefer explicit components or a typed mode to interacting flags such as
  `isEditing`, `isDetail`, and `isCompact`. Independent booleans such as a
  supported `disabled` prop are fine; the problem is contradictory modes.
- Define components at module scope. Defining an editor inside its parent
  creates a new component identity on each render and can lose draft state.
- Keep registration, domain logic, integration adapters, and presentation
  separate only where that improves clarity or real reuse.

### Give shared state one owner

Put selection and drafts at the nearest common ancestor that needs them. Pass
typed data and local callbacks to children. A list and its detail editor should
not keep independent copies of the same selected record.

Use local Preact context only when several descendants need the same state.
Use `createContext` from `preact` and `.Provider` with `useContext` from
`preact/hooks`. A small view usually needs simple props, not a global provider.
A provider can expose typed state/actions without coupling every child to the
storage implementation.

### Respect the remote boundary

Local components may use children and render functions to compose generated UI.
Generated components accept children only if their binding declares them. A
local `renderItem` function cannot be passed through an ordinary remote data prop;
only declared callbacks cross that boundary as functions.

Good: a local task list owns selection, a local row receives `item` and
`onSelect`, and the row renders generated controls.

Poor: a local wrapper renders HTML to invent a missing host layout; a universal
editor has many conflicting boolean flags; a remote component receives a DOM ref
or JSX through a plain object prop.

Vercel's composition ideas apply to local component architecture. React 19
`use`, React DOM, and Next.js examples are not TailorKit app APIs. Follow the
installed Preact version and generated contract.

## Preact state, async work, and performance

Use public hooks from the installed Preact version, normally `preact/hooks`.
Call hooks unconditionally at component/custom-hook top level.

### State correctness first

- Store user inputs and identity; derive filtered items, counts, and selected
  records from current inputs. Do not synchronize duplicate derived state with
  effects.
- Use immutable updates and functional setters when changes depend on prior state.
  Use stable record IDs as keys; index keys can attach a draft to the wrong row.
- Keep drafts separate from saved data. Cancel discards drafts, failed Save keeps
  them, and successful Save uses the confirmed result.
- Put user-triggered writes in callbacks. An effect watching a submitted flag
  can repeat a mutation after an unrelated dependency changes.
- Use effects to synchronize reads/subscriptions, with correct dependencies and
  cleanup. Ignore stale results or cancel supported requests on context changes
  and unmount. A previous record's data must not flash in the new record's view.
- Represent exclusive request states with a typed status union instead of flags
  that permit loading, failure, and success simultaneously.

### Optimize the work that matters

1. Start independent reads together. Keep dependent reads and ordered writes
   sequential. Use partial results only when the UI can represent their failures.
2. Avoid fetching from render, duplicate requests, and fetching on every keystroke
   without a reason. Keep read adapters stable so effects do not loop.
3. Bound large rendered lists when the host offers suitable pagination or an
   equivalent useful view. Large trees and props also cost serialization across
   the remote UI boundary; CSS hiding does not solve that cost.
4. Keep dependencies small and Preact-compatible. Memoize expensive work when
   there is a reason; avoid memoizing every value or trivial expression.

Do not import a DOM form library, browser router, React Server Components,
React DOM, or Next.js caching/hydration APIs to follow a React example.
DOM virtualization and measurements in the iframe cannot manage host layout.
Local value refs are fine for request IDs or duplicate-write guards; DOM refs
cannot focus or read a host-rendered input.

## Focused state and async patterns

These snippets describe local logic. Import hooks from `preact/hooks`; connect
them to generated controls and verified integrations with their actual types.

### Derive rather than synchronize

```ts
const [query, setQuery] = useState("");
const [selectedId, setSelectedId] = useState<string | null>(null);
const normalized = query.trim().toLowerCase();
const visible = items.filter((item) => item.title.toLowerCase().includes(normalized));
const selected = items.find((item) => item.id === selectedId) ?? null;
```

Keep the query and selection ID as state. Filtering and totals are derived.
In a write-success callback, update from the current list:

```ts
setItems((current) => current.map((item) => (item.id === saved.id ? saved : item)));
```

Do not replace newer changes with a list captured before an async request.

### Scope a read to the current record

```ts
type Result<T> =
  | { status: "loading"; recordId: string }
  | { status: "ready"; recordId: string; data: T }
  | { status: "error"; recordId: string };

useEffect(() => {
  let active = true;
  setResult({ status: "loading", recordId });
  void loadRecord(recordId).then(
    (data) => {
      if (active) setResult({ status: "ready", recordId, data });
    },
    () => {
      if (active) setResult({ status: "error", recordId });
    },
  );
  return () => {
    active = false;
  };
}, [recordId, loadRecord]);
```

Keep `loadRecord` stable. Render loading whenever the result's record ID differs
from the current context, even before the effect starts. Abort the request too
if the transport supports it. The cleanup guard remains useful when cancellation
is unavailable.

### Drafts and writes

Initialize an editor's draft from the saved record. A keyed local editor
(`key={record.id}`) can reset it on record changes. A callback should validate,
mark pending, call the supported save adapter, and update committed data only on
success. Clear pending in `finally`; do not clear the draft or show success there.
Cancel discards the draft without mutating the saved record.

Guard repeated writes with a local ref when necessary; a rendered pending flag
alone may not stop two callbacks before the next render. If a write completes
after switching records, update only that record's data and avoid overwriting the
current editor. Do not retry an ambiguous write blindly.

### Parallel reads

```ts
const [summary, history] = await Promise.all([loadSummary(recordId), loadHistory(recordId)]);
```

Use this when both results are required and independent. If one depends on the
other, await the dependency first. If partial success is useful, handle each
`Promise.allSettled` result and show failures explicitly. Ordered writes to the
same record should not be parallelized just for speed.
