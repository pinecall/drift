import { useState, useCallback } from 'react'
import { DriftProvider } from 'drift/react'
import { Board } from './components/Board'
import { Chat } from './components/Chat'
import { Sidebar } from './components/Sidebar'

// In dev mode (drift dev), connect directly to the drift WS port
// In production, connect to the same host that serves the page
const wsHost = (import.meta.env.VITE_DRIFT_WS_PORT)
    ? `localhost:${import.meta.env.VITE_DRIFT_WS_PORT}`
    : window.location.host
const WS_URL = `ws://${wsHost}`

function _newId() {
    return crypto.randomUUID()
}

export default function App() {
    // Always start with a session ready
    const [activeSessionId, setActiveSessionId] = useState<string>(_newId)

    const handleNewChat = useCallback(() => {
        setActiveSessionId(_newId())
    }, [])

    const handleSelectSession = useCallback((sessionId: string) => {
        setActiveSessionId(sessionId)
    }, [])

    return (
        <DriftProvider url={WS_URL}>
            <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
                <Sidebar
                    activeSessionId={activeSessionId}
                    onSelectSession={handleSelectSession}
                    onNewChat={handleNewChat}
                />
                <Chat sessionId={activeSessionId} />
                <Board />
            </div>
        </DriftProvider>
    )
}
