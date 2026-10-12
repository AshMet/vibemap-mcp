#!/usr/bin/env node
// Package entry point. `ci-report` is a command-line subcommand; anything else
// starts the MCP server over stdio exactly as before.

const sub = process.argv[2];

if (sub === "ci-report") {
  const { runCiReport } = await import("./ci-report/run.js");
  process.exit(await runCiReport(process.argv.slice(3), { env: process.env }));
} else {
  await import("./index.js");
}
