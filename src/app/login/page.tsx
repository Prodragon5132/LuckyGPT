import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getPageUser, userCount } from "@/lib/server/auth";
import { LoginForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Log in – LuckyGPT" };

export default async function LoginPage() {
  if (await getPageUser()) redirect("/");
  if ((await userCount()) === 0) redirect("/setup");
  return <LoginForm />;
}
