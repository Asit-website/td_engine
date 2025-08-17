const axios = require('axios');
const assert = require('assert');
const ConversationSummarizer = require('./conversation-summarizer');

// n8n webhook configuration
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://bots.torisedigital.com/webhook/af242424-edf9-43b6-91ef-37017daeb4d7';
assert(N8N_WEBHOOK_URL, 'N8N_WEBHOOK_URL is required');

const service = ({logger, makeService}) => {
  const summarizer = new ConversationSummarizer();
  const svc = makeService({path: '/llm-streaming'});

  // Make summarizer available globally for this service
  global.summarizer = summarizer;

  svc.on('session:new', (session) => {
    session.locals = {
      logger: logger.child({call_sid: session.call_sid}),
      sessionId: session.call_sid, // Use call_sid as sessionId for n8n
      messages: [],
      assistantResponse: '',
      startTime: new Date(), // Set at call attempt
      answeredAt: null,      // Will be set when call is answered
      endTime: null
    };
    logger.debug({session}, `new incoming call: ${session.call_sid}`);
    logger.info(`🎯 REAL CALL STARTED: ${session.call_sid}`);
    
    // Debug session object at start
    logger.info(`🔍 SESSION START DEBUG for ${session.call_sid}:`);
    logger.info(`  - session.call_sid: ${session.call_sid}`);
    logger.info(`  - session.application_sid: ${session.application_sid}`);
    logger.info(`  - session.conversation_id: ${session.conversation_id}`);
    logger.info(`  - session.account_sid: ${session.account_sid}`);
    logger.info(`  - session.parent_call_sid: ${session.parent_call_sid}`);
    logger.info(`  - session.session_id: ${session.session_id}`);
    logger.info(`  - session.from: ${session.from}`);
    logger.info(`  - session.to: ${session.to}`);
    logger.info(`  - session.calling_number: ${session.calling_number}`);
    logger.info(`  - session.called_number: ${session.called_number}`);
    logger.info(`  - Available session properties:`, Object.keys(session));

    session
      .on('/speech-detected', onSpeechDetected.bind(null, session))
      .on('tts:streaming-event', onStreamingEvent.bind(null, session))
      .on('tts:user_interrupt', onUserInterrupt.bind(null, session))
      .on('close', onClose.bind(null, session))
      .on('error', onError.bind(null, session));

    try {
      logger.info(`🔧 CONFIGURING SESSION for ${session.call_sid} with speech detection`);
      session
        .config({
          ttsStream: {
            enable: true,
          },
          bargeIn: {
            enable: true,
            sticky: true,
            minBargeinWordCount: 1,
            actionHook: '/speech-detected',
            input: ['speech']
          }
        })
        .say({text: 'Hi there, how can I help you today?'})
        .send();
      logger.info(`✅ SESSION CONFIGURED for ${session.call_sid} - waiting for speech`);
    } catch (err) {
      session.locals.logger.info({err}, `Error to responding to incoming call: ${session.call_sid}`);
      session.close();
    }
  });
};

