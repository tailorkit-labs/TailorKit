import { defineServer } from "tailorkit/server";
import * as todos from "./functions/todos";
import { importTodo } from "./functions/import-todo";

const app = defineServer({ ...todos, importTodo });

export default app;
