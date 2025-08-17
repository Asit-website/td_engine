const WebSocket = require('ws');
const axios = require('axios');
const ConversationSummarizer = require('./conversation-summarizer');

const chatStreamingModule = ({ logger, makeService }) => {
  const summarizer = new ConversationSummarizer();
  
  // Make summarizer available globally for this module
  global.chatSummarizer = summarizer;
  
  const wss = new WebSocket.Server({ 
    noServer: true,
    clientTracking: true,
    perMessageDeflate: false,
    maxPayload: 1024 * 1024 // 1MB max payload
  });
  
  const chatSessions = new Map();

  wss.on('connection', (ws, request) => {
    console.log('✅ WebSocket connection established');
    
    try {
      const url = new URL(request.url, 'http://localhost');
      const botId = url.searchParams.get('bot_id');

      if (!botId) {
        console.log('❌ WebSocket connection rejected: Bot ID required');
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Bot ID required'
        }));
        ws.close(1008, 'Bot ID required');
        return;
      }

      console.log(`🎯 Chat WebSocket connected for bot: ${botId}`);

      const sessionId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const session = {
        id: sessionId,
        botId: botId,
        ws: ws,
        startTime: new Date(),
        userDetails: {},
        messages: [],
        status: 'connecting'
      };

      chatSessions.set(sessionId, session);

      // Set up connection timeout
      const connectionTimeout = setTimeout(() => {
        if (session.status === 'connecting') {
          console.log(`⏰ Connection timeout for session ${sessionId}`);
          ws.close(1000, 'Connection timeout');
        }
      }, 30000); // 30 second timeout

      // Fetch bot details from backend API
      axios.get(`http://localhost:5000/api/admin/bots/${botId}`)
        .then(response => {
          const bot = response.data;
          
          if (!bot || !bot.active) {
            console.log(`❌ Bot not found or inactive for ID: ${botId}`);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Bot not found or inactive'
            }));
            ws.close();
            return;
          }

          session.bot = bot;
          session.status = 'active';
          clearTimeout(connectionTimeout);

          // Send welcome message
          ws.send(JSON.stringify({
            type: 'welcome',
            message: `Welcome to ${bot.name}! Please provide your details to get started.`,
            user_prompt_fields: bot.user_prompt_fields || [
              { name: 'name', label: 'Your Name', required: true, type: 'text' },
              { name: 'email', label: 'Email Address', required: true, type: 'email' },
              { name: 'phone', label: 'Phone Number', required: false, type: 'phone' }
            ]
          }));

          console.log(`✅ Chat session ${sessionId} initialized for bot: ${botId}`);
        })
        .catch(error => {
          console.error('❌ Error fetching bot:', error);
          clearTimeout(connectionTimeout);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Error initializing chat session'
          }));
          ws.close();
        });

      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data);

          switch (message.type) {
            case 'user_details':
              session.userDetails = message.details;
              session.status = 'ready';

              ws.send(JSON.stringify({
                type: 'user_details_received',
                message: 'Thank you! How can I help you today?'
              }));
              break;

            case 'chat_message':
              if (session.status !== 'ready') {
                ws.send(JSON.stringify({
                  type: 'error',
                  message: 'Please provide your details first'
                }));
                return;
              }

              const chatMessage = {
                id: `msg_${Date.now()}`,
                type: 'user',
                content: message.content,
                timestamp: new Date(),
                userDetails: session.userDetails
              };

              session.messages.push(chatMessage);

              try {
                // Send to N8N webhook with correct format
                const n8nPayload = {
                  message: message.content,
                  sessionId: sessionId,
                  timestamp: new Date().toISOString()
                };

                const response = await axios.post(session.bot.webhook_url, n8nPayload, {
                  timeout: 10000,
                  headers: { 'Content-Type': 'application/json' }
                });

                if (response.data && response.data.reply) {
                  const botReply = {
                    id: `msg_${Date.now()}_bot`,
                    type: 'bot',
                    content: response.data.reply,
                    timestamp: new Date()
                  };

                  session.messages.push(botReply);

                  ws.send(JSON.stringify({
                    type: 'bot_reply',
                    message: response.data.reply
                  }));
                } else {
                  // If no reply from webhook, send a default response
                  const botReply = {
                    id: `msg_${Date.now()}_bot`,
                    type: 'bot',
                    content: 'Thank you for your message. I will get back to you soon.',
                    timestamp: new Date()
                  };

                  session.messages.push(botReply);

                  ws.send(JSON.stringify({
                    type: 'bot_reply',
                    message: 'Thank you for your message. I will get back to you soon.'
                  }));
                }

              } catch (webhookError) {
                console.error('❌ N8N webhook error:', webhookError);
                
                // Send a fallback response instead of error
                const botReply = {
                  id: `msg_${Date.now()}_bot`,
                  type: 'bot',
                  content: 'I am currently processing your request. Please wait a moment.',
                  timestamp: new Date()
                };

                session.messages.push(botReply);

                ws.send(JSON.stringify({
                  type: 'bot_reply',
                  message: 'I am currently processing your request. Please wait a moment.'
                }));
              }
              break;

            case 'ping':
              ws.send(JSON.stringify({
                type: 'pong',
                message: 'pong'
              }));
              break;
              
            default:
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Unknown message type'
              }));
          }

        } catch (error) {
          console.error('❌ Error processing chat message:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Error processing message'
          }));
        }
      });

      ws.on('close', (code, reason) => {
        console.log(`🔌 Chat session ${sessionId} closed with code: ${code}, reason: ${reason}`);
        clearTimeout(connectionTimeout);

        if (session.messages.length > 0) {
          saveConversationToDatabase(session);
        }

        chatSessions.delete(sessionId);
      });

      // Send heartbeat every 60 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({
              type: 'heartbeat',
              message: 'ping'
            }));
          } catch (error) {
            console.error('❌ Heartbeat error:', error);
            clearInterval(heartbeat);
          }
        } else {
          clearInterval(heartbeat);
        }
      }, 60000); // Changed from 30000 to 60000 (60 seconds)

      ws.on('error', (error) => {
        console.error(`❌ Chat WebSocket error for session ${sessionId}:`, error);
        clearInterval(heartbeat);
        clearTimeout(connectionTimeout);
        chatSessions.delete(sessionId);
      });
    } catch (error) {
      console.error('❌ Error in WebSocket connection:', error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, 'Internal server error');
      }
    }
  });

  const saveConversationToDatabase = async (session) => {
    try {
      console.log(`💾 Saving conversation ${session.id} to database...`);
      console.log('Session messages:', session.messages);
      
      const conversationData = {
        conversation_id: session.id,
        bot_id: session.botId,
        channel_type: 'chat',
        user_details: session.userDetails,
        message_log: session.messages.map(msg => ({
          sender: msg.sender || (msg.type === 'user' ? 'user' : 'agent'),
          message: msg.content || msg.message || '',
          timestamp: msg.timestamp || new Date(),
          sentiment: 'neutral',
          tags: []
        })),
        started_at: session.startTime,
        ended_at: new Date(),
        duration_minutes: Math.floor((new Date() - session.startTime) / 1000 / 60),
        status: 'completed'
      };

      console.log('Conversation data to save:', JSON.stringify(conversationData, null, 2));

      const response = await axios.post('http://localhost:5000/api/conversations/save', conversationData, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });

      console.log(`✅ Conversation ${session.id} saved to database successfully:`, response.data);

      // Generate and save conversation summary
      if (session.messages.length > 0) {
        try {
          console.log(`🤖 Generating summary for conversation ${session.id}...`);
          const summary = await global.chatSummarizer.summarizeConversation(session.messages);
          
          if (summary) {
            // Get the conversation ID from the response
            const savedConversation = response.data;
            const conversationId = savedConversation.conversation_id || session.id;
            
            // Update conversation with summary
            await global.chatSummarizer.updateConversationSummary(conversationId, summary);
            console.log(`✅ Summary generated and saved for conversation ${session.id}`);
          }
        } catch (summaryError) {
          console.error('❌ Error generating summary:', summaryError.message);
        }
      }

    } catch (error) {
      console.error('❌ Error saving conversation:', error.message);
      if (error.response) {
        console.error('Response data:', error.response.data);
      }
    }
  };

  return wss;
};

module.exports = chatStreamingModule; 