const onSpeechDetected = async(session, event) => {
  const {logger, sessionId} = session.locals;
  const {speech} = event;

  logger.info(`🎤 SPEECH DETECTED EVENT for ${session.call_sid}:`, {
    speech: speech,
    is_final: speech?.is_final,
    transcript: speech?.alternatives?.[0]?.transcript
  });

  session.reply();

  if (speech?.is_final) {
    // Set answeredAt only on the first user speech
    if (!session.locals.answeredAt) {
      session.locals.answeredAt = new Date();
      logger.info(`🎯 FIRST SPEECH DETECTED - Setting answeredAt: ${session.locals.answeredAt}`);
    } else {
      logger.info(`🗣️ Additional speech detected, answeredAt already set: ${session.locals.answeredAt}`);
    }
    const {transcript} = speech.alternatives[0];
    session.locals.messages.push({
      role: 'user',
      content: transcript
    });
    session.locals.user_interrupt = false;

    logger.info({messages:session.locals.messages}, `session ${session.call_sid} making request to n8n webhook`);
    logger.info(`🗣️ USER SAID: "${transcript}"`);

    try {
      // Prepare the request payload for n8n webhook
      const payload = {
        message: transcript,
        sessionId: sessionId,
        timestamp: new Date().toISOString()
      };

      logger.info({payload}, `session ${session.call_sid} sending request to n8n`);

      // Make request to n8n webhook
      const response = await axios.post(`${N8N_WEBHOOK_URL}?message=${encodeURIComponent(transcript)}`, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      logger.info({response: response.data}, `session ${session.call_sid} received response from n8n`);

      // Process the response from n8n - extract the 'reply' property
      const responseText = response.data.reply || response.data.message || response.data.text || response.data.response || JSON.stringify(response.data);
      session.locals.assistantResponse = responseText;

      logger.info(`🤖 AGENT RESPONSE: "${responseText}"`);

      // Send the response as TTS tokens
      if (responseText) {
        // Split response into smaller chunks for streaming effect
        const words = responseText.split(' ');
        const chunkSize = 5; // Send 5 words at a time
        
        for (let i = 0; i < words.length; i += chunkSize) {
          if (session.locals.user_interrupt) {
            logger.info(`session ${session.call_sid} user interrupted`);
            session.locals.messages.push({
              role: 'assistant',
              content: `${session.locals.assistantResponse}...`
            });
            session.locals.assistantResponse = '';
            break;
          }

          const chunk = words.slice(i, i + chunkSize).join(' ') + ' ';
          await session.sendTtsTokens(chunk)
            .catch((err) => logger.error({err}, 'error sending TTS tokens'));
          
          // Small delay to simulate streaming
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        if (!session.locals.user_interrupt) {
          logger.info(`session ${session.call_sid} flushing TTS tokens`);
          session.flushTtsTokens();
          session.locals.messages.push({
            role: 'assistant',
            content: session.locals.assistantResponse
          });
          session.locals.assistantResponse = '';
        }
      }
    } catch (err) {
      logger.error({err}, `session ${session.call_sid} error calling n8n webhook`);
      session.sendTtsTokens("I'm sorry, I encountered an error processing your request. Please try again.")
        .catch((err) => logger.error({err}, 'error sending error TTS tokens'));
      session.flushTtsTokens();
    }

    logger.info(`session ${session.call_sid} completed processing response`);
  }
};

const onUserInterrupt = (session) => {
  const {logger} = session.locals;
  logger.info(`session ${session.call_sid} received user interrupt, cancel any requests in progress to n8n`);
  session.locals.user_interrupt = true;
};

const onStreamingEvent = (session, event) => {
  const {logger} = session.locals;
  logger.info({event}, `session ${session.call_sid} received streaming event`);
};

const onClose = async (session, code, reason) => {
  const {logger} = session.locals;
  logger.debug({session, code, reason}, `session ${session.call_sid} closed`);
  logger.info(`🔚 CALL ENDED: ${session.call_sid} - Code: ${code}, Reason: ${reason}`);
  
  // Debug session object to see available fields
  logger.info(`🔍 SESSION OBJECT DEBUG for ${session.call_sid}:`);
  logger.info(`  - session.call_sid: ${session.call_sid}`);
  logger.info(`  - session.application_sid: ${session.application_sid}`);
  logger.info(`  - session.conversation_id: ${session.conversation_id}`);
  logger.info(`  - session.account_sid: ${session.account_sid}`);
  logger.info(`  - session.parent_call_sid: ${session.parent_call_sid}`);
  logger.info(`  - session.session_id: ${session.session_id}`);
  logger.info(`  - Available session properties:`, Object.keys(session));
  
  // Set endTime when call actually ends
  session.locals.endTime = new Date();
  
  // answeredAt will be null if user never spoke
  const answeredAt = session.locals.answeredAt; // Don't fallback to startTime
  const terminatedAt = session.locals.endTime;
  
  // Get duration from Jambonz session if available, otherwise calculate from timestamps
  let totalDurationSeconds;
  let totalDurationMs = 0; // Initialize for logging
  
  if (session.duration) {
    // Use Jambonz provided duration (in seconds)
    totalDurationSeconds = Math.floor(session.duration);
    logger.info(`📞 USING JAMBONZ DURATION: ${session.duration} seconds`);
  } else {
    // Calculate duration from started_at to ended_at (total call duration)
    totalDurationMs = terminatedAt - session.locals.startTime;
    totalDurationSeconds = Math.floor(totalDurationMs / 1000);
    logger.info(`⏱️ CALCULATED DURATION: ${totalDurationMs}ms = ${totalDurationSeconds}s`);
  }
  
  // Format duration: if less than 60 seconds, show as "33s", else show as "1.22m"
  let durationDisplay;
  if (totalDurationSeconds < 60) {
    durationDisplay = `${totalDurationSeconds}s`;
  } else {
    const minutes = totalDurationSeconds / 60;
    durationDisplay = `${minutes.toFixed(2)}m`;
  }
  
  // Debug logging
  logger.info(`🔍 DEBUG TIMESTAMPS for ${session.call_sid}:`);
  logger.info(`  - startTime: ${session.locals.startTime}`);
  logger.info(`  - answeredAt: ${session.locals.answeredAt}`);
  logger.info(`  - endTime: ${session.locals.endTime}`);
  logger.info(`  - calculated answeredAt: ${answeredAt}`);
  logger.info(`  - calculated terminatedAt: ${terminatedAt}`);
  logger.info(`  - totalDurationMs: ${totalDurationMs}`);
  logger.info(`  - totalDurationSeconds: ${totalDurationSeconds}`);
  logger.info(`  - durationDisplay: ${durationDisplay}`);
  logger.info(`  - isLessThan60Seconds: ${totalDurationSeconds < 60}`);
  logger.info(`  - User spoke during call: ${answeredAt ? 'YES' : 'NO'}`);
  
  // Additional duration debugging
  if (session.locals.startTime && terminatedAt) {
    const timeDiffMs = terminatedAt - session.locals.startTime;
    const timeDiffSeconds = timeDiffMs / 1000;
    const timeDiffMinutes = timeDiffSeconds / 60;
    logger.info(`⏱️ DURATION CALCULATION:`);
    logger.info(`  - Time difference (ms): ${timeDiffMs}`);
    logger.info(`  - Time difference (seconds): ${timeDiffSeconds}`);
    logger.info(`  - Time difference (minutes): ${timeDiffMinutes}`);
    logger.info(`  - Floored seconds: ${Math.floor(timeDiffSeconds)}`);
    logger.info(`  - Should show seconds (< 60): ${Math.floor(timeDiffSeconds) < 60 ? 'YES' : 'NO'}`);
  } else {
    logger.info(`⚠️ Cannot calculate duration - missing timestamps`);
    logger.info(`  - startTime exists: ${!!session.locals.startTime}`);
    logger.info(`  - terminatedAt exists: ${!!terminatedAt}`);
  }
  
  try {
    const conversationData = {
      call_sid: session.call_sid,
      application_sid: session.application_sid || null,
      account_sid: session.account_sid || null,
      summary: {
        from: session.from || session.calling_number || session.call_sid, // Actual phone number
        to: session.to || session.called_number || session.call_sid, // Actual phone number
        duration_minutes: durationDisplay, // formatted duration string
        answered: !!answeredAt, // true only if user spoke
        direction: 'inbound',
        attempted_at: session.locals.startTime,
        answered_at: answeredAt, // This can be null if user didn't speak
        terminated_at: terminatedAt
      },
      events: session.locals.messages.map((msg, index) => ({
        type: msg.role === 'user' ? 'user_input' : 'agent_response',
        user_transcript: msg.role === 'user' ? msg.content : undefined,
        agent_response: msg.role === 'assistant' ? msg.content : undefined,
        timestamp: new Date(session.locals.startTime.getTime() + (index * 1000)) // Add 1 second for each message
      }))
    };
    logger.info({conversationData}, `session ${session.call_sid} sending conversation data to backend`);
    logger.info(`💾 SAVING TO BACKEND: ${session.call_sid} with ${session.locals.messages.length} messages`);
    // Send to backend
    const response = await axios.post('http://localhost:5000/report/entry', conversationData);
    logger.info({response: response.data}, `session ${session.call_sid} successfully saved conversation to backend`);
    logger.info(`✅ SAVED SUCCESSFULLY: ${session.call_sid} to database`);
    
    // Save the conversation ID from the response for future reference
    if (response.data && response.data.conversation_id) {
      session.locals.conversation_id = response.data.conversation_id;
      logger.info(`💾 CONVERSATION ID SAVED: ${response.data.conversation_id}`);
      
      // Generate and save conversation summary
      if (session.locals.messages.length > 0) {
        try {
          logger.info(`🤖 Generating summary for voice conversation ${session.call_sid}...`);
          
          // Convert messages to the format expected by summarizer
          const formattedMessages = session.locals.messages.map(msg => ({
            sender: msg.role === 'user' ? 'user' : 'agent',
            message: msg.content,
            timestamp: new Date()
          }));
          
          const summary = await global.summarizer.summarizeConversation(formattedMessages);
          
          if (summary) {
            // Update conversation with summary
            await global.summarizer.updateConversationSummary(response.data.conversation_id, summary);
            logger.info(`✅ Summary generated and saved for voice conversation ${session.call_sid}`);
          }
        } catch (summaryError) {
          logger.error(`❌ Error generating summary for voice conversation: ${summaryError.message}`);
        }
      }
    }
  } catch (err) {
    logger.error({err}, `session ${session.call_sid} failed to save conversation to backend`);
    logger.error(`❌ FAILED TO SAVE: ${session.call_sid} - ${err.message}`);
  }
};

const onError = (session, err) => {
  const {logger} = session.locals;
  logger.info({err}, `session ${session.call_sid} received error`);
  logger.error(`💥 CALL ERROR: ${session.call_sid} - ${err.message}`);
};

module.exports = service;
