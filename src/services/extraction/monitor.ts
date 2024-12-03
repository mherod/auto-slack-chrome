import { startOfDay } from 'date-fns';
import type { SlackMessage, ChannelInfo, MessagesByOrganization } from './types';
import type { MessageExtractor } from './message-extractor';
import type { StorageService } from './storage';

export class MonitorService {
  private observer: MutationObserver | null = null;
  private titleCheckInterval: number | null = null;
  private extractedMessages: MessagesByOrganization = {};
  private currentChannelInfo: ChannelInfo | null = null;
  private lastMessageTimestamp: number = Date.now();
  private reconnectInterval: number | null = null;
  private scrollTimeout: number | null = null;
  private pollingInterval: number | null = null;
  private readonly EXTRACTED_ATTRIBUTE = 'data-message-extracted';
  private readonly SCROLL_DEBOUNCE_MS = 250;
  private readonly POLLING_INTERVAL_MS = 2500; // Poll every 2.5 seconds
  private readonly TITLE_CHECK_INTERVAL_MS = 5000; // Check title every 5 seconds
  private readonly RECONNECT_CHECK_INTERVAL_MS = 7500; // Check connection every 7.5 seconds
  private isExtracting = false;

  public constructor(
    private readonly messageExtractor: MessageExtractor,
    private readonly storageService: StorageService,
    private readonly onChannelChange: (channelInfo: ChannelInfo) => void,
    private readonly onSync: () => void,
  ) {
    this.injectStyles();
  }

