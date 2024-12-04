import { merge } from 'lodash';
import { z } from 'zod';
import { MessagesByOrganizationSchema } from './schemas';
import type { MessagesByOrganization, SlackMessage } from './types';

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
  private cachedState: StorageState | null = null;
  private pendingWrites: Array<() => Promise<void>> = [];
  private writeTimeout: number | null = null;
  private readonly WRITE_DELAY_MS = 1000; // Batch writes with 1s delay

  private async flushWrites(): Promise<void> {
    if (this.writeTimeout !== null) {
      window.clearTimeout(this.writeTimeout);
      this.writeTimeout = null;
    }

    if (this.pendingWrites.length === 0) return;

    const writes = [...this.pendingWrites];
    this.pendingWrites = [];

    try {
      await Promise.all(writes.map((write) => write()));
    } catch (error) {
      console.error('Error flushing writes:', error);
      // Re-queue failed writes
      this.pendingWrites.push(...writes);
      throw error;
    }
  }

  private scheduleWrite(write: () => Promise<void>): void {
    this.pendingWrites.push(write);

    if (this.writeTimeout === null) {
      this.writeTimeout = window.setTimeout(() => {
        void this.flushWrites();
      }, this.WRITE_DELAY_MS);
    }
  }

  public async loadState(): Promise<StorageState> {
    if (this.cachedState !== null) {
      return this.cachedState;
    }

    const data = await chrome.storage.local.get([this.STORAGE_KEY, this.LEGACY_KEY]);

    // Try loading from new storage key first
    if (this.STORAGE_KEY in data && data[this.STORAGE_KEY] !== null) {
      this.cachedState = StorageStateSchema.parse(data[this.STORAGE_KEY]);
      return this.cachedState;
    }

    // Fall back to legacy storage
    if (this.LEGACY_KEY in data && data[this.LEGACY_KEY] !== null) {
      const legacyState = data[this.LEGACY_KEY];
      // Migrate legacy state to new format
      const migratedState = {
        isExtracting: legacyState.isExtracting ?? false,
        currentChannel: legacyState.currentChannel ?? null,
        extractedMessages: legacyState.extractedMessages ?? {},
        isScrollingEnabled: true, // Default for migrated states
      };

      // Save migrated state in new format
      this.cachedState = StorageStateSchema.parse(migratedState);
      this.scheduleWrite(async () => {
        await chrome.storage.local.set({ [this.STORAGE_KEY]: this.cachedState });
      });
      return this.cachedState;
    }

    // Default state if nothing exists
    this.cachedState = {
      isExtracting: false,
      currentChannel: null,
      extractedMessages: {},
      isScrollingEnabled: true,
    };
    return this.cachedState;
  }

  private async loadAllMessagesFromStorage(): Promise<MessagesByOrganization> {
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
    ].filter((messages): messages is MessagesByOrganization => {
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
      return possibleMessages.reduce((acc, messages) => {
        return this.deduplicateAndMergeMessages(acc, messages);
      }, defaultMessages);
    } catch (error) {
      console.error('Error merging messages:', error);
      return defaultMessages;
    }
  }

  public async loadAllMessages(): Promise<MessagesByOrganization> {
    const state = await this.loadState();
    return state.extractedMessages;
  }

  public async saveAllMessages(messages: MessagesByOrganization): Promise<void> {
    // Validate messages before saving
    const validatedMessages = MessagesByOrganizationSchema.parse(messages);

    // Update cached state
    if (this.cachedState) {
      this.cachedState.extractedMessages = validatedMessages;
    }

    // Schedule the write operation
    this.scheduleWrite(async () => {
      await chrome.storage.local.set({
        allMessages: validatedMessages,
        [this.STORAGE_KEY]: {
          ...(await this.loadState()),
          extractedMessages: validatedMessages,
        },
        [this.LEGACY_KEY]: {
          ...(await this.loadState()),
          extractedMessages: validatedMessages,
        },
      });
    });
  }

  private deduplicateAndMergeMessages(
    currentMessages: MessagesByOrganization,
    newMessages: MessagesByOrganization,
  ): MessagesByOrganization {
    const result = merge({}, currentMessages);
    const messageMap = new Map<string, Set<string>>();

    // Helper function to generate message key
    const getMessageKey = (msg: SlackMessage): string => {
      const timestamp =
        typeof msg.timestamp === 'string'
          ? new Date(msg.timestamp).setMilliseconds(0).toString()
          : '0';
      return `${msg.text}|${msg.sender}|${msg.senderId}|${timestamp}`;
    };

    // Process new messages
    for (const [org, orgData] of Object.entries(newMessages)) {
      if (!(org in result)) {
        result[org] = {};
      }

      for (const [channel, channelData] of Object.entries(orgData)) {
        if (!(channel in result[org])) {
          result[org][channel] = {};
        }

        for (const [date, messages] of Object.entries(channelData)) {
          if (!(date in result[org][channel])) {
            result[org][channel][date] = [];
          }

          // Initialize message set for this date if needed
          const dateKey = `${org}|${channel}|${date}`;
          const existingKeys =
            messageMap.get(dateKey) ?? new Set(result[org][channel][date].map(getMessageKey));
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
          result[org][channel][date].sort((a, b) => {
            const timeA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : 0;
            const timeB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : 0;
            return timeA - timeB;
          });
        }
      }
    }

    return result;
  }

  public async mergeAndSaveMessages(
    currentMessages: MessagesByOrganization,
    newMessages: MessagesByOrganization,
  ): Promise<MessagesByOrganization> {
    // Validate both message sets
    const validatedCurrentMessages = MessagesByOrganizationSchema.parse(currentMessages);
    const validatedNewMessages = MessagesByOrganizationSchema.parse(newMessages);

    const mergedMessages = this.deduplicateAndMergeMessages(
      validatedCurrentMessages,
      validatedNewMessages,
    );

    await this.saveAllMessages(mergedMessages);
    return mergedMessages;
  }

  public async deleteChannelMessages(organization: string, channel: string): Promise<void> {
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
  }

  public async saveState(
    state: Omit<StorageState, 'isScrollingEnabled'> & { isScrollingEnabled?: boolean },
  ): Promise<void> {
    const currentState = await this.loadState();
    const newState = {
      ...state,
      isScrollingEnabled: state.isScrollingEnabled ?? currentState.isScrollingEnabled,
    };

    this.cachedState = newState;
    this.scheduleWrite(async () => {
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: newState,
        [this.LEGACY_KEY]: {
          isExtracting: newState.isExtracting,
          currentChannel: newState.currentChannel,
          extractedMessages: newState.extractedMessages,
        },
      });
    });
  }

  public async setScrollingEnabled(enabled: boolean): Promise<void> {
    const currentState = await this.loadState();
    await this.saveState({
      ...currentState,
      isScrollingEnabled: enabled,
    });
  }

  public async isScrollingEnabled(): Promise<boolean> {
    const state = await this.loadState();
    return state.isScrollingEnabled;
  }
}
