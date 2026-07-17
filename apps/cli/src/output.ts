import type { Writable } from "node:stream";

import type { CliError } from "./errors.js";

export interface OutputStreams {
  stdout: Writable;
  stderr: Writable;
}

export class CliOutput {
  readonly #json: boolean;
  readonly #streams: OutputStreams;

  constructor(json: boolean, streams: OutputStreams) {
    this.#json = json;
    this.#streams = streams;
  }

  result(message: string, data: Record<string, unknown> = {}): void {
    if (this.#json) {
      this.#streams.stdout.write(`${JSON.stringify({ ok: true, message, ...data })}\n`);
      return;
    }
    this.#streams.stdout.write(`${message}\n`);
  }

  error(error: CliError): void {
    if (this.#json) {
      this.#streams.stderr.write(
        `${JSON.stringify({ ok: false, error: { code: error.code, message: error.message } })}\n`
      );
      return;
    }
    this.#streams.stderr.write(`Error [${error.code}]: ${error.message}\n`);
  }
}
