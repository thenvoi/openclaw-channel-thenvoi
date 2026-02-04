#!/usr/bin/env node
/**
 * Test script to verify Thenvoi connection directly
 * Run: node test-connection.js
 */

import { ThenvoiClient } from '../dist/index.js';
import { ThenvoiRuntime } from '../dist/index.js';

// Load env vars
// Note: wsUrl should be base socket URL - Phoenix appends /websocket automatically
const config = {
  apiKey: process.env.THENVOI_API_KEY,
  agentId: process.env.THENVOI_AGENT_ID,
  wsUrl: process.env.THENVOI_WS_URL || 'wss://app.thenvoi.com/api/v1/socket',
  restUrl: process.env.THENVOI_REST_URL || 'https://app.thenvoi.com',
};

console.log('Testing Thenvoi connection...');
console.log('Config:', {
  ...config,
  apiKey: config.apiKey ? '***' : 'MISSING',
});

async function test() {
  // Test REST client
  console.log('\n1. Testing REST API...');
  const client = new ThenvoiClient(config);

  try {
    const agent = await client.getAgentMe();
    console.log('   ✅ REST API works! Agent:', agent.name || agent.id);
  } catch (err) {
    console.log('   ❌ REST API failed:', err.message);
    return;
  }

  // Test WebSocket
  console.log('\n2. Testing WebSocket connection...');
  const runtime = new ThenvoiRuntime(config, {
    onMessage: (msg) => console.log('   📨 Message:', msg.content?.substring(0, 50)),
    onRoomJoined: (id, title) => console.log(`   🚪 Joined room: ${title}`),
    onRoomLeft: (id) => console.log(`   🚪 Left room: ${id}`),
    onError: (err) => console.log('   ❌ Error:', err.message),
    onReconnecting: (attempt) => console.log(`   🔄 Reconnecting (${attempt})`),
    onReconnected: () => console.log('   ✅ Reconnected'),
    onSyncStarted: () => console.log('   🔄 Syncing...'),
    onSyncCompleted: (n) => console.log(`   ✅ Synced ${n} messages`),
    onSyncError: (err) => console.log('   ❌ Sync error:', err.message),
  }, client);

  try {
    await runtime.connect();
    console.log('   ✅ WebSocket connected!');
    console.log('\nWaiting for messages... (Ctrl+C to stop)');
  } catch (err) {
    console.log('   ❌ WebSocket failed:', err.message);
  }
}

test().catch(console.error);
