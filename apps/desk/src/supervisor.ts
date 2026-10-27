/**
 * Runs Stitch as a child process of the desk service and restarts it when its config changes
 * (Stitch reads stitch.toml only at startup). Used to switch buy sides off past an inventory cap.
 * - One Stitch at a time: the old process is stopped (SIGTERM, then SIGKILL after 15 s) before
 *   the new one starts. Signed quotes already out stay valid until they expire; nothing is revoked.
 * - Config changes are applied at most every minRestartMs; a crash restarts after a backoff.
 * - Secrets reach Stitch through its environment and a 0600 key file; they are never logged.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SupervisorOptions {
  bin: string;
  /** Runtime dir for stitch.toml, rfq-api.key and Stitch's own state. */
  dir: string;
  privateKey: string;
  rfqApiKey: string;
  minRestartMs?: number;
  log?: (line: string) => void;
  /** Every complete line Stitch prints (stdout and stderr), e.g. to count RFQ events. */
  onLine?: (line: string) => void;
}

export class StitchSupervisor {
  private child?: ChildProcess;
  private current?: string;
  private pending?: string;
  private lastStart = 0;
  private restarts = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private crashBackoff = 5_000;
  /** While Stitch is down after a crash, restarts wait for this time (ms epoch); 0 when not backing off. */
  private crashRetryAt = 0;

  constructor(private o: SupervisorOptions) {
    mkdirSync(o.dir, { recursive: true });
    writeFileSync(join(o.dir, "rfq-api.key"), o.rfqApiKey, { mode: 0o600 });
  }

  /** Desired config. Restarts Stitch when it differs from the running one (rate-limited). */
  apply(toml: string): void {
    if (toml === this.current && this.child) return;
    this.pending = toml;
    // Crashed and backing off: keep the newest config for the backoff timer instead of restarting now.
    // (The feed applies every tick; restarting here made a crash loop every ~10 s, 2026-10-27.)
    if (!this.child && Date.now() < this.crashRetryAt) return;
    const wait = Math.max(0, (this.o.minRestartMs ?? 60_000) - (Date.now() - this.lastStart));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.restart(), this.child ? wait : 0);
  }

  status() {
    return { running: !!this.child && this.child.exitCode === null, pid: this.child?.pid ?? null, restarts: this.restarts, lastStartAt: this.lastStart ? new Date(this.lastStart).toISOString() : null, pendingChange: this.pending !== undefined && this.pending !== this.current };
  }

  private async restart(): Promise<void> {
    if (this.stopping || this.pending === undefined) return;
    const toml = this.pending;
    await this.kill();
    writeFileSync(join(this.o.dir, "stitch.toml"), toml);
    this.current = toml;
    this.lastStart = Date.now();
    this.restarts++;
    const child = spawn(this.o.bin, ["--config", join(this.o.dir, "stitch.toml")], {
      cwd: this.o.dir,
      env: { ...process.env, STITCH_PRIVATE_KEY: this.o.privateKey, STITCH_RFQ_API_KEY_FILE: join(this.o.dir, "rfq-api.key"), STITCH_RUNTIME_DIR: this.o.dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // A chunk can end mid-line: keep the tail until its newline arrives.
    const forwarder = () => {
      let tail = "";
      return (buf: Buffer) => {
        const lines = (tail + buf.toString()).split("\n");
        tail = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          this.o.log?.(`[stitch] ${line}`);
          this.o.onLine?.(line);
        }
      };
    };
    child.stdout?.on("data", forwarder());
    child.stderr?.on("data", forwarder());
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      if (this.stopping) return;
      this.o.log?.(`stitch exited (code ${code}, signal ${signal}); restarting in ${this.crashBackoff / 1000}s`);
      this.crashRetryAt = Date.now() + this.crashBackoff;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.crashRetryAt = 0;
        this.pending ??= this.current;
        void this.restart();
      }, this.crashBackoff);
      this.crashBackoff = Math.min(this.crashBackoff * 2, 5 * 60_000);
    });
    this.child = child;
    setTimeout(() => {
      if (this.child === child) this.crashBackoff = 5_000; // healthy for a minute: reset backoff
    }, 60_000).unref();
    this.o.log?.(`stitch started (pid ${child.pid}, restart #${this.restarts})`);
  }

  private kill(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) return Promise.resolve();
    this.child = undefined; // the exit handler ignores a child we stopped on purpose
    return new Promise((resolve) => {
      const hard = setTimeout(() => child.kill("SIGKILL"), 15_000);
      child.once("exit", () => {
        clearTimeout(hard);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.timer);
    await this.kill();
  }
}
