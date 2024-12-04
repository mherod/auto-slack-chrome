import { merge } from 'lodash';
import { z } from 'zod';
import { MessagesByOrganizationSchema } from './schemas';
import type { MessagesByOrganization } from './types';

const StorageStateSchema = z.object({
  isExtracting: z.boolean(),
  currentChannel: z.union([
    z.null(),
    z.object({
      organization: z.string(),
      channel: z.string(),
    }),
  ]),
  extractedMessages: z.record(
    z.string(),
    z.record(z.string(), z.record(z.string(), z.array(z.any()))),
  ),
  isScrollingEnabled: z.boolean().default(true),
});

type StorageState = z.infer<typeof StorageStateSchema>;

export class StorageService {
  private readonly STORAGE_KEY = 'slack-extractor-state';
  private readonly LEGACY_KEY = 'extensionState';

  public async loadState(): Promise<StorageState> {
    const data = await chrome.storage.local.get([this.STORAGE_KEY, this.LEGACY_KEY]);

    // Try loading from new storage key first
    if (data[this.STORAGE_KEY]) {
      const state = StorageStateSchema.parse(data[this.STORAGE_KEY]);
      return state;
    }

    // Fall back to legacy storage
    if (data[this.LEGACY_KEY]) {
      const legacyState = data[this.LEGACY_KEY];
      // Migrate legacy state to new format
      const migratedState = {
        isExtracting: legacyState.isExtracting ?? false,
        currentChannel: legacyState.currentChannel ?? null,
        extractedMessages: legacyState.extractedMessages ?? {},
        isScrollingEnabled: true, // Default for migrated states
      };

      // Save migrated state in new format
      await this.saveState(migratedState);
      return StorageStateSchema.parse(migratedState);
    }

    // Default state if nothing exists
    return {
      isExtracting: false,
      currentChannel: null,
      extractedMessages: {},
      isScrollingEnabled: true,
    };
  }

  public async saveState(
    state: Omit<StorageState, 'isScrollingEnabled'> & { isScrollingEnabled?: boolean },
  ): Promise<void> {
    const currentState = await this.loadState();
    const newState = {
      ...state,
      isScrollingEnabled: state.isScrollingEnabled ?? currentState.isScrollingEnabled,
    };

    // Save to both storage keys for backward compatibility
    await chrome.storage.local.set({
      [this.STORAGE_KEY]: newState,
      [this.LEGACY_KEY]: {
        isExtracting: newState.isExtracting,
        currentChannel: newState.currentChannel,
        extractedMessages: newState.extractedMessages,
      },
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

  public async loadAllMessages(): Promise<MessagesByOrganization> {
    const result = await chrome.storage.local.get(['allMessages']);
    const defaultMessages: MessagesByOrganization = {};

    if (typeof result.allMessages !== 'object' || result.allMessages === null) {
      return defaultMessages;
    }

    try {
      return MessagesByOrganizationSchema.parse(result.allMessages);
    } catch (error) {
      console.error('Invalid messages:', error);
      return defaultMessages;
    }
  }

  public async saveAllMessages(messages: MessagesByOrganization): Promise<void> {
    // Validate messages before saving
    const validatedMessages = MessagesByOrganizationSchema.parse(messages);

    // Merge with existing messages before saving
    const currentMessages = await this.loadAllMessages();
    const mergedMessages = this.deduplicateAndMergeMessages(currentMessages, validatedMessages);
    await chrome.storage.local.set({ allMessages: mergedMessages });
  }

  private deduplicateAndMergeMessages(
    currentMessages: MessagesByOrganization,
    newMessages: MessagesByOrganization,
  ): MessagesByOrganization {
    const result = merge({}, currentMessages);

    // Iterate through new messages
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

          // Process each new message
          for (const newMessage of messages) {
            const existingMessageIndex = result[org][channel][date].findIndex(
              (existing) =>
                // Match on content and sender
                existing.text === newMessage.text &&
                existing.sender === newMessage.sender &&
                existing.senderId === newMessage.senderId &&
                // Only match if we have valid timestamps
                existing.timestamp !== null &&
                newMessage.timestamp !== null &&
                // Compare timestamps without milliseconds for deduplication
                new Date(existing.timestamp).setMilliseconds(0) ===
                  new Date(newMessage.timestamp).setMilliseconds(0),
            );

            if (existingMessageIndex !== -1) {
              // Update existing message with any new information
              const existingMessage = result[org][channel][date][existingMessageIndex];
              result[org][channel][date][existingMessageIndex] = merge(
                {},
                existingMessage,
                newMessage,
                {
                  // Preserve the original timestamp if it exists
                  timestamp: existingMessage.timestamp ?? newMessage.timestamp,
                  // Preserve the original messageId if it exists
                  messageId: existingMessage.messageId ?? newMessage.messageId,
                  // Keep the more accurate sender information
                  isInferredSender: newMessage.isInferredSender && existingMessage.isInferredSender,
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
                },
              );
            } else {
              // Add new message
              result[org][channel][date].push(newMessage);
            }
          }

          // Sort messages by timestamp
          result[org][channel][date].sort((a, b) => {
            const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
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

    const allMessages = await this.loadAllMessages();
    const mergedMessages = this.deduplicateAndMergeMessages(
      allMessages,
      this.deduplicateAndMergeMessages(validatedCurrentMessages, validatedNewMessages),
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
}
