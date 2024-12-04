import { flatMap, get, isEmpty, mean, merge, set, sortBy, sumBy, memoize } from 'lodash';
import { z } from 'zod';
import { MessagesByOrganizationSchema } from './schemas';
import type { ChannelInfo, MessagesByOrganization, SlackMessage } from './types';

const StorageStateSchema = z.object({
  isExtracting: z.boolean(),
  currentChannel: z.union([
    z.null(),
    z.object({
      organization: z.string(),
      channel: z.string(),
    }),
  ]),
  extractedMessages: MessagesByOrganizationSchema,
  isScrollingEnabled: z.boolean().default(true),
});

type StorageState = z.infer<typeof StorageStateSchema>;

export class StorageService {
  private readonly STORAGE_KEY = 'slack-extractor-state';
  private readonly LEGACY_KEY = 'extensionState';
  private readonly METRICS_KEY = 'storage-metrics';
  private readonly MIGRATION_COMPLETE_KEY = 'migration-complete';
  private cachedState: StorageState | null = null;
  private pendingWrites: Array<() => Promise<void>> = [];
  private writeTimeout: number | null = null;
  private readonly WRITE_DELAY_MS = 1000; // Batch writes with 1s delay
  private observer: MutationObserver | null = null;
  private currentChannelInfo: ChannelInfo | null = null;
  private extractedMessages: MessagesByOrganization = {};
  private readonly metricsUpdateQueue: Promise<void>[] = [];

  private metrics = {
    readTimes: [] as number[],
    writeTimes: [] as number[],
  };

  private async updateMetrics(): Promise<void> {
    const metricsPromise = chrome.storage.local.set({
      [this.METRICS_KEY]: {
        avgReadTime: mean(this.metrics.readTimes) || 0,
        avgWriteTime: mean(this.metrics.writeTimes) || 0,
        totalReads: this.metrics.readTimes.length,
        totalWrites: this.metrics.writeTimes.length,
      },
    });

    try {
      await metricsPromise;
    } catch (error) {
      console.error('Failed to update metrics:', error);
    }
  }

  private async flushWrites(): Promise<void> {
    if (this.writeTimeout !== null) {
      self.clearTimeout(this.writeTimeout);
      this.writeTimeout = null;
    }

    if (this.pendingWrites.length === 0) return;

    const writes = [...this.pendingWrites];
    this.pendingWrites = [];

    try {
      const startTime = performance.now();
      await Promise.all(writes.map((write) => write()));
      const endTime = performance.now();
      this.metrics.writeTimes.push(endTime - startTime);
      void this.updateMetrics();
    } catch (error) {
      console.error('Error flushing writes:', error);
      this.pendingWrites.push(...writes);
      throw error;
    }
  }

  private scheduleWrite(write: () => Promise<void>): void {
    this.pendingWrites.push(write);

    if (this.writeTimeout === null) {
      this.writeTimeout = self.setTimeout(() => {
        void this.flushWrites();
      }, this.WRITE_DELAY_MS);
    }
  }

  private async migrateFromLegacy(): Promise<void> {
    const migrationComplete = await chrome.storage.local.get(this.MIGRATION_COMPLETE_KEY);
    if (migrationComplete[this.MIGRATION_COMPLETE_KEY]) {
      return;
    }

    const data = await chrome.storage.local.get([this.LEGACY_KEY, 'allMessages']);

    if (data[this.LEGACY_KEY]) {
      const legacyState = data[this.LEGACY_KEY];
      const migratedState = {
        isExtracting: legacyState.isExtracting ?? false,
        currentChannel: legacyState.currentChannel ?? null,
        extractedMessages: legacyState.extractedMessages ?? {},
        isScrollingEnabled: true,
      };

      // Validate before saving
      const validatedState = await StorageStateSchema.parseAsync(migratedState);

      // Save to new key
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: validatedState,
      });

