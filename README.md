# td_engine

This application was created with the [create-jambonz-ws-app](https://www.npmjs.com/package/create-jambonz-ws-app) command.  This documentation was generated at the time when the project was generated and describes the functionality that was initially scaffolded.  Of course, you should feel free to modify or replace this documentation as you build out your own logic.

## Services

Based on the options that you have chosen, this application exposes the following services over a websocket interface:

### /hello-world
A simple "hello, world" application using text to speech.

### /echo
A application that prompts the caller for speech, transcribes it and speaks it back along with the recognized confidence factor.

### /openai-s2s
An example application that connects to the [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime) and implements a Voice-AI conversation.  The example shows how to configure the session parameters and gives an example of how to provide function calls, or tools, to the OpenAI assistant.  This example requires an OpenAI API key with permissions for the Real-time API, the key must be provided via the `OPENAI_API_KEY` environment variable.

### /deepgram-s2s
An example application that connects to the [Deepgram Voice Agent](https://deepgram.com/product/voice-agent-api) service.  The example shows how to configure the session parameters and gives an example of how to provide function calls, or tools, to the Voice Agent.  This example requires a Deepgram API key which key must be provided via the `DEEPGRAM_API_KEY` environment variable.

### /llm-streaming
An example application that shows how to stream text from an n8n webhook through jambonz to a TTS engine that supports streaming.  As of release 0.9.2 the TTS engines that are supported for this feature are Deepgram, ElevenLabs, and Cartesia - please check back as we are adding new TTS engines every month.  This application uses an n8n webhook for processing messages. The webhook URL can be configured via the `N8N_WEBHOOK_URL` environment variable (defaults to `https://bots.torisedigital.com/webhook/af242424-edf9-43b6-91ef-37017daeb4d7`).

