import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const clover = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="#ffffff"><path d="M24 22.4c-1.8-3.8-1.8-8.2.6-11.2 2-2.6 5.8-2.8 7.8-.6 2 2.2 1.6 5.8-.8 7.8-2.4 2-5.2 3.2-7.6 4Z"/><path d="M25.6 24c3.8-1.8 8.2-1.8 11.2.6 2.6 2 2.8 5.8.6 7.8-2.2 2-5.8 1.6-7.8-.8-2-2.4-3.2-5.2-4-7.6Z"/><path d="M24 25.6c1.8 3.8 1.8 8.2-.6 11.2-2 2.6-5.8 2.8-7.8.6-2-2.2-1.6-5.8.8-7.8 2.4-2 5.2-3.2 7.6-4Z"/><path d="M22.4 24c-3.8 1.8-8.2 1.8-11.2-.6-2.6-2-2.8-5.8-.6-7.8 2.2-2 5.8-1.6 7.8.8 2 2.4 3.2 5.2 4 7.6Z"/><path d="M24.4 24.8c2.8 4.8 6.6 10 11.6 13.2" fill="none" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round"/></svg>`;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1f9d63" }}>
        <img src={`data:image/svg+xml;base64,${Buffer.from(clover).toString("base64")}`} width={140} height={140} alt="" />
      </div>
    ),
    size,
  );
}
