import React, { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import Peer from 'peerjs'

export default function MeetingRoom() {
    const { roomId } = useParams()
    const [myPeerId, setMyPeerId] = useState('')
    const [remotePeerId, setRemotePeerId] = useState('')
    const [aiData, setAiData] = useState(null)
    const videoRef = useRef(null)
    const remoteVideoRef = useRef(null)
    const peerInstance = useRef(null)

    useEffect(() => {
        let stream = null;

        const startVideo = async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
                if (videoRef.current) {
                    videoRef.current.srcObject = stream
                }

                const peer = new Peer()
                peerInstance.current = peer

                peer.on('open', (id) => {
                    setMyPeerId(id)
                })

                peer.on('call', (call) => {
                    call.answer(stream)
                    call.on('stream', (remoteStream) => {
                        if (remoteVideoRef.current) {
                            remoteVideoRef.current.srcObject = remoteStream
                        }
                    })
                })

            } catch (err) {
                console.error("Error accessing media devices:", err)
            }
        }

        startVideo()

        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop())
            }
            if (peerInstance.current) {
                peerInstance.current.destroy()
            }
        }
    }, [])

    useEffect(() => {
        const ws = new WebSocket('ws://localhost:8000/ws/analyze')
        let intervalId

        ws.onopen = () => {
            console.log('Connected to AI backend')
            intervalId = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send('ping')
                }
            }, 1000)
        }

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)
                setAiData(data)
            } catch (e) {
                console.error('Error parsing AI data:', e)
            }
        }

        return () => {
            clearInterval(intervalId)
            ws.close()
        }
    }, [])

    const callUser = (remoteId) => {
        const stream = videoRef.current.srcObject
        const call = peerInstance.current.call(remoteId, stream)
        call.on('stream', (remoteStream) => {
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = remoteStream
            }
        })
    }

    return (
        <div style={{ textAlign: 'center', padding: '20px' }}>
            <h1>Pokój Spotkań</h1>
            <p>Pokój ID: {roomId}</p>
            <p>Twoje ID: {myPeerId}</p>

            <div style={{ marginBottom: '20px' }}>
                <input
                    type="text"
                    placeholder="ID rozmówcy"
                    value={remotePeerId}
                    onChange={(e) => setRemotePeerId(e.target.value)}
                    style={{ padding: '10px', marginRight: '10px' }}
                />
                <button onClick={() => callUser(remotePeerId)} style={{ padding: '10px 20px' }}>
                    Zadzwoń
                </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '20px' }}>
                <div style={{ position: 'relative' }}>
                    <h3>Ty</h3>
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        style={{ width: '400px', transform: 'scaleX(-1)', border: '1px solid #ccc' }}
                    />
                    {aiData && (
                        <div style={{
                            position: 'absolute',
                            bottom: '10px',
                            left: '10px',
                            backgroundColor: 'rgba(0, 0, 0, 0.7)',
                            color: 'white',
                            padding: '10px',
                            borderRadius: '8px',
                            textAlign: 'left',
                            pointerEvents: 'none'
                        }}>
                            <div style={{ fontSize: '24px' }}>{aiData.emotion}</div>
                            <div>Wiek: {aiData.age}</div>
                            <div>Płeć: {aiData.gender}</div>
                        </div>
                    )}
                </div>
                <div>
                    <h3>Rozmówca</h3>
                    <video
                        ref={remoteVideoRef}
                        autoPlay
                        playsInline
                        style={{ width: '400px', border: '1px solid #ccc' }}
                    />
                </div>
            </div>
        </div>
    )
}
