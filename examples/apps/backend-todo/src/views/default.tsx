import { createView } from "tailorkit/client";
import { useAction, useMutation, useQuery } from "tailorkit/client";
import { api, Box, Button, Flex } from "#tailorkit";
import { z } from "zod";

const view = createView("/", {
  slot: "page",
  instances: {
    dataSchema: z.object({ todoId: z.string().nullable() }),
    resolve: async ({ queries }) => {
      const todos = await queries.list();
      return [
        { key: "all", metadata: { title: "All todos" }, data: { todoId: null } },
        ...todos.map((todo) => ({
          key: todo.id,
          metadata: { title: todo.text },
          data: { todoId: todo.id },
        })),
      ];
    },
  },
  component: View,
});
function View() {
  const { data } = view.useInstance();
  const todos = useQuery(api.list);
  const add = useMutation(api.add);
  const toggle = useMutation(api.toggle);
  const remove = useMutation(api.remove);
  const importTodo = useAction(api.importTodo);
  const rows = (todos.data ?? []).filter((todo) => data.todoId === null || todo.id === data.todoId);
  const error = todos.error ?? add.error ?? toggle.error ?? remove.error ?? importTodo.error;
  const pending = add.isPending || toggle.isPending || remove.isPending || importTodo.isPending;
  return (
    <Box padding="md">
      <Flex direction="column" gap="md">
        <Box>Persistent todos</Box>
        {todos.isLoading && <Box>Loading…</Box>}
        {error && <Box>{error.message}</Box>}
        {pending && <Box>Saving…</Box>}
        {todos.isSuccess && !pending && (
          <>
            <Button onClick={() => add.mutate({ text: `Todo ${(todos.data?.length ?? 0) + 1}` })}>
              Add todo
            </Button>
            <Button
              onClick={() =>
                importTodo.execute({ url: "https://jsonplaceholder.typicode.com/posts/1" })
              }
            >
              Import from an external API
            </Button>
          </>
        )}
        {rows.map((todo) => (
          <Flex key={todo.id} direction="column" gap="xs">
            <Box>
              {todo.done ? "Done: " : "Open: "}
              {todo.text}
            </Box>
            {!pending && (
              <>
                <Button onClick={() => toggle.mutate({ id: todo.id })}>
                  {todo.done ? "Reopen" : "Complete"}
                </Button>
                <Button variant="secondary" onClick={() => remove.mutate({ id: todo.id })}>
                  Delete
                </Button>
              </>
            )}
          </Flex>
        ))}
      </Flex>
    </Box>
  );
}
export default view;
