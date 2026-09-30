import { spawn } from "node:child_process";
import workerd from "workerd";
// Only trusted supervisor configuration is mounted. App modules are loaded in network-disabled isolates.
const child = spawn(
  workerd.default,
  [
    "serve",
    "--experimental",
    "/app/workerd.capnp",
    "--directory-path=data=/data",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
