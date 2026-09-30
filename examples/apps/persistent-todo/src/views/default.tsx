import { createView } from "tailorkit/app";
import { createAppStorageClient } from "@tailorkit/app-storage";
import { useEffect, useState } from "preact/hooks";
import { Box, Button, Flex } from "#tailorkit";
import { api } from "../storage.gen";

const storage = createAppStorageClient();
const view = createView("/", { component: View });
function View() {
  const [todos, setTodos] = useState<{ id: string; text: string; done: boolean }[]>([]);
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      storage.subscribe(api.list, {}, setTodos, {
        onStatus: setStatus,
        onError: (failure) => setError(failure.message),
      }),
    [],
  );
  const mutate = (action: Promise<unknown>) => {
    void action.catch((error) => setError(String(error)));
  };
  return (
    <Box padding="md">
      <Flex direction="column" gap="md">
        <Box>Persistent todos · {status}</Box>
        {error && <Box>{error}</Box>}
        <Button
          onClick={() => mutate(storage.mutate(api.add, { text: `Todo ${todos.length + 1}` }))}
        >
          Add todo
        </Button>
        {todos.map((todo) => (
          <Flex key={todo.id} direction="column" gap="xs">
            <Box>
              {todo.done ? "Done: " : "Open: "}
              {todo.text}
            </Box>
            <Button onClick={() => mutate(storage.mutate(api.toggle, { id: todo.id }))}>
              {todo.done ? "Reopen" : "Complete"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => mutate(storage.mutate(api.remove, { id: todo.id }))}
            >
              Delete
            </Button>
          </Flex>
        ))}
      </Flex>
    </Box>
  );
}
export default view;
