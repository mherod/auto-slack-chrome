import type { HeartbeatMessage, SyncMessage, MessagesByOrganization, ChannelInfo } from './types';

export class ConnectionService {
  private static readonly HEARTBEAT_INTERVAL = 5000; // 5 seconds
  private static readonly SYNC_INTERVAL = 10000; // 10 seconds
  private static readonly HEARTBEAT_TIMEOUT = 10000; // 10 seconds
  private static readonly DEBOUNCE_DELAY = 1000; // 1 second

  private heartbeatInterval: number | null = null;
  private syncInterval: number | null = null;
  private lastHeartbeat: number = Date.now();
  private isBackgroundConnected: boolean = false;
  private syncDebounceTimeout: number | null = null;
  private lastSyncData: string | null = null;

  public constructor(
    private readonly onConnectionLoss: () => void,
    private readonly getCurrentState: () => {
      isExtracting: boolean;
      channelInfo: ChannelInfo | null;
      messageCount: number;
      extractedMessages: MessagesByOrganization;
    },
  ) {}

  public initializeConnection(): void {
    this.clearIntervals();
    this.startHeartbeat();
    this.startSync();
  }

  public handleConnectionLoss(): void {
    this.isBackgroundConnected = false;
    this.clearIntervals();
    this.onConnectionLoss();
    this.initializeConnection();
  }

  public checkConnection(): void {
    const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;
    if (timeSinceLastHeartbeat > ConnectionService.HEARTBEAT_TIMEOUT) {
      this.handleConnectionLoss();
    }
  }

  public updateLastHeartbeat(timestamp: number): void {
    this.lastHeartbeat = timestamp;
    this.isBackgroundConnected = true;
  }

  public isConnected(): boolean {
    return this.isBackgroundConnected;
  }

  public async sendSync(): Promise<void> {
    if (this.syncDebounceTimeout !== null) {
      window.clearTimeout(this.syncDebounceTimeout);
    }

    this.syncDebounceTimeout = window.setTimeout(async () => {
      try {
        const state = this.getCurrentState();
        const currentData = JSON.stringify(state.extractedMessages);

        // Only send if data has changed
        if (currentData !== this.lastSyncData) {
          const message: SyncMessage = {
            type: 'sync',
            timestamp: Date.now(),
            data: {
              extractedMessages: state.extractedMessages,
              currentChannel: state.channelInfo,
            },
          };

          await chrome.runtime.sendMessage(message);
          this.isBackgroundConnected = true;
          this.lastSyncData = currentData;
        }
      } catch {
        this.handleConnectionLoss();
      }
    }, ConnectionService.DEBOUNCE_DELAY);
  }

  private startHeartbeat(): void {
    // Send initial heartbeat
    void this.sendHeartbeat();

    // Start heartbeat interval
    this.heartbeatInterval = window.setInterval(
      () => void this.sendHeartbeat(),
      ConnectionService.HEARTBEAT_INTERVAL,
    );
  }

  private startSync(): void {
    // Send initial sync
    void this.sendSync();

    // Start sync interval
    this.syncInterval = window.setInterval(
      () => void this.sendSync(),
      ConnectionService.SYNC_INTERVAL,
    );
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      const state = this.getCurrentState();
      const message: HeartbeatMessage = {
        type: 'heartbeat',
        timestamp: Date.now(),
        status: {
          isExtracting: state.isExtracting,
          channelInfo: state.channelInfo,
          messageCount: state.messageCount,
        },
      };

      await chrome.runtime.sendMessage(message);
      this.isBackgroundConnected = true;
      this.lastHeartbeat = Date.now();
    } catch {
      this.handleConnectionLoss();
    }
  }

  private clearIntervals(): void {
    if (this.heartbeatInterval !== null) {
      window.clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.syncInterval !== null) {
      window.clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this.syncDebounceTimeout !== null) {
      window.clearTimeout(this.syncDebounceTimeout);
      this.syncDebounceTimeout = null;
    }
  }
}
