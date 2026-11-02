import { TerminalLogEntry, TerminalLogTag } from '../types/audio';

type LogSubscriber = (logs: TerminalLogEntry[]) => void;

class TerminalLoggerBus {
  private logs: TerminalLogEntry[] = [];
  private subscribers: Set<LogSubscriber> = new Set();
  private maxEntries = 400;

  constructor() {
    this.log('SYS', 'IceJaZz Audio Engine initialized :: v1.5');
  }

  private formatNow(): string {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }

  public log(tag: TerminalLogTag, message: string): void {
    const entry: TerminalLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: this.formatNow(),
      tag,
      message,
    };
    this.logs = [...this.logs.slice(-(this.maxEntries - 1)), entry];
    this.notify();
  }

  public clear(): void {
    this.logs = [];
    this.log('SYS', 'Terminal buffer flushed.');
  }

  public getLogs(): TerminalLogEntry[] {
    return this.logs;
  }

  public subscribe(cb: LogSubscriber): () => void {
    this.subscribers.add(cb);
    cb(this.logs);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private notify(): void {
    for (const sub of this.subscribers) {
      sub(this.logs);
    }
  }
}

export const terminalLogger = new TerminalLoggerBus();
