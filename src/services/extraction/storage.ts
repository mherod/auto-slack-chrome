import { merge } from 'lodash';
import { ExtensionStateSchema, MessagesByOrganizationSchema } from './schemas';
import type { ExtensionState, MessagesByOrganization } from './types';

export class StorageService {
  public async loadState(): Promise<ExtensionState> {
    const result = await chrome.storage.local.get(['extensionState']);
    const defaultState: ExtensionState = {
      isExtracting: false,
      currentChannel: null,
      extractedMessages: {},
    };

    if (typeof result.extensionState !== 'object' || result.extensionState === null) {
      return defaultState;
    }

    try {
      return ExtensionStateSchema.parse(result.extensionState);
    } catch (error) {
      console.error('Invalid extension state:', error);
      return defaultState;
    }
  }

  public async saveState(state: ExtensionState): Promise<void> {
    // Validate state before saving
    const validatedState = ExtensionStateSchema.parse(state);

    // Always merge with existing state using lodash merge
    const currentState = await this.loadState();
    const mergedState = merge({}, currentState, validatedState, {
      extractedMessages: await this.mergeAndSaveMessages(
        currentState.extractedMessages,
        validatedState.extractedMessages,
      ),
    });
    await chrome.storage.local.set({ extensionState: mergedState });
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
