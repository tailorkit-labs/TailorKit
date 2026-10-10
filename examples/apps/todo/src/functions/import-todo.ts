import type {} from "../tailorkit.gen";
import { AppError, tk } from "tailorkit/server";
import { z } from "zod";
import { todoText } from "../db";
import * as todos from "./todos";

export const importTodo = tk.action
  .functions(todos)
  .handler(async ({ mutations, tools, signal }) => {
    const response = await fetch("https://jsonplaceholder.typicode.com/todos/1", { signal });
    if (!response.ok) throw new AppError("UNAVAILABLE", "Could not import todo");
    const data = z.object({ title: todoText }).parse(await response.json());
    const text = await tools.echo(data.title);
    return mutations.add({ text });
  });
