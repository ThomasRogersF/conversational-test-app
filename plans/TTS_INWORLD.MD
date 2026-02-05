> ## Documentation Index
> Fetch the complete documentation index at: https://docs.inworld.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Introduction

## Authentication

All requests to Inworld's APIs must include an API key in an Authorization HTTP header. All APIs support both Basic and JWT authentication.

## Getting an API key

To get an API key, follow these steps:

1. Log in to [Inworld Portal](https://platform.inworld.ai/).
2. Click **API Keys** on the bottom left sidebar.
3. Click **Generate new key** to generate a new API key.
4. Copy the **Basic (Base64)** authorization signature.

<img src="https://mintcdn.com/inworldai/D5ioimJX2DN0bt5n/img/portal/new-get-api-key.gif?s=c06db12321a7741bc7ab969f8f1d640e" alt="Get API Key" data-og-width="1280" width="1280" data-og-height="916" height="916" data-path="img/portal/new-get-api-key.gif" data-optimize="true" data-opv="3" />

You can also specify for each API key whether it has permissions to write to the [Voice API](/api-reference/voiceAPI/voiceservice/clone-voice), which enables the API key to be used for cloning voices via the Voice API. These permissions do not impact other APIs (such as Text-to-Speech and LLM).

## Basic authentication

<Warning>Do not expose your Base64 API credentials in client-side code (browsers, apps, game builds), as it may be compromised. Please consider JWT authentication for client-side builds.</Warning>

Basic authentication uses the Base64 encoded credentials to authenticate the request. Below is an example of the header for Basic authentication:

```
Authorization: Basic $INWORLD_BASE64_CREDENTIALS
```

Make sure to keep your Base64 credentials safe, as anyone with your credentials can make requests on your behalf. It is recommended that credentials are stored as environment variables and read at run time.

## JWT authentication

JWT (JSON Web Token) authentication allows you to issue a signed token from your server that clients can use to securely authenticate with Inworld APIs. This method is strongly recommended when calling APIs from client-side code, to avoid exposing your credentials.

How it works:

1. Your backend securely stores the Inworld API Key and Secret.
2. When the client needs to authenticate, it requests a token from your backend.
3. Your backend uses the API key and secret to generate a signed JWT and returns it to the client.
4. The client uses this JWT with each API request to Inworld:

```
Authorization: Bearer $JWT
```

We recommend taking a look at this [sample Node.js application](https://github.com/inworld-ai/inworld-nodejs-jwt-sample-app) for an example of how to generate JWT tokens for authentication with the Inworld API.

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.inworld.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Intro to TTS

> Convert text into realistic, expressive speech

Inworld's text-to-speech (TTS) models offer ultra-realistic, context-aware speech synthesis and precise voice cloning capabilities, enabling developers to build natural and engaging experiences with human-like speech quality at an accessible price point.

Our models can be accessed via [API](/api-reference/ttsAPI/texttospeech/synthesize-speech) or the [TTS Playground](http://platform.inworld.ai/tts-playground).

<CardGroup cols={3}>
  <Card title="Developer quickstart" icon="bolt" href="/docs/quickstart-tts">
    Learn how to make your first API call in minutes with a guided tutorial.
  </Card>

  <Card title="TTS Playground" icon="play" href="/docs/tts/tts-playground">
    Try different TTS models and voice cloning in TTS Playground.
  </Card>

  <Card title="Code Examples" icon="play" href="https://github.com/inworld-ai/inworld-api-examples">
    Browse ready-to-use GitHub samples for common use cases.
  </Card>
</CardGroup>

## Models

<CardGroup cols={2}>
  <Card title="Inworld TTS 1.5 Max" icon="sparkles">
    ### Our flagship model, delivering the best balance of quality and speed

    * Rich, expressive, contextually aware speech
    * Support for 15 languages
    * Optimized for real-time use (\<200ms median latency)
    * High quality instant voice cloning
  </Card>

  <Card title="Inworld TTS 1.5 Mini" subtitle="Our flagship model" icon="bolt">
    ### Our ultra-fast, most cost-efficient model. For when latency is the top priority.

    * Ultra-low latency (\~120ms median latency)
    * Support for 15 languages
    * Radically affordable pricing
    * High quality instant voice cloning
  </Card>
</CardGroup>

## Features

| **Feature**                                                                                              | **TTS-1.5-Max**                   | **TTS-1.5-Mini**                |
| :------------------------------------------------------------------------------------------------------- | :-------------------------------- | :------------------------------ |
| Radically accessible pricing                                                                             | \$10/1M characters                | \$5/1M characters               |
| Quality                                                                                                  | #1 ranked, maximum stability      | #1 ranked                       |
| P50 Latency                                                                                              | 200 ms                            | 120 ms                          |
| [Free instant voice cloning](/docs/tts/voice-cloning)                                                    | <Icon icon="check" size={18} />   | <Icon icon="check" size={18} /> |
| Professional voice cloning                                                                               | <Icon icon="check" size={18} />   | <Icon icon="check" size={18} /> |
| [Custom pronunciation](/docs/tts/capabilities/custom-pronunciation)                                      | <Icon icon="check" size={18} />   | <Icon icon="check" size={18} /> |
| Multilingual                                                                                             | 15 languages                      | 15 languages                    |
| [Audio markups](/docs/tts/capabilities/audio-markups) for emotion, style and non-verbals                 | <Icon icon="check" size={18} />   | <Icon icon="check" size={18} /> |
| [Timestamp alignment](/docs/tts/capabilities/timestamps)                                                 | <Icon icon="check" size={18} />   | <Icon icon="check" size={18} /> |
| On-premise deployments                                                                                   | <Icon icon="check" size={18} />   | <Icon icon="check" size={18} /> |
