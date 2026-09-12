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
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '2rem', minHeight: '88vh' }}>
      
      {/* LEFT SIDEBAR - Session Manager */}
      <aside className="card-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: 'fit-content' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: 'var(--accent-gradient)',
              boxShadow: '0 0 12px var(--accent-indigo)'
            }}></div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '700', letterSpacing: '-0.02em', background: 'var(--accent-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Study Sessions
            </h2>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Manage & query recorded sessions
          </p>
        </div>

        {/* Create Session Form */}
        <form onSubmit={handleCreateSession} style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <input
            type="text"
            placeholder="New Session Title..."
            value={sessionTitleInput}
            onChange={(e) => setSessionTitleInput(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              fontSize: '0.875rem'
            }}
          />
          <button
            type="submit"
            style={{
              padding: '0.75rem',
              borderRadius: '12px',
              background: 'var(--accent-gradient)',
              color: '#fff',
              fontWeight: '600',
              fontSize: '0.875rem',
              boxShadow: '0 4px 14px var(--accent-glow)'
            }}
          >
            + Create Session
          </button>
        </form>

        {/* Saved Sessions List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', overflowY: 'auto', maxHeight: '550px', paddingRight: '0.2rem' }}>
          <h3 style={{ fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: '0.2rem' }}>
            Saved Sessions ({sessionsList.length})
          </h3>

          {loadingSessions ? (
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>Loading sessions...</p>
          ) : sessionsList.length === 0 ? (
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>No study sessions yet.</p>
          ) : (
            sessionsList.map((item) => {
              const isSelected = session && session.id === item.id
              return (
                <div
                  key={item.id}
                  onClick={() => loadSessionDetail(item.id)}
                  style={{
                    padding: '0.85rem 1rem',
                    borderRadius: '14px',
                    background: isSelected ? 'var(--glass-bg-active)' : 'var(--glass-bg)',
                    border: isSelected ? '1px solid var(--glass-border-accent)' : '1px solid var(--glass-border)',
                    boxShadow: isSelected ? '0 8px 20px -6px rgba(99, 102, 241, 0.25)' : 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                    <span style={{ fontWeight: '600', fontSize: '0.9rem', color: isSelected ? '#a5b4fc' : 'var(--text-primary)' }}>
                      {item.title}
                    </span>
                    <button
                      onClick={(e) => handleDeleteSession(item.id, e)}
                      title="Delete Session"
                      style={{
                        background: 'transparent',
                        color: 'var(--text-tertiary)',
                        fontSize: '0.85rem',
                        padding: '0.2rem 0.4rem',
                        borderRadius: '6px'
                      }}
                      onMouseEnter={(e) => e.target.style.color = 'var(--accent-rose)'}
                      onMouseLeave={(e) => e.target.style.color = 'var(--text-tertiary)'}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <span>⏱ {formatTime(item.total_duration_sec)}</span>
                    <span>💬 {item.num_questions || 0} Qs</span>
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
          <div className="card-panel" style={{ textAlign: 'center', padding: '5rem 2rem' }}>
            <div style={{
              width: '64px',
              height: '64px',
              margin: '0 auto 1.5rem auto',
              borderRadius: '20px',
              background: 'var(--accent-gradient)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2rem',
              boxShadow: '0 10px 25px var(--accent-glow)'
            }}>
              🎓
            </div>
            <h2 style={{ fontSize: '1.75rem', fontWeight: '700', letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              Study Session Explainer
            </h2>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '460px', margin: '0.75rem auto 1.5rem auto', fontSize: '0.95rem' }}>
              Select or create a study session to record screen slides, keyframes, and spoken audio for visual vector search and AI Q&A.
            </p>
          </div>
        ) : (
          <>
            {/* Header Card */}
            <div className="card-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '1.5rem', fontWeight: '700', letterSpacing: '-0.02em', color: 'var(--text-primary)', margin: 0 }}>
                  {session.title}
                </h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '0.2rem', fontFamily: 'JetBrains Mono, monospace' }}>
                  {session.id}
                </p>
              </div>

              {/* Timer Display & Record Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1.85rem', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
                    {formatTime(cumulativeSeconds)}
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
                        padding: '0.65rem 1.4rem',
                        borderRadius: '12px',
                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        color: '#fff',
                        fontWeight: '600',
                        fontSize: '0.9rem',
                        boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)'
                      }}
                    >
                      ▶ Start Recording
                    </button>
                  )}

                  {recordingState === 'recording' && (
                    <button
                      onClick={handlePauseRecording}
                      style={{
                        padding: '0.65rem 1.4rem',
                        borderRadius: '12px',
                        background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                        color: '#fff',
                        fontWeight: '600',
                        fontSize: '0.9rem',
                        boxShadow: '0 4px 14px rgba(245, 158, 11, 0.3)'
                      }}
                    >
                      ⏸ Pause
                    </button>
                  )}

                  {recordingState === 'paused' && (
                    <button
                      onClick={handleResumeRecording}
                      style={{
                        padding: '0.65rem 1.4rem',
                        borderRadius: '12px',
                        background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                        color: '#fff',
                        fontWeight: '600',
                        fontSize: '0.9rem',
                        boxShadow: '0 4px 14px rgba(99, 102, 241, 0.3)'
                      }}
                    >
                      ▶ Resume
                    </button>
                  )}

                  {(recordingState === 'recording' || recordingState === 'paused') && (
                    <button
                      onClick={handleStopRecording}
                      style={{
                        padding: '0.65rem 1.4rem',
                        borderRadius: '12px',
                        background: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)',
                        color: '#fff',
                        fontWeight: '600',
                        fontSize: '0.9rem',
                        boxShadow: '0 4px 14px rgba(244, 63, 94, 0.3)'
                      }}
                    >
                      ⏹ Stop
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--glass-bg)', padding: '0.35rem', borderRadius: '14px', border: '1px solid var(--glass-border)', width: 'fit-content' }}>
              <button
                onClick={() => setActiveTab('record')}
                style={{
                  background: activeTab === 'record' ? 'var(--glass-bg-active)' : 'transparent',
                  border: activeTab === 'record' ? '1px solid var(--glass-border-accent)' : '1px solid transparent',
                  color: activeTab === 'record' ? '#a5b4fc' : 'var(--text-secondary)',
                  fontWeight: activeTab === 'record' ? '600' : '500',
                  fontSize: '0.875rem',
                  padding: '0.5rem 1.1rem',
                  borderRadius: '10px',
                  boxShadow: activeTab === 'record' ? '0 4px 12px rgba(99, 102, 241, 0.15)' : 'none'
                }}
              >
                📹 Recording & Query
              </button>
              <button
                onClick={() => setActiveTab('history')}
                style={{
                  background: activeTab === 'history' ? 'var(--glass-bg-active)' : 'transparent',
                  border: activeTab === 'history' ? '1px solid var(--glass-border-accent)' : '1px solid transparent',
                  color: activeTab === 'history' ? '#a5b4fc' : 'var(--text-secondary)',
                  fontWeight: activeTab === 'history' ? '600' : '500',
                  fontSize: '0.875rem',
                  padding: '0.5rem 1.1rem',
                  borderRadius: '10px',
                  boxShadow: activeTab === 'history' ? '0 4px 12px rgba(99, 102, 241, 0.15)' : 'none'
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
                    <h4 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '0.85rem', color: 'var(--text-primary)' }}>
                      ⚡ Visual & Vector Pipeline Status
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                      {segments.map((seg, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '0.75rem 1rem',
                            background: 'var(--glass-bg)',
                            borderRadius: '12px',
                            border: '1px solid var(--glass-border)'
                          }}
                        >
                          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                            Segment #{seg.segment_index ?? seg.index} <span style={{ color: 'var(--text-tertiary)' }}>(Offset: {formatTime(seg.start_offset_sec ?? seg.startOffset)})</span>
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
                <div className="card-panel">
                  <h3 style={{ fontSize: '1.15rem', fontWeight: '600', marginBottom: '0.85rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ background: 'var(--accent-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                      Ask About This Session
                    </span>
                  </h3>
                  
                  <form onSubmit={handleAskQuestion} style={{ display: 'flex', gap: '0.65rem', marginBottom: '1.25rem' }}>
                    <input
                      type="text"
                      placeholder="Ask anything explained in this session..."
                      value={questionInput}
                      onChange={(e) => setQuestionInput(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '0.85rem 1.1rem',
                        fontSize: '0.925rem'
                      }}
                    />
                    <button
                      type="submit"
                      disabled={asking}
                      style={{
                        padding: '0.85rem 1.6rem',
                        borderRadius: '12px',
                        background: 'var(--accent-gradient)',
                        color: '#fff',
                        fontWeight: '600',
                        fontSize: '0.925rem',
                        opacity: asking ? 0.7 : 1,
                        boxShadow: '0 4px 14px var(--accent-glow)'
                      }}
                    >
                      {asking ? 'Thinking...' : 'Ask'}
                    </button>
                  </form>

                  {/* Latest Answer Result */}
                  {qaHistory.length > 0 && (
                    <div style={{ background: 'var(--glass-bg)', padding: '1.25rem 1.5rem', borderRadius: '14px', border: '1px solid var(--glass-border)' }}>
                      <div style={{ fontWeight: '600', color: '#a5b4fc', marginBottom: '0.6rem', fontSize: '0.925rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span>❓</span> Q: {qaHistory[0].question}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.65', fontSize: '0.925rem', color: 'var(--text-primary)' }}>
                        {qaHistory[0].answer}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* Q&A History Tab */
              <div className="card-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                  Session Question & Answer History
                </h3>
                {qaHistory.length === 0 ? (
                  <p style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>No questions asked for this session yet.</p>
                ) : (
                  qaHistory.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      style={{
                        background: 'var(--glass-bg)',
                        padding: '1.25rem 1.5rem',
                        borderRadius: '14px',
                        border: '1px solid var(--glass-border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.6rem'
                      }}
                    >
                      <div style={{ fontWeight: '600', color: '#a5b4fc', fontSize: '0.95rem' }}>
                        ❓ Question: {item.question}
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.65', fontSize: '0.925rem', color: 'var(--text-primary)' }}>
                        {item.answer}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', textAlign: 'right' }}>
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
