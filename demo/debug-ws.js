#!/usr/bin/env node
/**
 * Debug WebSocket connection to understand the error details
 */

import WebSocket from 'ws';

const config = {
  apiKey: process.env.THENVOI_API_KEY,
  agentId: process.env.THENVOI_AGENT_ID,
  wsUrl: process.env.THENVOI_WS_URL || 'wss://platform.dev.thenvoi.com/api/v1/socket/websocket',
};

console.log('Debug WebSocket connection...');
console.log('Config:', {
  ...config,
  apiKey: config.apiKey ? '***' : 'MISSING',
});

// Try direct WebSocket connection with params as Phoenix would
const params = new URLSearchParams({
  api_key: config.apiKey,
  agent_id: config.agentId,
  vsn: '2.0.0',
});

const url = `${config.wsUrl}?${params.toString()}`;
console.log('\nConnecting to:', url.replace(config.apiKey, '***'));

const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('✅ WebSocket connected!');

  // Try to join the agent_rooms channel
  const joinMsg = JSON.stringify([
    null,  // join_ref
    "1",   // ref
    `agent_rooms:${config.agentId}`,  // topic
    "phx_join",  // event
    {}     // payload
  ]);
  console.log('Sending join:', joinMsg);
  ws.send(joinMsg);
});

ws.on('message', (data) => {
  console.log('📨 Received:', data.toString());
});

ws.on('error', (error) => {
  console.log('❌ WebSocket error:', error);
  console.log('   Error code:', error.code);
  console.log('   Error message:', error.message);
});

ws.on('close', (code, reason) => {
  console.log('🔒 WebSocket closed');
  console.log('   Code:', code);
  console.log('   Reason:', reason.toString());
});

// Keep alive for 10 seconds
setTimeout(() => {
  console.log('\nClosing connection...');
  ws.close();
  process.exit(0);
}, 10000);
