# 🎓 Study Session Recorder & AI RAG Assistant

An AI-powered web application that records study sessions, lecture videos, or slide presentations in real-time, extracts keyframes, performs audio transcription and visual OCR, and provides a RAG-based Q&A interface powered by local **Ollama (Llama 3.2)**.

---

## 🚀 Quick Start Guide

### Prerequisites
- **Python 3.9+** & **Node.js 18+**
- **FFmpeg** installed on system (`sudo apt install ffmpeg` on Ubuntu/Linux)
- **Ollama** installed on Linux (`curl -fsSL https://ollama.com/install.sh | sh`)

---

## 🛠️ Step 1: Start Ollama (LLM Engine)

In a new terminal window:
```bash
# Start Ollama service
ollama serve

# Pull Llama 3.2 model (run once)
ollama pull llama3.2
```

---

## 🐍 Step 2: Set Up & Run Backend

1. Navigate to the backend folder:
   ```bash
   cd backend
   ```

2. Create and activate a virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

3. Install required Python packages:
   ```bash
   pip install -r requirements.txt
   ```

4. Start the FastAPI server:
   ```bash
   uvicorn main:app --reload --port 8000
   ```
   *Backend will run at `http://localhost:8000`*

---

## 💻 Step 3: Set Up & Run Frontend

1. Open a new terminal window and navigate to the frontend folder:
   ```bash
   cd frontend
   ```

2. Install Node dependencies:
   ```bash
   npm install
   ```

3. Start Vite development server:
   ```bash
   npm run dev
   ```
   *Frontend will run at `http://localhost:5173`*

---

## 📖 How to Use the App

1. **Create a Session**: Enter a title (e.g. `Lecture 1 - Machine Learning`) in the left sidebar and click **+ Create Session**.
2. **Start Recording**: Click **▶ Start Record**. Select the tab or window you want to capture (make sure to check **"Share audio"** in the browser pop-up to capture system sound, plus grant microphone access).
3. **Pause / Resume**: You can pause and resume at any time. Segments are processed asynchronously in the background.
4. **Ask Questions**:
   - Type a question in the **🤖 Ask Ollama About This Session** section and hit **Ask**.
   - If a recording is live, it automatically flushes the current segment and submits it for processing.
   - Ollama synthesizes natural answers citing exact timestamps (e.g. `(01:15 - 01:45)`).
5. **Session History**: All saved sessions and their past Q&A logs are stored under the **💬 Q&A History** tab and saved permanently in your local database.
