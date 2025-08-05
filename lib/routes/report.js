const axios = require('axios');

module.exports = (router) => {
  // POST /report/entry
  router.post('/report/entry', async (req, res) => {
    try {
      console.log('td_engine: Received report entry request:', JSON.stringify(req.body, null, 2));
      
      // Transform td_engine data to proper format for backend
      const transformedData = {
        call_sid: req.body.call_sid || req.body.sessionId,
        summary: {
          from: req.body.from || req.body.calling_number || req.body.call_sid,
          to: req.body.to || req.body.ivr_number || req.body.call_sid,
          duration: req.body.duration || 0,
          answered: req.body.answered !== false,
          direction: req.body.direction || 'inbound',
          attempted_at: req.body.attempted_at ?? null,
          answered_at: req.body.answered_at ?? null,
          terminated_at: req.body.terminated_at ?? null
        },
        events: req.body.events || [
          {
            type: "user_input",
            user_transcript: req.body.message || "Call received",
            timestamp: req.body.timestamp || new Date()
          },
          {
            type: "agent_response",
            agent_response: req.body.response?.reply || "Hello from Star Properties",
            timestamp: new Date()
          }
        ]
      };
      
      console.log('td_engine: Transformed data for backend:', JSON.stringify(transformedData, null, 2));
      
      // Call the backend API to save to ConversationLog table
      const response = await axios.post('http://localhost:5000/api/conversations/save', transformedData, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      
      console.log('td_engine: Successfully saved to reports table:', response.data);
      res.json(response.data);
    } catch (err) {
      console.error('td_engine: Failed to save to reports table:', err.message);
      console.error('td_engine: Error details:', err.response?.data || err.stack);
      console.error('td_engine: Request data that failed:', JSON.stringify(req.body, null, 2));
      res.status(500).json({ error: 'Failed to make report entry', details: err.message });
    }
  });
}; 