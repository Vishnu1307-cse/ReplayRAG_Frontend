import React, { useState, useEffect, useRef } from 'react'

const BACKEND_URL = 'http://localhost:8000'

export default function StudySessionRecorder() {
  // Saved Sessions List
  const [sessionsList, setSessionsList] = useState([])
  const [loadingSessions, setLoadingSessions] = useState(false)

  // Current Active Session State
  const [session, setSession] = useState(null) // { id, title, qa_records, segments }
  const [sessionTitleInput, setSessionTitleInput] = useState('')

  // Recording State
  const [recordingState, setRecordingState] = useState('idle') // 'idle' | 'recording' | 'paused'
  const [cumulativeSeconds, setCumulativeSeconds] = useState(0)

  // Segment Tracking
  const [segments, setSegments] = useState([])
  const segmentIndexRef = useRef(0)
  const currentSegmentStartOffsetRef = useRef(0)

  // Q&A Query State
  const [questionInput, setQuestionInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [qaHistory, setQaHistory] = useState([]) // persistent list of QA items
  const [activeTab, setActiveTab] = useState('record') // 'record' | 'history'

  // Web API Refs
  const mediaStreamRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerIntervalRef = useRef(null)

  // Fetch Saved Sessions on Mount
  useEffect(() => {
    fetchSessionsList()
  }, [])

  const fetchSessionsList = async () => {
    setLoadingSessions(true)
    try {
      const res = await fetch(`${BACKEND_URL}/sessions`)
      if (res.ok) {
        const data = await res.json()
        setSessionsList(data)
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err)
    } finally {
      setLoadingSessions(false)
    }
  }

  // Fetch full detail of selected session
  const loadSessionDetail = async (sessionId) => {
    try {
      const res = await fetch(`${BACKEND_URL}/sessions/${sessionId}`)
      if (res.ok) {
        const data = await res.json()
        setSession(data)
        setCumulativeSeconds(Math.floor(data.total_duration_sec || 0))
        setSegments(data.segments || [])
        setQaHistory(data.qa_records || [])
        segmentIndexRef.current = data.segments ? data.segments.length : 0
      }
    } catch (err) {
      console.error('Failed to load session detail:', err)
    }
  }

  // Cumulative timer effect
  useEffect(() => {
    if (recordingState === 'recording') {
      timerIntervalRef.current = setInterval(() => {
        setCumulativeSeconds((prev) => prev + 1)
      }, 1000)
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
        timerIntervalRef.current = null
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }
    }
  }, [recordingState])

  // Polling for segment status
  useEffect(() => {
    if (!session) return

    const pollInterval = setInterval(async () => {
      const pendingSegments = segments.filter(
        (seg) => seg.status !== 'ready' && seg.status !== 'failed' && seg.status !== 'error' && seg.status !== 'recording'
      )
      if (pendingSegments.length === 0) return

      for (const seg of pendingSegments) {
        try {
          const res = await fetch(
            `${BACKEND_URL}/sessions/${session.id}/segments/${seg.segment_index ?? seg.index}/status`
          )
          if (res.ok) {
            const data = await res.json()
            if (data.status && data.status !== seg.status) {
              updateSegmentStatus(seg.segment_index ?? seg.index, data.status)
            }
          }
        } catch (err) {
          console.error(`Failed to poll status for segment`, err)
        }
      }
    }, 3000)

    return () => clearInterval(pollInterval)
  }, [session, segments])

  const updateSegmentStatus = (index, status) => {
    setSegments((prev) =>
      prev.map((s) => ((s.segment_index ?? s.index) === index ? { ...s, status } : s))
    )
  }

  // Format seconds into MM:SS or HH:MM:SS
  const formatTime = (totalSecs) => {
    const hrs = Math.floor(totalSecs / 3600)
    const mins = Math.floor((totalSecs % 3600) / 60)
    const secs = Math.floor(totalSecs % 60)
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins
        .toString()
        .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`
  }

  // Create a New Session
  const handleCreateSession = async (e) => {
    e.preventDefault()
    if (!sessionTitleInput.trim()) return

    try {
      const res = await fetch(`${BACKEND_URL}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: sessionTitleInput.trim() }),
      })

      if (!res.ok) throw new Error('Failed to create session')
      const data = await res.json()

      // Reset state for new session
      setSession({ ...data, qa_records: [], segments: [] })
      setRecordingState('idle')
      setCumulativeSeconds(0)
      setSegments([])
      setQaHistory([])
      setQuestionInput('')
      segmentIndexRef.current = 0
      currentSegmentStartOffsetRef.current = 0
      setSessionTitleInput('')

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop())
        mediaStreamRef.current = null
      }

      fetchSessionsList()
    } catch (err) {
      alert(`Error creating session: ${err.message}`)
    }
  }

  // Delete Session
  const handleDeleteSession = async (sessionId, e) => {
    e.stopPropagation()
    if (!window.confirm('Are you sure you want to delete this study session?')) return

    try {
      const res = await fetch(`${BACKEND_URL}/sessions/${sessionId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        if (session && session.id === sessionId) {
          setSession(null)
          setSegments([])
          setQaHistory([])
        }
        fetchSessionsList()
      }
    } catch (err) {
      alert('Failed to delete session')
    }
  }

  // Upload Segment to Backend
  const uploadSegmentBlob = async (blob, segIndex, startOffset) => {
    if (!session) return

    updateSegmentStatus(segIndex, 'uploading')

    const formData = new FormData()
    formData.append('file', blob, `segment_${segIndex}.webm`)
    formData.append('segment_index', segIndex)
    formData.append('segment_start_offset', startOffset)

    try {
      const res = await fetch(
        `${BACKEND_URL}/sessions/${session.id}/segments`,
        {
          method: 'POST',
          body: formData,
        }
      )

      if (!res.ok) {
        throw new Error(`Upload failed with status ${res.status}`)
      }

      updateSegmentStatus(segIndex, 'queued')
      fetchSessionsList()
    } catch (err) {
      console.error(`Failed to upload segment ${segIndex}:`, err)
      updateSegmentStatus(segIndex, 'error')
    }
  }

  // Setup MediaRecorder
  const setupMediaRecorder = (stream) => {
    const recorder = new MediaRecorder(stream)
    chunksRef.current = []

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data)
      }
    }

    stream.getVideoTracks()[0].onended = () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        handleStopRecording()
      }
    }

    mediaRecorderRef.current = recorder
  }

  // Start Recording
  const handleStartRecording = async () => {
    if (!session) {
      alert('Please create or select a session first.')
      return
    }

    try {
      // 1. Get Screen Stream (video + optional system/tab audio)
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })

      // 2. Try to capture microphone audio (so your voice is also recorded)
      let micStream = null
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (micErr) {
        console.warn('Microphone access not granted or not available:', micErr)
      }

      // 3. Combine tracks into a unified MediaStream
      const combinedTracks = [...displayStream.getTracks()]
      if (micStream) {
        micStream.getAudioTracks().forEach((track) => combinedTracks.push(track))
      }

      const combinedStream = new MediaStream(combinedTracks)
      mediaStreamRef.current = combinedStream

      setupMediaRecorder(combinedStream)

      currentSegmentStartOffsetRef.current = cumulativeSeconds
      const newSegIndex = segmentIndexRef.current

      setSegments((prev) => [
        ...prev,
        {
          segment_index: newSegIndex,
          start_offset_sec: currentSegmentStartOffsetRef.current,
          status: 'recording',
        },
      ])

      mediaRecorderRef.current.start(1000)
      setRecordingState('recording')
    } catch (err) {
      console.error('Error starting screen capture:', err)
      alert('Could not start screen capture: ' + err.message)
    }
  }

  // Pause Recording
  const handlePauseRecording = () => {
    if (!mediaRecorderRef.current || recordingState !== 'recording') return

    const activeSegIndex = segmentIndexRef.current
    const activeStartOffset = currentSegmentStartOffsetRef.current

    mediaRecorderRef.current.requestData()
    const blob = new Blob(chunksRef.current, { type: 'video/webm' })
    chunksRef.current = []

    uploadSegmentBlob(blob, activeSegIndex, activeStartOffset)

    mediaRecorderRef.current.pause()
    setRecordingState('paused')

    segmentIndexRef.current += 1
  }

  // Resume Recording
  const handleResumeRecording = () => {
    if (!mediaRecorderRef.current || recordingState !== 'paused') return

    currentSegmentStartOffsetRef.current = cumulativeSeconds
    const newSegIndex = segmentIndexRef.current

    setSegments((prev) => [
      ...prev,
      {
        segment_index: newSegIndex,
        start_offset_sec: currentSegmentStartOffsetRef.current,
        status: 'recording',
      },
    ])

    chunksRef.current = []
    mediaRecorderRef.current.resume()
    setRecordingState('recording')
  }

  // Stop Recording
  const handleStopRecording = () => {
    if (!mediaRecorderRef.current) return

    const activeSegIndex = segmentIndexRef.current
    const activeStartOffset = currentSegmentStartOffsetRef.current

    if (recordingState === 'recording') {
      mediaRecorderRef.current.requestData()
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      chunksRef.current = []
      uploadSegmentBlob(blob, activeSegIndex, activeStartOffset)
    }

    if (mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }

    setRecordingState('idle')
    segmentIndexRef.current += 1
  }

  // Ask Question against Session Knowledge Base
  const handleAskQuestion = async (e) => {
    e.preventDefault()
    if (!session || !questionInput.trim()) return

    if (recordingState === 'recording') {
      handlePauseRecording()
    }

    setAsking(true)
    const currentQ = questionInput.trim()
    setQuestionInput('')

    try {
      const res = await fetch(`${BACKEND_URL}/sessions/${session.id}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: currentQ, top_k: 5 }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.detail || 'Failed to query session')
      }

      const data = await res.json()
      
      // Update persistent Q&A list
      setQaHistory((prev) => [
        {
          id: Date.now().toString(),
          question: currentQ,
          answer: data.answer,
          cited_chunks: data.cited_chunks,
          created_at: new Date().toISOString()
        },
        ...prev
      ])

      fetchSessionsList()
    } catch (err) {
      alert(`Error querying session: ${err.message}`)
    } finally {
      setAsking(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.5rem', minHeight: '85vh' }}>
      
      {/* LEFT SIDEBAR: SAVED SESSIONS */}
      <aside className="card-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '0.25rem', color: '#f3f4f6' }}>
            📚 Study Sessions
          </h3>
          <p style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Select a saved session or start a new one</p>
        </div>

        {/* Create Session Form */}
        <form onSubmit={handleCreateSession} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <input
            type="text"
            placeholder="New Session Title..."
            value={sessionTitleInput}
            onChange={(e) => setSessionTitleInput(e.target.value)}
            style={{
              padding: '0.6rem 0.8rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-input)',
              color: '#fff',
              fontSize: '0.875rem'
            }}
          />
          <button
            type="submit"
            style={{
              padding: '0.6rem',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--primary)',
              color: '#fff',
              fontWeight: '600',
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}
          >
            + Create Session
          </button>
        </form>

        <hr style={{ borderColor: 'var(--border-color)', margin: '0.5rem 0' }} />

        {/* Sessions List */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {loadingSessions ? (
            <p style={{ fontSize: '0.85rem', color: '#6b7280', textAlign: 'center' }}>Loading sessions...</p>
          ) : sessionsList.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: '#6b7280', textAlign: 'center', marginTop: '1rem' }}>
              No study sessions saved yet.
            </p>
          ) : (
            sessionsList.map((item) => {
              const isSelected = session && session.id === item.id
              return (
                <div
                  key={item.id}
                  onClick={() => loadSessionDetail(item.id)}
                  style={{
                    padding: '0.8rem',
                    borderRadius: '8px',
                    background: isSelected ? 'var(--primary-light)' : 'var(--bg-input)',
                    border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.3rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: '600', fontSize: '0.9rem', color: isSelected ? '#c084fc' : '#f3f4f6' }}>
                      {item.title}
                    </span>
                    <button
                      onClick={(e) => handleDeleteSession(item.id, e)}
                      title="Delete Session"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        opacity: 0.7
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#9ca3af' }}>
                    <span>⏱ {formatTime(item.total_duration_sec)}</span>
                    <span>❓ {item.num_questions || 0} Qs</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </aside>

      {/* RIGHT MAIN VIEW */}
      <main style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        
        {!session ? (
          <div className="card-panel" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎓</div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#f3f4f6' }}>Welcome to Study Session Recorder</h2>
            <p style={{ color: '#9ca3af', maxWidth: '450px', margin: '0.5rem auto 1.5rem auto' }}>
              Create a new study session from the left sidebar to start recording screen, slides, and audio with automatic RAG Q&A synthesis.
            </p>
          </div>
        ) : (
          <>
            {/* Header Card */}
            <div className="card-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '1.4rem', fontWeight: '700', color: '#f3f4f6', margin: 0 }}>
                  {session.title}
                </h2>
                <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.2rem' }}>
                  ID: {session.id}
                </p>
              </div>

              {/* Timer Display & Record Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1.8rem', fontWeight: '700', color: '#f3f4f6' }}>
                    ⏱ {formatTime(cumulativeSeconds)}
                  </div>
                  <span className={`status-pill ${recordingState}`}>
                    {recordingState}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {recordingState === 'idle' && (
                    <button
                      onClick={handleStartRecording}
                      style={{
                        padding: '0.6rem 1.2rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: '#10b981',
                        color: '#fff',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      ▶ Start Record
                    </button>
                  )}

                  {recordingState === 'recording' && (
                    <button
                      onClick={handlePauseRecording}
                      style={{
                        padding: '0.6rem 1.2rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: '#f59e0b',
                        color: '#000',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      ⏸ Pause
                    </button>
                  )}

                  {recordingState === 'paused' && (
                    <button
                      onClick={handleResumeRecording}
                      style={{
                        padding: '0.6rem 1.2rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: '#3b82f6',
                        color: '#fff',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      ▶ Resume
                    </button>
                  )}

                  {(recordingState === 'recording' || recordingState === 'paused') && (
                    <button
                      onClick={handleStopRecording}
                      style={{
                        padding: '0.6rem 1.2rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: '#ef4444',
                        color: '#fff',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      ⏹ Stop
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              <button
                onClick={() => setActiveTab('record')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: activeTab === 'record' ? '#c084fc' : '#9ca3af',
                  fontWeight: activeTab === 'record' ? '700' : '500',
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  borderBottom: activeTab === 'record' ? '2px solid #c084fc' : 'none',
                  paddingBottom: '0.5rem'
                }}
              >
                📹 Recording & Ask
              </button>
              <button
                onClick={() => setActiveTab('history')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: activeTab === 'history' ? '#c084fc' : '#9ca3af',
                  fontWeight: activeTab === 'history' ? '700' : '500',
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  borderBottom: activeTab === 'history' ? '2px solid #c084fc' : 'none',
                  paddingBottom: '0.5rem'
                }}
              >
                💬 Q&A History ({qaHistory.length})
              </button>
            </div>

            {activeTab === 'record' ? (
              <>
                {/* Segments Processing Status */}
                {segments.length > 0 && (
                  <div className="card-panel">
                    <h4 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '0.75rem', color: '#f3f4f6' }}>
                      ⚡ Segment Processing Pipeline
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {segments.map((seg, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '0.6rem 0.8rem',
                            background: 'var(--bg-input)',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)'
                          }}
                        >
                          <span style={{ fontSize: '0.85rem', color: '#d1d5db' }}>
                            Segment #{seg.segment_index ?? seg.index} (Start offset: {formatTime(seg.start_offset_sec ?? seg.startOffset)})
                          </span>
                          <span className={`status-pill ${seg.status}`}>
                            {seg.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ask Question Section */}
                <div className="card-panel" style={{ border: '1px solid rgba(124, 58, 237, 0.4)' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '0.75rem', color: '#c084fc' }}>
                    🤖 Ask Ollama About This Session
                  </h3>
                  
                  <form onSubmit={handleAskQuestion} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
                    <input
                      type="text"
                      placeholder="Ask anything explained in this session..."
                      value={questionInput}
                      onChange={(e) => setQuestionInput(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '0.75rem 1rem',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-input)',
                        color: '#fff',
                        fontSize: '0.95rem'
                      }}
                    />
                    <button
                      type="submit"
                      disabled={asking}
                      style={{
                        padding: '0.75rem 1.5rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: 'var(--primary)',
                        color: '#fff',
                        fontWeight: '600',
                        cursor: asking ? 'not-allowed' : 'pointer',
                        opacity: asking ? 0.7 : 1
                      }}
                    >
                      {asking ? 'Thinking...' : 'Ask'}
                    </button>
                  </form>

                  {/* Latest Answer Result */}
                  {qaHistory.length > 0 && (
                    <div style={{ background: 'var(--bg-input)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontWeight: '600', color: '#c084fc', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                        Q: {qaHistory[0].question}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', fontSize: '0.95rem', color: '#e5e7eb' }}>
                        {qaHistory[0].answer}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* Q&A History Tab */
              <div className="card-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#f3f4f6' }}>
                  📜 Session Question & Answer Log
                </h3>
                {qaHistory.length === 0 ? (
                  <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>No questions asked for this session yet.</p>
                ) : (
                  qaHistory.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      style={{
                        background: 'var(--bg-input)',
                        padding: '1rem 1.25rem',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem'
                      }}
                    >
                      <div style={{ fontWeight: '700', color: '#c084fc', fontSize: '0.95rem' }}>
                        ❓ Question: {item.question}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', fontSize: '0.9rem', color: '#d1d5db' }}>
                        {item.answer}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280', textAlign: 'right' }}>
                        {new Date(item.created_at).toLocaleTimeString()}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
