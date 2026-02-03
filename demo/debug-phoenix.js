#!/usr/bin/env node
/**
 * Debug Phoenix connection to understand the error
 */

import { Socket } from 'phoenix';
import WebSocket from 'ws';

const config = {
  apiKey: process.env.THENVOI_API_KEY,
  agentId: process.env.THENVOI_AGENT_ID,
  // Phoenix appends /websocket automatically, so use base socket URL
  wsUrl: process.env.THENVOI_WS_URL?.replace('/websocket', '') || 'wss://platform.dev.thenvoi.com/api/v1/socket',
};

console.log('Debug Phoenix connection...');
console.log('Config:', {
  ...config,
  apiKey: config.apiKey ? '***' : 'MISSING',
});

console.log('\nWebSocket class:', typeof WebSocket);
console.log('WebSocket.prototype:', WebSocket.prototype ? 'exists' : 'missing');

// Create socket with transport
const socket = new Socket(config.wsUrl, {
  params: {
    api_key: config.apiKey,
    agent_id: config.agentId,
  },
  transport: WebSocket,
});

console.log('\nSocket created');
console.log('Socket endpoint:', socket.endPointURL());

socket.onOpen(() => {
  console.log('✅ Socket opened!');

  // Try to join channel
  const topic = `agent_rooms:${config.agentId}`;
  console.log(`\nJoining channel: ${topic}`);

  const channel = socket.channel(topic, {});

  channel.join()
    .receive('ok', (resp) => {
      console.log('✅ Channel joined!', resp);
    })
    .receive('error', (resp) => {
      console.log('❌ Channel error:', resp);
    })
    .receive('timeout', () => {
      console.log('❌ Channel timeout');
    });
});

socket.onError((error) => {
  console.log('❌ Socket error:');
  console.log('   Type:', typeof error);
  console.log('   Constructor:', error?.constructor?.name);
  console.log('   Keys:', error ? Object.keys(error) : 'null');
  if (error instanceof Error) {
    console.log('   Message:', error.message);
    console.log('   Stack:', error.stack);
  } else {
    console.log('   Value:', JSON.stringify(error, null, 2));
  }
});

socket.onClose((event) => {
  console.log('🔒 Socket closed:');
  console.log('   Type:', typeof event);
  console.log('   Constructor:', event?.constructor?.name);
  if (event) {
    console.log('   Code:', event.code);
    console.log('   Reason:', event.reason);
    console.log('   WasClean:', event.wasClean);
  }
});

console.log('\nConnecting...');
socket.connect();

// Keep alive for 15 seconds
setTimeout(() => {
  console.log('\nDisconnecting...');
  socket.disconnect();
  process.exit(0);
}, 15000);
