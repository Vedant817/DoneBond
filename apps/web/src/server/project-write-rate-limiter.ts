import { cliTokenRateKey, type CliTokenRateLimiter } from "./cli-token.ts";
import type { ProjectWriteOperation, ProjectWriteRateLimiter } from "./project-policy-handlers.ts";

export type ProjectWriteLimiterPair = Readonly<{
  global: CliTokenRateLimiter;
  subject: CliTokenRateLimiter;
}>;

export class DurableProjectWriteRateLimiter implements ProjectWriteRateLimiter {
  readonly #secret: string;
  readonly #limiters: Readonly<Record<ProjectWriteOperation, ProjectWriteLimiterPair>>;

  constructor(
    secret: string,
    limiters: Readonly<Record<ProjectWriteOperation, ProjectWriteLimiterPair>>
  ) {
    cliTokenRateKey(secret, "project-api:configuration-check");
    this.#secret = secret;
    this.#limiters = limiters;
  }

  async consume(
    operation: ProjectWriteOperation,
    subject: string | null,
    at: Date
  ): Promise<boolean> {
    const pair = this.#limiters[operation];
    const scope = subject === null ? "global" : subject;
    return (subject === null ? pair.global : pair.subject).consume(
      cliTokenRateKey(this.#secret, `project-api:${operation}:${scope}`),
      at
    );
  }
}
