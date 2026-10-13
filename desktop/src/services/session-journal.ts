import type {WorkspaceSession} from '../api/workspace';

type JournalState = 'saving' | 'saved' | 'offline';
/** Serialize writes and retain the in-flight value until acknowledged, including lost responses. */
export class SessionJournal {
  private latest: WorkspaceSession | null = null;
  private pending: WorkspaceSession | null = null;
  private retryFirst: WorkspaceSession | null = null;
  private localPending: WorkspaceSession | null = null;
  private revision: number;
  private writing: Promise<void> | null = null;
  private localWriting: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private localTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private remoteRevision: number;
  constructor(
    initialRevision: number,
    private local: (snapshot: WorkspaceSession) => Promise<void>,
    private remote: (snapshot: WorkspaceSession, expectedRevision: number) => Promise<unknown>,
    private onState: (state: JournalState, error?: unknown) => void,
    private delay = 1200,
    initialRemoteRevision = initialRevision,
  ) {
    this.revision = initialRevision;
    this.remoteRevision = initialRemoteRevision;
  }

  /** Retry the exact recovered version first: its original acknowledgement may have been lost. */
  recover(snapshot: WorkspaceSession) {
    if (snapshot.revision <= this.remoteRevision || this.latest) return;
    this.revision = Math.max(this.revision, snapshot.revision);
    this.latest = {...snapshot, sync_base_revision: this.remoteRevision};
    this.retryFirst = this.latest;
    this.localPending = this.latest;
    this.onState('saving');
    if (!this.disposed && !this.timer)
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush().catch(() => {});
      }, this.delay);
  }

  push(snapshot: WorkspaceSession) {
    this.latest = {...snapshot, revision: ++this.revision, sync_base_revision: this.remoteRevision};
    this.pending = this.latest;
    this.localPending = this.latest;
    this.onState('saving');
    if (!this.localTimer && !this.disposed)
      this.localTimer = setTimeout(() => {
        this.localTimer = null;
        void this.flushLocal().catch(error => this.onState('offline', error));
      }, 200);
    if (!this.timer && !this.disposed)
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush().catch(() => {});
      }, this.delay);
    return this.latest;
  }
  snapshot() {
    return this.latest;
  }
  async flushLocal(): Promise<void> {
    if (this.localTimer) {
      clearTimeout(this.localTimer);
      this.localTimer = null;
    }
    if (this.localWriting) {
      await this.localWriting;
      if (this.localPending) return this.flushLocal();
      return;
    }
    this.localWriting = (async () => {
      while (this.localPending) {
        const value = this.localPending;
        this.localPending = null;
        try {
          await this.local(value);
        } catch (error) {
          if (!this.localPending) this.localPending = value;
          throw error;
        }
      }
    })();
    try {
      await this.localWriting;
    } finally {
      this.localWriting = null;
    }
  }
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flushLocal().catch(error => this.onState('offline', error));
    if (this.writing) {
      await this.writing;
      if (this.pending || this.retryFirst) return this.flush();
      return;
    }
    this.writing = (async () => {
      while (this.pending || this.retryFirst) {
        const value = (this.retryFirst || this.pending)!;
        if (this.retryFirst) this.retryFirst = null;
        else this.pending = null;
        this.onState('saving');
        try {
          await this.remote(value, this.remoteRevision);
          this.remoteRevision = value.revision;
        } catch (error) {
          this.retryFirst = value;
          this.onState('offline', error);
          throw error;
        }
        if (this.latest) {
          this.latest = {...this.latest, sync_base_revision: this.remoteRevision};
          this.localPending = this.latest;
          await this.flushLocal().catch(error => this.onState('offline', error));
        }
      }
      this.onState('saved');
    })();
    try {
      await this.writing;
    } finally {
      this.writing = null;
    }
  }
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.localTimer) clearTimeout(this.localTimer);
  }
}
