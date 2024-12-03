import { startOfDay } from 'date-fns';
import type { SlackMessage, ChannelInfo, MessagesByOrganization } from './types';
import type { MessageExtractor } from './message-extractor';
import type { StorageService } from './storage';

export class MonitorService {
  private observer: MutationObserver | null = null;
  private titleCheckInterval: number | null = null;
  private extractedMessages: MessagesByOrganization = {};
  private currentChannelInfo: ChannelInfo | null = null;

  public constructor(
    private readonly messageExtractor: MessageExtractor,
    private readonly storageService: StorageService,
    private readonly onChannelChange: (channelInfo: ChannelInfo) => void,
    private readonly onSync: () => void,
  ) {}

  public async startMonitoring(): Promise<void> {
    // Load previous state
    const state = await this.storageService.loadState();
    this.extractedMessages = state.extractedMessages;

    // Initial channel info extraction
    this.currentChannelInfo = this.messageExtractor.extractChannelInfo();

    // Set up title observer and periodic check
    this.setupTitleObserver();

    // Set up message observer
    const container = this.messageExtractor.getMessageContainer();
    if (container !== null) {
      this.observer = new MutationObserver(() => {
        void this.extractMessages();
        this.onSync();
      });

      this.observer.observe(container, { childList: true, subtree: true });
    }

    // Initial extraction
    await this.extractMessages();

    // Save initial state
    await this.saveCurrentState();
  }

  public async stopMonitoring(): Promise<void> {
    // Stop observers
    if (this.observer !== null) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.titleCheckInterval !== null) {
      window.clearInterval(this.titleCheckInterval);
      this.titleCheckInterval = null;
    }

    // Save state
    await this.saveCurrentState();
  }

  public getCurrentState(): {
    isExtracting: boolean;
    channelInfo: ChannelInfo | null;
    messageCount: number;
    extractedMessages: MessagesByOrganization;
  } {
    return {
      isExtracting: this.observer !== null,
      channelInfo: this.currentChannelInfo,
      messageCount: Object.values(this.extractedMessages)
        .flatMap((org) => Object.values(org))
        .flatMap((channel) => Object.values(channel))
        .reduce((acc, messages) => acc + messages.length, 0),
      extractedMessages: this.extractedMessages,
    };
  }

  private setupTitleObserver(): void {
    const titleObserver = new MutationObserver(() => void this.checkChannelChange());

    const titleElement = document.querySelector('title');
    if (titleElement !== null) {
      titleObserver.observe(titleElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    // Set up periodic title check (every 5 seconds)
    this.titleCheckInterval = window.setInterval(() => void this.checkChannelChange(), 5000);
  }

  private async checkChannelChange(): Promise<void> {
    const newChannelInfo = this.messageExtractor.extractChannelInfo();
    if (
      newChannelInfo !== null &&
      (this.currentChannelInfo === null ||
        newChannelInfo.channel !== this.currentChannelInfo.channel ||
        newChannelInfo.organization !== this.currentChannelInfo.organization)
    ) {
      this.currentChannelInfo = newChannelInfo;
      await this.extractMessages();
      this.onChannelChange(newChannelInfo);
    }
  }

  private async extractMessages(): Promise<void> {
    // Update channel info
    this.currentChannelInfo = this.messageExtractor.extractChannelInfo();
    if (this.currentChannelInfo === null) return;

    const messageElements = document.querySelectorAll('[data-qa="virtual-list-item"]');
    if (messageElements.length === 0) return;

    // Reset last known sender at the start of extraction
    this.messageExtractor.resetLastKnownSender();

    // Convert NodeList to Array for proper iteration
    await Promise.all(
      Array.from(messageElements).map(async (listItem) => {
        // Get message ID from the list item
        const messageId = listItem.getAttribute('id');

        // Skip invalid messages and UI elements
        if (messageId === null || !this.messageExtractor.isValidMessageId(messageId)) return;

        // Skip empty messages or UI elements without actual text content
        const messageText = listItem.querySelector('[data-qa="message-text"]');
        const text = messageText?.textContent ?? '';
        if (text.trim() === '') return;

        // Extract sender information with follow-up message handling
        const { sender, senderId, avatarUrl, customStatus, isInferred } =
          this.messageExtractor.extractMessageSender(listItem);

        // Get timestamp and permalink
        const timestampElement = listItem.querySelector('.c-timestamp');
        if (timestampElement === null) return;

        const { timestamp, permalink } =
          this.messageExtractor.extractMessageTimestamp(timestampElement);

        // Skip messages without timestamps as they're likely UI elements
        if (timestamp === null) return;

        const message: SlackMessage = {
          messageId,
          sender,
          senderId,
          timestamp,
          text,
          permalink,
          customStatus,
          avatarUrl,
          isInferredSender: isInferred,
        };

        // Only add valid messages to the hierarchy
        if (this.messageExtractor.isValidMessage(message)) {
          await this.updateMessageHierarchy(message);
        }
      }),
    );
  }

  private async updateMessageHierarchy(message: SlackMessage): Promise<void> {
    if (this.currentChannelInfo === null || message.timestamp === null) return;

    const { organization, channel } = this.currentChannelInfo;
    const messageDate = startOfDay(new Date(message.timestamp)).toISOString();

    // Initialize hierarchy if needed
    if (!(organization in this.extractedMessages)) {
      this.extractedMessages[organization] = {};
    }
    if (!(channel in this.extractedMessages[organization])) {
      this.extractedMessages[organization][channel] = {};
    }
    if (!(messageDate in this.extractedMessages[organization][channel])) {
      this.extractedMessages[organization][channel][messageDate] = [];
    }

    const messages = this.extractedMessages[organization][channel][messageDate];
    const existingIndex = messages.findIndex((m) => m.messageId === message.messageId);

    if (existingIndex >= 0) {
      // Update existing message if new info is available
      if (!message.isInferredSender && message.sender !== null && message.senderId !== null) {
        messages[existingIndex] = {
          ...messages[existingIndex],
          ...message,
          isInferredSender: false,
        };
      }
    } else {
      // Add new message
      messages.push(message);
    }

    // Sort messages by timestamp
    messages.sort((a, b) => {
      const timeA = new Date(a.timestamp ?? 0).getTime();
      const timeB = new Date(b.timestamp ?? 0).getTime();
      return timeA - timeB;
    });

    // Save state
    await this.saveCurrentState();
  }

  private async saveCurrentState(): Promise<void> {
    await this.storageService.saveState({
      isExtracting: this.observer !== null,
      currentChannel: this.currentChannelInfo,
      extractedMessages: this.extractedMessages,
    });
  }
}
