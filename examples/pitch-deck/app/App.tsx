import { useState, useCallback } from 'react'
import { DriftProvider } from 'drift/react'
import { DeckBuilder } from './components/DeckBuilder'
import { Chat } from './components/Chat'

const wsHost = (import.meta.env.VITE_DRIFT_WS_PORT)
    ? `localhost:${import.meta.env.VITE_DRIFT_WS_PORT}`
    : window.location.host
const WS_URL = `ws://${wsHost}`

function newId() { return crypto.randomUUID() }

export default function App() {
    const [sessionId, setSessionId] = useState<string>(newId)

    const handleNewSession = useCallback(() => {
        setSessionId(newId())
    }, [])

    return (
        <DriftProvider url={WS_URL}>
            <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0a0a0f', color: '#e0e0e8' }}>
                <Chat sessionId={sessionId} onNewSession={handleNewSession} />
                <DeckBuilder />
            </div>
        </DriftProvider>
    )
}
