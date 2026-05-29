"use client";

export function Skeleton({ width = "100%", height = 20 }: { width?: string; height?: number }) {
  return (
    <div
      style={{
        width,
        height,
        background: "linear-gradient(90deg, #1c2b3a 25%, #243447 50%, #1c2b3a 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.5s infinite",
        borderRadius: 6,
      }}
    />
  );
}
