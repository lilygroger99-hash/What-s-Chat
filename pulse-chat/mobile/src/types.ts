export interface User {
  id: string;
  phone: string;
  name: string;
  about: string;
  avatarUrl: string | null;
}

export interface ServerMessage {
  id: string;
  chatId: string;
  seq: number;
  senderId: string;
  clientMsgId: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'system';
  content: string;
  replyTo: string | null;
  createdAt: string;
  deleted: boolean;
}

export interface ServerParticipant {
  userId: string;
  name: string;
  phone: string;
  avatarUrl: string | null;
  about: string;
  role: 'owner' | 'admin' | 'member';
  lastSeen: string | null;
  online: boolean;
  lastDeliveredSeq: number;
  lastReadSeq: number;
}

export interface ServerChat {
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  avatarUrl: string | null;
  lastSeq: number;
  updatedAt: string;
  unread: number;
  myReadSeq: number;
  myDeliveredSeq: number;
  lastMessage: ServerMessage | null;
  participants: ServerParticipant[];
}

export interface Receipt {
  chatId: string;
  userId: string;
  deliveredSeq: number;
  readSeq: number;
}

export interface SyncResult {
  messages: ServerMessage[];
  chats: ServerChat[];
  receipts: Receipt[];
  hasMore: boolean;
}

export interface AuthResult {
  user: User;
  isNewUser?: boolean;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type MessageState = 'pending' | 'sent' | 'failed';
export type Tick = 'pending' | 'failed' | 'sent' | 'delivered' | 'read';

/** Row shapes as stored in the local SQLite database. */
export interface LocalMessage {
  client_msg_id: string;
  id: string | null;
  chat_id: string;
  seq: number | null;
  sender_id: string;
  type: string;
  content: string;
  created_at: string;
  state: MessageState;
}

export interface LocalParticipant {
  chat_id: string;
  user_id: string;
  name: string;
  phone: string;
  role: string;
  delivered_seq: number;
  read_seq: number;
  online: number;
  last_seen: string | null;
}

export interface LocalChat {
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  last_seq: number;
  synced_seq: number;
  unread: number;
  my_read_seq: number;
  my_delivered_seq: number;
  updated_at: string;
}
