const WebSocket = require('ws');

console.log('Testing chat WebSocket connection...');

const ws = new WebSocket('ws://localhost:5002/chat-streaming?bot_id=3');

ws.on('open', () => {
  console.log('✅ WebSocket connected successfully!');
  
  // Send a ping to test connection
  ws.send(JSON.stringify({
    type: 'ping'
  }));
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data);
    console.log('📨 Received message:', message);
    
    if (message.type === 'welcome') {
      console.log('✅ Welcome message received');
      
      // Send user details
      ws.send(JSON.stringify({
        type: 'user_details',
        details: {
          name: 'Test User',
          email: 'test@example.com',
          phone: '1234567890'
        }
      }));
    } else if (message.type === 'user_details_received') {
      console.log('✅ User details received');
      
      // Send a test chat message
      ws.send(JSON.stringify({
        type: 'chat_message',
        content: 'Hello, this is a test message!'
      }));
    } else if (message.type === 'bot_reply') {
      console.log('✅ Bot reply received');
      ws.close();
    } else if (message.type === 'error') {
      console.log('❌ Error received:', message.message);
      ws.close();
    }
  } catch (error) {
    console.error('Error parsing message:', error);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error);
});

ws.on('close', (code, reason) => {
  console.log(`🔌 WebSocket closed with code: ${code} reason: ${reason}`);
}); 