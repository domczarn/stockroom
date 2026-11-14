import { unique, sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const purchaseImports = sqliteTable('purchase_imports', {
  transactionId: text('transaction_id').primaryKey(),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const members = sqliteTable('members', {
  email: text('email').primaryKey(),
  userId: text('user_id').unique(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull()
});
export const workspaces = sqliteTable('workspaces', {
  ownerId: text('owner_id').primaryKey(),
  payload: text('payload').notNull(),
  revision: text('revision').notNull(),
  updatedAt: text('updated_at').notNull()
});
export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').notNull(),
  ownerId: text('owner_id').notNull(),
  action: text('action').notNull(),
  createdAt: text('created_at').notNull()
});

export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  window: integer('window').notNull(),
  count: integer('count').notNull()
});

export const profiles = sqliteTable('profiles', {
  userId: text('user_id').primaryKey(),
  username: text('username').unique(),
  avatarSeed: text('avatar_seed').notNull().unique(),
  shareRevenue: integer('share_revenue').notNull().default(0),
  owner: integer('owner').notNull().default(0),
  shareActivity: integer('share_activity').notNull().default(1),
  shareLeaderboard: integer('share_leaderboard').notNull().default(0),
  lastActiveAt: text('last_active_at')
});

export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(),
  sender: text('sender').notNull(),
  recipient: text('recipient').notNull(),
  state: text('state').notNull(),
  blockedBy: text('blocked_by')
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  connection: text('connection').notNull(),
  sender: text('sender').notNull(),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull()
}, table => [index('messages_connection_time').on(table.connection, table.createdAt, table.id)]);

export const saleImports = sqliteTable('sale_imports', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const messageReads = sqliteTable('message_reads', {
  key: text('key').primaryKey(),
  cursor: text('cursor').notNull()
});

export const pushKeys = sqliteTable('push_keys', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull()
});

export const pushDevices = sqliteTable('push_devices', {
  endpoint: text('endpoint').primaryKey(),
  ownerId: text('owner_id').notNull(),
  subscription: text('subscription').notNull(),
  updatedAt: text('updated_at').notNull()
}, table=>[index('push_devices_owner').on(table.ownerId)]);

export const emailSync = sqliteTable('email_sync', {
  id: text('id').primaryKey(),
  enabled: integer('enabled').notNull().default(1),
  mailbox: text('mailbox'),
  state: text('state').notNull().default('unverified'),
  checkedAt: text('checked_at')
});

export const accessNotices = sqliteTable('access_notices', {
  id: text('id').primaryKey(),
  state: text('state').notNull(),
  submittedAt: text('submitted_at').notNull()
});

export const notificationReads = sqliteTable('notification_reads', {
  ownerId: text('owner_id').notNull(),
  eventKey: text('event_key').notNull(),
  readAt: text('read_at').notNull(),
}, table=>[unique('notification_reads_owner_event').on(table.ownerId,table.eventKey)]);

export const marketResearch = sqliteTable('market_research', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  periodEnd: text('period_end').notNull(),
  checkedOn: text('checked_on').notNull()
});

export const gmailConnections = sqliteTable('gmail_connections', {
  ownerId: text('owner_id').primaryKey(),
  connectionId: text('connection_id').notNull(),
  mailbox: text('mailbox').notNull(),
  token: text('token').notNull(),
  enabled: integer('enabled').notNull().default(1),
  alerts: integer('alerts').notNull().default(0),
  days: integer('days').notNull().default(7),
  state: text('state').notNull().default('connected'),
  checkedAt: text('checked_at'),
  lease: integer('lease').notNull().default(0),
  receipts: text('receipts').notNull().default('[]')
});

export const gmailOAuthStates = sqliteTable('gmail_oauth_states', {
  ownerId: text('owner_id').primaryKey(),
  state: text('state').notNull(),
  verifier: text('verifier').notNull(),
  expiresAt: integer('expires_at').notNull()
});

export const messageDeliveries = sqliteTable('message_deliveries', {
  key: text('key').primaryKey(),
  cursor: text('cursor').notNull()
});

export const chatTyping = sqliteTable('chat_typing', {
  key: text('key').primaryKey(),
  expiresAt: integer('expires_at').notNull()
});
