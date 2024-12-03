import { z } from 'zod';

export const CustomStatusSchema = z.object({
  emoji: z.string().nullable(),
  emojiUrl: z.string().nullable(),
});

export const SlackMessageSchema = z.object({
  sender: z.string().nullable(),
  senderId: z.string().nullable(),
  timestamp: z.string().nullable(),
  text: z.string(),
  permalink: z.string().nullable(),
  customStatus: CustomStatusSchema.nullable(),
  avatarUrl: z.string().nullable(),
  messageId: z.string().nullable(),
  isInferredSender: z.boolean().default(false),
});

export const ChannelInfoSchema = z.object({
  channel: z.string(),
  organization: z.string(),
});

export const MessagesByDateSchema = z.record(z.string(), z.array(SlackMessageSchema));
export const MessagesByChannelSchema = z.record(z.string(), MessagesByDateSchema);
export const MessagesByOrganizationSchema = z.record(z.string(), MessagesByChannelSchema);

export const ExtensionStateSchema = z.object({
  isExtracting: z.boolean(),
  currentChannel: ChannelInfoSchema.nullable(),
  extractedMessages: MessagesByOrganizationSchema,
});

export const LastKnownSenderSchema = z.object({
  sender: z.string(),
  senderId: z.string(),
  avatarUrl: z.string().nullable(),
  customStatus: CustomStatusSchema.nullable(),
});

export const SenderInfoSchema = z.object({
  sender: z.string().nullable(),
  senderId: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  customStatus: CustomStatusSchema.nullable(),
  isInferred: z.boolean(),
});

export const HeartbeatMessageSchema = z.object({
  type: z.literal('heartbeat'),
  timestamp: z.number(),
  status: z.object({
    isExtracting: z.boolean(),
    channelInfo: ChannelInfoSchema.nullable(),
    messageCount: z.number(),
  }),
});

export const SyncMessageSchema = z.object({
  type: z.literal('sync'),
  timestamp: z.number(),
  data: z.object({
    extractedMessages: MessagesByOrganizationSchema,
    currentChannel: ChannelInfoSchema.nullable(),
  }),
});

export const ExtractionControlMessageSchema = z.object({
  type: z.union([z.literal('START_EXTRACTION'), z.literal('STOP_EXTRACTION')]),
});

export const ContentScriptMessageSchema = z.union([HeartbeatMessageSchema, SyncMessageSchema]);
export const IncomingMessageSchema = z.union([
  ContentScriptMessageSchema,
  ExtractionControlMessageSchema,
]);

// Export inferred types
export type CustomStatus = z.infer<typeof CustomStatusSchema>;
export type SlackMessage = z.infer<typeof SlackMessageSchema>;
export type ChannelInfo = z.infer<typeof ChannelInfoSchema>;
export type MessagesByDate = z.infer<typeof MessagesByDateSchema>;
export type MessagesByChannel = z.infer<typeof MessagesByChannelSchema>;
export type MessagesByOrganization = z.infer<typeof MessagesByOrganizationSchema>;
export type ExtensionState = z.infer<typeof ExtensionStateSchema>;
export type LastKnownSender = z.infer<typeof LastKnownSenderSchema>;
export type SenderInfo = z.infer<typeof SenderInfoSchema>;
export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>;
export type SyncMessage = z.infer<typeof SyncMessageSchema>;
export type ExtractionControlMessage = z.infer<typeof ExtractionControlMessageSchema>;
export type ContentScriptMessage = z.infer<typeof ContentScriptMessageSchema>;
export type IncomingMessage = z.infer<typeof IncomingMessageSchema>;