      // Clean up legacy data
      await chrome.storage.local.remove([this.LEGACY_KEY, 'allMessages']);
    }

    // Mark migration as complete
    await chrome.storage.local.set({
      [this.MIGRATION_COMPLETE_KEY]: true,
    });
  }

  public async loadState(): Promise<StorageState> {
    const startTime = performance.now();
    const metricsUpdate = this.updateMetrics();

    // Run migration if needed
    await this.migrateFromLegacy();

    if (this.cachedState !== null) {
      const endTime = performance.now();
      this.metrics.readTimes.push(endTime - startTime);
      await metricsUpdate;
      return this.cachedState;
    }

    const data = await chrome.storage.local.get(this.STORAGE_KEY);

    if (this.STORAGE_KEY in data && data[this.STORAGE_KEY] !== null) {
      this.cachedState = await StorageStateSchema.parseAsync(data[this.STORAGE_KEY]);
      const endTime = performance.now();
      this.metrics.readTimes.push(endTime - startTime);
      await metricsUpdate;
      return this.cachedState;
    }

    // Default state if nothing exists
    this.cachedState = await StorageStateSchema.parseAsync({
      isExtracting: false,
      currentChannel: null,
      extractedMessages: {},
      isScrollingEnabled: true,
    });
    const endTime = performance.now();
    this.metrics.readTimes.push(endTime - startTime);
    await metricsUpdate;
    return this.cachedState;
  }

  private async loadAllMessagesFromStorage(): Promise<MessagesByOrganization> {
    const startTime = performance.now();
    const metricsUpdate = this.updateMetrics();

    const result = await chrome.storage.local.get([
      'allMessages',
      this.STORAGE_KEY,
      this.LEGACY_KEY,
    ]);

    const defaultMessages: MessagesByOrganization = {};

    // Try loading from each possible location
    const possibleMessages = [
      result.allMessages,
      result[this.STORAGE_KEY]?.extractedMessages,
      result[this.LEGACY_KEY]?.extractedMessages,
    ].filter((messages): boolean => {
      if (typeof messages !== 'object' || messages === null) return false;
      try {
        MessagesByOrganizationSchema.parse(messages);
        return true;
      } catch {
        return false;
      }
    });

    try {
      // Merge all valid message sources
      const merged = possibleMessages.reduce((acc, messages) => {
        return this.deduplicateAndMergeMessages(acc, messages);
      }, defaultMessages);
      const endTime = performance.now();
      this.metrics.readTimes.push(endTime - startTime);
      await metricsUpdate;
      return merged;
    } catch (error) {
      console.error('Error merging messages:', error);
      const endTime = performance.now();
      this.metrics.readTimes.push(endTime - startTime);
      await metricsUpdate;
      return defaultMessages;
    }
  }

  public async loadAllMessages(): Promise<MessagesByOrganization> {
    const startTime = performance.now();
    const metricsUpdate = this.updateMetrics();
    const state = await this.loadState();
    const endTime = performance.now();
    this.metrics.readTimes.push(endTime - startTime);
    await metricsUpdate;
    return state.extractedMessages;
  }

  public async saveAllMessages(messages: MessagesByOrganization): Promise<void> {
    const startTime = performance.now();
    const metricsUpdate = this.updateMetrics();
    // Validate messages before saving
    const validatedMessages = await MessagesByOrganizationSchema.parseAsync(messages);

    // Update cached state
    if (this.cachedState) {
      this.cachedState.extractedMessages = validatedMessages;
    }

    // Schedule the write operation
    this.scheduleWrite(async () => {
      const loadedState = await this.loadState();

      // Single storage operation with all updates
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: {
          ...loadedState,
          extractedMessages: validatedMessages,
        },
      });

      const endTime = performance.now();
      this.metrics.writeTimes.push(endTime - startTime);
      await metricsUpdate;
    });
  }

  private deduplicateAndMergeMessages(
    currentMessages: MessagesByOrganization,
    newMessages: MessagesByOrganization,
  ): MessagesByOrganization {
    const result = merge({}, currentMessages);
    const messageMap = new Map<string, Set<string>>();

    // Memoized helper function to generate message key
    const getMessageKey = memoize(
      (msg: SlackMessage): string => {
        const timestamp =
          typeof msg.timestamp === 'string'
            ? new Date(msg.timestamp).setMilliseconds(0).toString()
            : '0';
        return `${msg.text}|${msg.sender}|${msg.senderId}|${timestamp}`;
      },
      (msg) => `${msg.text}${msg.sender}${msg.senderId}${msg.timestamp}`,
    );

    // Process new messages
    for (const [org, orgData] of Object.entries(newMessages)) {
      if (isEmpty(get(result, org))) {
        set(result, org, {});
      }

      for (const [channel, channelData] of Object.entries(orgData)) {
        if (isEmpty(get(result, [org, channel]))) {
          set(result, [org, channel], {});
        }

        for (const [date, messages] of Object.entries(channelData)) {
          if (isEmpty(get(result, [org, channel, date]))) {
            set(result, [org, channel, date], []);
          }

          // Initialize message set for this date if needed
          const dateKey = `${org}|${channel}|${date}`;
          const existingKeys =
            messageMap.get(dateKey) ??
            new Set(get(result, [org, channel, date], []).map(getMessageKey));
          messageMap.set(dateKey, existingKeys);

          // Process each new message
          for (const newMessage of messages) {
            const messageKey = getMessageKey(newMessage);
            if (!existingKeys.has(messageKey)) {
              // New message, add it
              result[org][channel][date].push(newMessage);
              existingKeys.add(messageKey);
            } else {
              // Update existing message
              const existingIndex = result[org][channel][date].findIndex(
                (msg) => getMessageKey(msg) === messageKey,
              );
              if (existingIndex !== -1) {
                const existingMessage = result[org][channel][date][existingIndex];
                result[org][channel][date][existingIndex] = merge({}, existingMessage, newMessage, {
                  timestamp: existingMessage.timestamp ?? newMessage.timestamp,
                  messageId: existingMessage.messageId ?? newMessage.messageId,
                  isInferredSender: Boolean(
                    newMessage.isInferredSender && existingMessage.isInferredSender,
                  ),
                  sender: !newMessage.isInferredSender
                    ? newMessage.sender
                    : !existingMessage.isInferredSender
                      ? existingMessage.sender
                      : newMessage.sender,
                  senderId: !newMessage.isInferredSender
                    ? newMessage.senderId
                    : !existingMessage.isInferredSender
                      ? existingMessage.senderId
                      : newMessage.senderId,
                });
              }
            }
          }

          // Sort messages by timestamp
          const getTimestamp = memoize((msg: SlackMessage): number =>
            typeof msg.timestamp === 'string' ? new Date(msg.timestamp).getTime() : 0,
          );

          result[org][channel][date] = sortBy(result[org][channel][date], getTimestamp);
        }
      }
    }

    return result;
  }

  public async mergeAndSaveMessages(
    currentMessages: MessagesByOrganization,
    newMessages: MessagesByOrganization,
  ): Promise<MessagesByOrganization> {
    const startTime = performance.now();
    const metricsUpdate = this.updateMetrics();

    // Validate both message sets in parallel
    const [validatedCurrentMessages, validatedNewMessages] = await Promise.all([
      MessagesByOrganizationSchema.parseAsync(currentMessages),
      MessagesByOrganizationSchema.parseAsync(newMessages),
    ]);

    const mergedMessages = this.deduplicateAndMergeMessages(
      validatedCurrentMessages,
      validatedNewMessages,
    );

    await this.saveAllMessages(mergedMessages);
    const endTime = performance.now();
    this.metrics.writeTimes.push(endTime - startTime);
    await metricsUpdate;
    return mergedMessages;
  }

  public async deleteChannelMessages(organization: string, channel: string): Promise<void> {
    const startTime = performance.now();
    const metricsUpdate = this.updateMetrics();

    if (organization === '' || channel === '') {
      throw new Error('Organization and channel must not be empty');
    }

    const state = await this.loadState();
    const hasMessages = state.extractedMessages[organization]?.[channel] !== undefined;
    const hasOrg = state.extractedMessages[organization] !== undefined;

    if (!hasMessages) {
      throw new Error(`No messages found for channel ${channel} in organization ${organization}`);
    }

    // Remove the channel from state
    const { [channel]: _, ...remainingChannels } = state.extractedMessages[organization];

    // If org has no more channels, remove it
    if (Object.keys(remainingChannels).length === 0) {
      const { [organization]: __, ...remainingOrgs } = state.extractedMessages;
      state.extractedMessages = remainingOrgs;
    } else if (hasOrg) {
      state.extractedMessages = {
        ...state.extractedMessages,
        [organization]: remainingChannels,
      };
    }

    await this.saveState(state);
    const endTime = performance.now();
    this.metrics.writeTimes.push(endTime - startTime);
    await metricsUpdate;
  }

  public async saveState(
    state: Omit<StorageState, 'isScrollingEnabled'> & { isScrollingEnabled?: boolean },
  ): Promise<void> {
    const startTime = performance.now();
    const metricsUpdate = this.updateMetrics();

    // Only load current state if we need the scrolling enabled value
    const currentState = state.isScrollingEnabled === undefined ? await this.loadState() : null;
    await this.flushWrites(); // Ensure any pending writes are completed

    const newState = {
      ...state,
      isScrollingEnabled: state.isScrollingEnabled ?? currentState?.isScrollingEnabled ?? true,
    };

    this.cachedState = newState;
    this.scheduleWrite(async () => {
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: newState,
      });

      const endTime = performance.now();
      this.metrics.writeTimes.push(endTime - startTime);
      await metricsUpdate;
    });
  }

  public async setScrollingEnabled(enabled: boolean): Promise<void> {
    const startTime = performance.now();
    const metricsUpdate = this.updateMetrics();
    const currentState = await this.loadState();
    await this.saveState({
      ...currentState,
      isScrollingEnabled: enabled,
    });
    const endTime = performance.now();
    this.metrics.writeTimes.push(endTime - startTime);
    await metricsUpdate;
  }

  public async isScrollingEnabled(): Promise<boolean> {
    const startTime = performance.now();
    const metricsUpdate = this.updateMetrics();
    const state = await this.loadState();
    const endTime = performance.now();
    this.metrics.readTimes.push(endTime - startTime);
    await metricsUpdate;
    return state.isScrollingEnabled;
  }

  public getCurrentState(): {
    isExtracting: boolean;
    channelInfo: ChannelInfo | null;
    messageCount: number;
    extractedMessages: MessagesByOrganization;
  } {
    const messageCount = sumBy(
      flatMap(Object.values(this.extractedMessages), (org) =>
        flatMap(Object.values(org as Record<string, Record<string, unknown[]>>), (channel) =>
          flatMap(Object.values(channel), (messages) =>
            Array.isArray(messages) ? messages.length : 0,
          ),
        ),
      ),
    );

    return {
      isExtracting: Boolean(this.observer),
      channelInfo: this.currentChannelInfo,
      messageCount,
      extractedMessages: this.extractedMessages,
    };
  }
}
