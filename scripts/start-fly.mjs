import { spawn } from "node:child_process";

// If either process dies, exit so Fly restarts the whole machine.
const procs = [
  { name: "web", cmd: "node", args: ["web/server.js"], env: { PORT: "3000", HOSTNAME: "0.0.0.0" } },
  { name: "worker", cmd: "node_modules/.bin/tsx", args: ["workers/index.ts"] },
].map(({ name, cmd, args, env }) => {
  const p = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  p.on("exit", (code) => {
    console.error(`[start-fly] ${name} exited with code ${code}`);
    process.exit(code ?? 1);
  });
  return p;
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    for (const p of procs) p.kill(sig);
  });
}
