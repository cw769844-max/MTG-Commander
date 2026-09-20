import { useState, type ReactNode } from "react";

interface Props {
  onDropInstance: (instanceId: string) => void;
  children: ReactNode;
}

/** Wraps a zone's contents so cards dragged from elsewhere on the board can be dropped into it. */
export default function ZoneDropArea({ onDropInstance, children }: Props) {
  const [isOver, setIsOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={() => setIsOver(true)}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        const instanceId = e.dataTransfer.getData("text/plain");
        if (instanceId) onDropInstance(instanceId);
      }}
      style={{
        border: `1px dashed ${isOver ? "#8ab4f8" : "transparent"}`,
        borderRadius: "6px",
        padding: "0.25rem",
        transition: "border-color 0.1s",
      }}
    >
      {children}
    </div>
  );
}
