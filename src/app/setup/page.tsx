import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { userCount } from "@/lib/server/auth";
import { setupCodeRequired } from "@/lib/server/env";
import { SetupForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Set up – LuckyGPT" };

export default async function SetupPage() {
  // Setup only works once: after the owner account exists this page is gone.
  if ((await userCount()) > 0) redirect("/login");
  return <SetupForm codeRequired={setupCodeRequired()} />;
}
