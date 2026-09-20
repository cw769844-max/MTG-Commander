import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@mtg-commander/shared";

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type SignalData =
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit };

/**
 * Mesh WebRTC for up to 4 seats (<=6 peer connections total) — fine without
 * an SFU at this scale. Convention: the lower seat number always initiates
 * the offer to the higher seat number, so both sides agree on who leads
 * without extra negotiation messages.
 */
export function useWebRTCMesh(socket: GameSocket, mySeat: number | null, connectedSeats: number[], enabled: boolean) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<number, MediaStream>>({});
  const peers = useRef(new Map<number, RTCPeerConnection>());
  // Mirrors localStream: the cleanup closure below would otherwise capture the
  // null from the first render and leave the camera light on after leaving.
  const localStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
      })
      .catch((err) => console.warn("Camera/mic unavailable:", err));

    return () => {
      cancelled = true;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    };
  }, [enabled]);

  function ensurePeer(seat: number): RTCPeerConnection {
    let pc = peers.current.get(seat);
    if (pc) return pc;

    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peers.current.set(seat, pc);

    if (localStream) {
      for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("rtc:signal", { toSeat: seat, data: { type: "ice", candidate: event.candidate.toJSON() } as SignalData });
      }
    };

    pc.ontrack = (event) => {
      setRemoteStreams((prev) => ({ ...prev, [seat]: event.streams[0] }));
    };

    return pc;
  }

  async function initiate(seat: number) {
    const pc = ensurePeer(seat);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("rtc:signal", { toSeat: seat, data: { type: "offer", sdp: offer } as SignalData });
  }

  useEffect(() => {
    if (!enabled || mySeat === null || !localStream) return;
    for (const seat of connectedSeats) {
      if (seat === mySeat) continue;
      if (mySeat < seat && !peers.current.has(seat)) {
        initiate(seat);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mySeat, localStream, connectedSeats.join(",")]);

  useEffect(() => {
    if (!enabled) return;

    async function onSignal({ fromSeat, data }: { fromSeat: number; data: unknown }) {
      const signal = data as SignalData;
      const pc = ensurePeer(fromSeat);

      if (signal.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("rtc:signal", { toSeat: fromSeat, data: { type: "answer", sdp: answer } as SignalData });
      } else if (signal.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      } else if (signal.type === "ice") {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (err) {
          console.warn("Failed to add ICE candidate", err);
        }
      }
    }

    socket.on("rtc:signal", onSignal);
    return () => {
      socket.off("rtc:signal", onSignal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, localStream]);

  // Tear down connections to seats that have left, so their tile disappears
  // and the connection isn't left half-open.
  useEffect(() => {
    for (const [seat, pc] of peers.current) {
      if (connectedSeats.includes(seat)) continue;
      pc.close();
      peers.current.delete(seat);
      setRemoteStreams((prev) => {
        if (!(seat in prev)) return prev;
        const next = { ...prev };
        delete next[seat];
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedSeats.join(",")]);

  useEffect(() => {
    const openPeers = peers.current;
    return () => {
      for (const pc of openPeers.values()) pc.close();
      openPeers.clear();
    };
  }, []);

  return { localStream, remoteStreams };
}