  private injectStyles(): void {
    const styleId = 'auto-slack-extraction-styles';
    if (document.getElementById(styleId) !== null) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      [${this.EXTRACTED_ATTRIBUTE}="true"]::after {
        content: '';
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background-color: #36C5AB;
        opacity: 0.6;
        position: absolute;
        right: 8px;
        top: 8px;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  private markMessageAsExtracted(element: Element): void {
    if (!element.hasAttribute(this.EXTRACTED_ATTRIBUTE)) {
      element.setAttribute(this.EXTRACTED_ATTRIBUTE, 'true');
    }
  }

  public async startMonitoring(): Promise<void> {
    // Load previous state
    const state = await this.storageService.loadState();
    this.extractedMessages = state.extractedMessages;

    // Initial channel info extraction
    this.currentChannelInfo = this.messageExtractor.extractChannelInfo();

    // Set up title observer and periodic check
    this.setupTitleObserver();

    // Set up message observer
    this.setupMessageObserver();

    // Set up scroll handler
    this.setupScrollHandler();

    // Set up reconnect check
    this.setupReconnectCheck();

    // Set up polling monitor
    this.setupPollingMonitor();

    // Initial extraction
    await this.extractMessages();

    // Save initial state
    await this.saveCurrentState();
  }

  public async stopMonitoring(): Promise<void> {
    // Stop observers and handlers
    if (this.observer !== null) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.titleCheckInterval !== null) {
      window.clearInterval(this.titleCheckInterval);
      this.titleCheckInterval = null;
    }

    if (this.reconnectInterval !== null) {
      window.clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }

    if (this.scrollTimeout !== null) {
      window.clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }

    if (this.pollingInterval !== null) {
      window.clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    // Remove scroll listener
    const container = this.messageExtractor.getMessageContainer();
    if (container !== null) {
      container.removeEventListener('scroll', this.handleScroll);
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

  private setupScrollHandler(): void {
    const container = this.messageExtractor.getMessageContainer();
    if (container !== null) {
      container.addEventListener('scroll', this.handleScroll);
    }
  }

  private handleScroll = (): void => {
    if (this.scrollTimeout !== null) {
      window.clearTimeout(this.scrollTimeout);
    }

    // Disconnect observer during scroll
    if (this.observer !== null) {
      this.observer.disconnect();
    }

    this.scrollTimeout = window.setTimeout(async () => {
      if (!this.isExtracting) {
        // Reconnect observer first
        this.setupMessageObserver();

        // Then extract messages
        await this.extractMessages();
        this.onSync();

        // Update timestamp to prevent unnecessary reconnection
        this.lastMessageTimestamp = Date.now();
      }
    }, this.SCROLL_DEBOUNCE_MS);
  };

  private setupMessageObserver(): void {
    const container = this.messageExtractor.getMessageContainer();
    if (container !== null) {
      // Clean up existing observer if it exists
      if (this.observer !== null) {
        this.observer.disconnect();
      }

      this.observer = new MutationObserver((mutations) => {
        if (!this.isExtracting) {
          // Check if any mutations are relevant to message content
          const hasRelevantChanges = mutations.some(
            (mutation) =>
              mutation.type === 'childList' ||
              (mutation.type === 'attributes' && mutation.attributeName === 'data-qa') ||
              (mutation.type === 'attributes' &&
                mutation.attributeName === 'data-needs-sender-update'),
          );

          if (hasRelevantChanges) {
            void this.extractMessages();
            this.onSync();
            this.lastMessageTimestamp = Date.now();
          }
        }
      });

      this.observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-qa', 'data-needs-sender-update'],
      });
    }
  }

  private setupReconnectCheck(): void {
    this.reconnectInterval = window.setInterval(() => {
      const timeSinceLastMessage = Date.now() - this.lastMessageTimestamp;
      if (timeSinceLastMessage > 10000) {
        // 10 seconds
        // Reconnect observer
        if (this.observer !== null) {
          this.observer.disconnect();
        }
        this.setupMessageObserver();
      }
    }, this.RECONNECT_CHECK_INTERVAL_MS);
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

    // Set up periodic title check
    this.titleCheckInterval = window.setInterval(
      () => void this.checkChannelChange(),
      this.TITLE_CHECK_INTERVAL_MS,
    );
  }

  private async checkChannelChange(): Promise<void> {
    const newChannelInfo = this.messageExtractor.extractChannelInfo();
    if (
      newChannelInfo !== null &&
      (this.currentChannelInfo === null ||
        newChannelInfo.channel !== this.currentChannelInfo.channel ||
        newChannelInfo.organization !== this.currentChannelInfo.organization)
    ) {
      // Update channel info
      this.currentChannelInfo = newChannelInfo;

      // Disconnect and reconnect observer to ensure clean state
      if (this.observer !== null) {
        this.observer.disconnect();
      }
      this.setupMessageObserver();

      // Extract messages in new channel
      await this.extractMessages();
      this.onChannelChange(newChannelInfo);

      // Update timestamp to prevent unnecessary reconnection
      this.lastMessageTimestamp = Date.now();
    }
  }

  private async extractMessages(): Promise<void> {
    if (this.isExtracting) return;
    this.isExtracting = true;

    try {
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
          // Skip already extracted messages unless they need sender update
          if (
            listItem.hasAttribute(this.EXTRACTED_ATTRIBUTE) &&
            !listItem.hasAttribute('data-needs-sender-update')
          ) {
            return;
          }

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

          // Extract attachments if present
          const attachments = this.messageExtractor.extractAttachments(listItem);
          if (attachments) {
            message.attachments = attachments;
          }

          // Only add valid messages to the hierarchy and mark them as extracted
          if (this.messageExtractor.isValidMessage(message)) {
            await this.updateMessageHierarchy(message);
            this.markMessageAsExtracted(listItem);
          }
        }),
      );
    } finally {
      this.isExtracting = false;
    }
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

  private setupPollingMonitor(): void {
    // Clear existing interval if it exists
    if (this.pollingInterval !== null) {
      window.clearInterval(this.pollingInterval);
    }

    // Set up new polling interval
    this.pollingInterval = window.setInterval(async () => {
      if (!this.isExtracting) {
        const container = this.messageExtractor.getMessageContainer();
        if (container !== null) {
          // Check if there are any unextracted messages
          const unextractedMessages = container.querySelectorAll(
            `[data-qa="virtual-list-item"]:not([${this.EXTRACTED_ATTRIBUTE}="true"])`,
          );

          if (unextractedMessages.length > 0) {
            // Extract messages if we find any that haven't been processed
            await this.extractMessages();
            this.onSync();
            this.lastMessageTimestamp = Date.now();
          }

          // Check for messages that might need sender updates
          const needsSenderUpdate = container.querySelectorAll('[data-needs-sender-update]');
          if (needsSenderUpdate.length > 0) {
            await this.extractMessages();
            this.onSync();
          }
        }
      }
    }, this.POLLING_INTERVAL_MS);
  }
}
