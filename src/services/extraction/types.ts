export interface SlackMessage {
  sender: string | null;
  senderId: string | null;
  timestamp: string | null;
  text: string;
  permalink: string | null;
  customStatus: {
    emoji: string | null;
    emojiUrl: string | null;
  } | null;
  avatarUrl: string | null;
  messageId: string | null;
  isInferredSender: boolean;
}

export interface ChannelInfo {
  channel: string;
  organization: string;
}

export interface MessagesByDate {
  [date: string]: SlackMessage[];
}

export interface MessagesByChannel {
  [channel: string]: MessagesByDate;
}

export interface MessagesByOrganization {
  [organization: string]: MessagesByChannel;
}

export interface ExtensionState {
  isExtracting: boolean;
  currentChannel: ChannelInfo | null;
  extractedMessages: MessagesByOrganization;
}

export interface LastKnownSender {
  sender: string;
  senderId: string;
  avatarUrl: string | null;
  customStatus: {
    emoji: string | null;
    emojiUrl: string | null;
  } | null;
}

export interface SenderInfo {
  sender: string | null;
  senderId: string | null;
  avatarUrl: string | null;
  customStatus: { emoji: string | null; emojiUrl: string | null } | null;
  isInferred: boolean;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  timestamp: number;
  status: {
    isExtracting: boolean;
    channelInfo: ChannelInfo | null;
    messageCount: number;
  };
}

export interface SyncMessage {
  type: 'sync';
  timestamp: number;
  data: {
    extractedMessages: MessagesByOrganization;
    currentChannel: ChannelInfo | null;
  };
}

export interface ExtractionControlMessage {
  type: 'START_EXTRACTION' | 'STOP_EXTRACTION';
}

export type ContentScriptMessage = HeartbeatMessage | SyncMessage;
export type IncomingMessage = ContentScriptMessage | ExtractionControlMessage;
