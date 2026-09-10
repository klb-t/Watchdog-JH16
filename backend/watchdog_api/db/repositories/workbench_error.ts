export class WorkbenchError extends Error {
  readonly code = 'workbench_error';
  constructor(message: string, readonly status = 400) { super(message); }
}
