# ReplayRAG Frontend

A React and Vite web application for recording study sessions, lecture videos, or slide presentations, and interacting with an AI assistant that answers questions about the recorded content.

## Overview

ReplayRAG Frontend is the client interface for the ReplayRAG platform. It lets users capture their screen and audio in real time, manage recording sessions, and query a local retrieval-augmented generation (RAG) assistant powered by Ollama (Llama 3.2). The assistant answers questions with references to exact timestamps in the recording.

## Features

- Screen and audio capture with start, pause, resume, and stop controls
- Session-based organization of recordings
- Chat interface to ask questions about a session's content
- Timestamp-referenced answers from the RAG assistant
- Persistent Q&A history per session

## Tech Stack

- React
- Vite
- JavaScript

## Prerequisites

- Node.js 18+
- The [ReplayRAG Backend](https://github.com/Vishnu1307-cse/ReplayRAG_Backend) running locally
- Ollama installed and running with the `llama3.2` model pulled

## Getting Started

1. Install dependencies:

   ```
   npm install
   ```

2. Start the development server:

   ```
   npm run dev
   ```

3. Open the app at `http://localhost:5173`. Ensure the backend is running at `http://localhost:8000`.

## Usage

1. Create a new session by entering a title.
2. Start recording and select the tab or window to capture, enabling audio sharing.
3. Pause or resume the recording as needed; segments are processed in the background.
4. Ask questions about the session content through the chat interface.
5. Review past sessions and their Q&A history at any time.

## Related

- [ReplayRAG Backend](https://github.com/Vishnu1307-cse/ReplayRAG_Backend) — FastAPI service handling transcription, keyframe extraction, and the RAG pipeline.

## License

Not specified.
