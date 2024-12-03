import { merge } from 'lodash';
import type { ExtensionState, MessagesByOrganization } from './types';
import { ExtensionStateSchema, MessagesByOrganizationSchema } from './schemas';

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
    const mergedMessages = merge({}, currentMessages, validatedMessages);
    await chrome.storage.local.set({ allMessages: mergedMessages });
  }

  public async mergeAndSaveMessages(
    currentMessages: MessagesByOrganization,
    newMessages: MessagesByOrganization,
  ): Promise<MessagesByOrganization> {
    // Validate both message sets
    const validatedCurrentMessages = MessagesByOrganizationSchema.parse(currentMessages);
    const validatedNewMessages = MessagesByOrganizationSchema.parse(newMessages);

    const allMessages = await this.loadAllMessages();
    const mergedMessages = merge({}, allMessages, validatedCurrentMessages, validatedNewMessages);
    await this.saveAllMessages(mergedMessages);
    return mergedMessages;
  }
}
