import { defineView } from "tailorkit/client";
import { useAction, useMutation, useQuery } from "tailorkit/client";
import { useState } from "preact/hooks";
import { api, Box, Button, Flex, Input } from "#tailorkit";
import type { Todo } from "../db";

const view = defineView({ slot: "panel", view: "/", component: TodoView });

function TodoView() {
  const todos = useQuery(api.list);
  const add = useMutation(api.add);
  const importTodo = useAction(api.importTodo);
  const rows = todos.data ?? [];
  const openCount = rows.filter((todo) => !todo.done).length;
  const error = todos.error ?? add.error ?? importTodo.error;
  const pending = add.isPending || importTodo.isPending;

  return (
    <Box padding="md" width="full" overflowWrap="anywhere">
      <Flex direction="column" gap="md">
        <Box>Todo · {openCount} open</Box>
        {todos.isLoading && <Box>Loading todos…</Box>}
        {error && <Box>{error.message}</Box>}
        {pending && <Box>Saving…</Box>}
        {todos.isSuccess && !pending && (
          <Flex direction="column" gap="xs">
            <Button onClick={() => add.mutate({ text: `Todo ${rows.length + 1}` })}>
              Add todo
            </Button>
            <Button variant="secondary" onClick={() => importTodo.execute()}>
              Import a sample todo
            </Button>
          </Flex>
        )}
        {todos.isSuccess && rows.length === 0 && <Box>No todos yet. Add one to get started.</Box>}
        {rows.map((todo) => (
          <TodoRow key={todo.id} todo={todo} />
        ))}
      </Flex>
    </Box>
  );
}

function TodoRow({ todo }: { todo: Todo }) {
  const [draft, setDraft] = useState<string>();
  const update = useMutation(api.update, { onSuccess: () => setDraft(undefined) });
  const toggle = useMutation(api.toggle);
  const remove = useMutation(api.remove);
  const text = draft ?? todo.text;
  const pending = update.isPending || toggle.isPending || remove.isPending;
  const error = update.error ?? toggle.error ?? remove.error;
  const canSave = text.trim().length > 0 && text.trim().length <= 500 && text.trim() !== todo.text;

  return (
    <Box border="solid" borderColor="default" padding="sm" radius="sm" width="full">
      <Flex direction="column" gap="sm">
        <Box>{todo.done ? "Done" : "Open"}</Box>
        {pending ? (
          <Box>Saving…</Box>
        ) : (
          <Input value={text} onValueChange={({ value }) => setDraft(value)} />
        )}
        {error && <Box>{error.message}</Box>}
        {!pending && (
          <Flex direction="column" gap="xs">
            {canSave && <Button onClick={() => update.mutate({ id: todo.id, text })}>Save</Button>}
            {(text.trim().length === 0 || text.trim().length > 500) && (
              <Box>Use between 1 and 500 characters.</Box>
            )}
            <Button onClick={() => toggle.mutate({ id: todo.id })}>
              {todo.done ? "Reopen" : "Complete"}
            </Button>
            <Button variant="secondary" onClick={() => remove.mutate({ id: todo.id })}>
              Delete
            </Button>
          </Flex>
        )}
      </Flex>
    </Box>
  );
}

export default view;
