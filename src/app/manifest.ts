import type { MetadataRoute } from "next";

// Lets people "Add to Home Screen" on phones so LuckyGPT opens like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LuckyGPT",
    short_name: "LuckyGPT",
    description: "Your private AI assistant",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
