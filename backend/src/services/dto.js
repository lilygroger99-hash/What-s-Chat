const iso = (d) => (d ? new Date(d).toISOString() : null);

export const userDto = (u) => ({
  id: u.id,
  phone: u.phone,
  name: u.name,
  about: u.about,
  avatarUrl: u.avatar_url ?? null,
});

export const messageDto = (m) => ({
  id: m.id,
  chatId: m.chat_id,
  seq: m.seq,
  senderId: m.sender_id,
  clientMsgId: m.client_msg_id,
  type: m.type,
  content: m.deleted_at ? '' : m.content,
  replyTo: m.reply_to ?? null,
  createdAt: iso(m.created_at),
  deleted: Boolean(m.deleted_at),
});
