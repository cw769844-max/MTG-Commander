import { useEffect, useRef } from "react";

interface Props {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
}

export default function VideoTile({ stream, label, muted }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div style={{ width: "160px" }}>
      <video ref={videoRef} autoPlay playsInline muted={muted} style={{ width: "100%", background: "#000", borderRadius: "6px" }} />
      <div style={{ fontSize: "0.8rem", textAlign: "center" }}>{label}</div>
    </div>
  );
}
