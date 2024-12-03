import type { HeartbeatMessage, SyncMessage, MessagesByOrganization, ChannelInfo } from './types';

export class ConnectionService {
  private static readonly HEARTBEAT_INTERVAL = 5000; // 5 seconds
  private static readonly SYNC_INTERVAL = 10000; // 10 seconds
  private static readonly HEARTBEAT_TIMEOUT = 10000; // 10 seconds

  private heartbeatInterval: number | null = null;
  private syncInterval: number | null = null;
  private lastHeartbeat: number = Date.now();
  private isBackgroundConnected: boolean = false;

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
    // Clear any existing intervals
    this.clearIntervals();

    // Start heartbeat
    this.heartbeatInterval = window.setInterval(
      () => void this.sendHeartbeat(),
      ConnectionService.HEARTBEAT_INTERVAL,
    );

    // Start periodic sync
    this.syncInterval = window.setInterval(
      () => void this.sendSync(),
      ConnectionService.SYNC_INTERVAL,
    );

    // Send initial heartbeat and sync
    void this.sendHeartbeat();
    void this.sendSync();
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
    const state = this.getCurrentState();
    const message: SyncMessage = {
      type: 'sync',
      timestamp: Date.now(),
      data: {
        extractedMessages: state.extractedMessages,
        currentChannel: state.channelInfo,
      },
    };

    try {
      await chrome.runtime.sendMessage(message);
      this.isBackgroundConnected = true;
    } catch {
      this.handleConnectionLoss();
    }
  }

  private async sendHeartbeat(): Promise<void> {
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

    try {
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
  }
}
