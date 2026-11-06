// Node 22 prints "ExperimentalWarning: SQLite is an experimental feature" on first use of node:sqlite.
// It's harmless; hide just that warning so terminal output stays clean.
const original = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === "string" ? warning : warning?.message ?? "";
  if (/SQLite is an experimental feature/i.test(msg)) return;
  return (original as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
export {};
