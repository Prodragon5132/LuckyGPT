import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getShare } from "@/lib/server/repo/misc";
import { SharedChat } from "@/components/SharedChat";

export const metadata: Metadata = { title: "Shared chat – LuckyGPT", robots: { index: false, follow: false } };

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await getShare(token);
  if (!share) notFound();
  return (
    <SharedChat
      shareId={token}
      title={share.title}
      date={new Date(share.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
      messages={share.messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        modelName: m.modelName ?? null,
        sources: m.sources,
        images: m.images,
        attachments: m.attachments,
      }))}
    />
  );
}
