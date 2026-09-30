# Layout and interaction

## Fit the host surface

- Start with the user's task and the selected slot. In a narrow contextual panel,
  use a clear vertical reading order. Use columns only when the host exposes
  suitable layout components and the slot has room.
- Lead with the information or action needed now. Avoid recreating the host's
  navigation, repeating its record header, or adding unrelated dashboard metrics.
- Group related items with generated layout primitives. Use declared spacing,
  alignment, typography, and semantic tokens. Use tighter gaps inside a group
  and more separation between groups when the contract allows it.
- Keep one clear primary action for the current step. Secondary actions should
  read as secondary using supported variants. Do not invent variant names.
- Use the host's existing shell and content edges; avoid unnecessary nested
  cards and wrapper padding. Prefer a focused list over a chart for a small
  breakdown unless a supported chart helps the task.

## Complete each interaction

| State                    | Useful behavior                                                    |
| ------------------------ | ------------------------------------------------------------------ |
| Loading                  | Feedback in the affected content area; keep useful context visible |
| No records               | Explain the empty state and show a supported first action          |
| No filter matches        | Explain the filter result and offer to clear filters               |
| Editing                  | Clear field labels; separate drafts from committed values          |
| Pending write            | Identify the operation and prevent duplicate submission            |
| Failure or denied access | Explain what failed; retain data/draft and give a real next step   |
| Success                  | Reflect the confirmed result, including whether it was saved       |

Use semantic host components and exposed labels/accessibility props. Prefer clear
text over ambiguous icon-only controls; do not communicate status with color alone.
Check long labels, missing values, and realistic list sizes. Verify keyboard and
focus behavior in the host when available; iframe DOM refs cannot control it.

Skip setup screens when no setup is needed. If a connection or capability is
missing, explain the host UI administrator's next step in plain language. Do not
ship a dead Connect button, fake Save, or an endless spinner.

## Simple layout recipes

These are reading-order guides, not component APIs. Only use names, nesting,
tokens, and interactions supported by the actual host bindings.

### Contextual panel

```text
Short heading or current record context, if useful
Most relevant information
Main action
Related items or supporting details
```

For customer notes, show saved notes and one Add note action. Put the draft near
the task it affects. Preserve it on a failed save. Avoid duplicating the entire
customer profile or building a full application shell inside a sidebar.

### List

```text
Search/filter controls, when needed
List or table of records
Bounded navigation, when supported and needed
```

Keep related fields aligned and row identity stable. Put the record's main label
first, secondary details next, and its actions together. A compact row is better
than a separate card for every field. Use a table only when provided; a vertical
list can be a good supported alternative. Show row-specific pending/error feedback
for row operations. Distinguish no items from no matches.

### Detail or edit

```text
Record name and status
Related field groups
Save and Cancel
Pending/error/success feedback near the action
```

Use one column in narrow slots. Align label/value pairs consistently. Separate
saved data from the draft: Cancel discards edits, and failed Save retains them.
Switching records must reset or deliberately preserve the correct draft. Do not
place an editor inside multiple nested cards or tabs just to add structure.

### Summary

Show only facts that support the requested decision. A small breakdown often
needs a labeled list, not a chart. Use multiple columns or summary tiles only
when useful and supported. Never invent trends or add unrelated modules to fill
space. Prefer useful density and readable grouping over decoration.
