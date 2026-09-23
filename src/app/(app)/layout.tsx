import { redirect } from "next/navigation";
import { getPageUser, loadUserInfo, userCount } from "@/lib/server/auth";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageUser();
  if (!session) {
    redirect((await userCount()) === 0 ? "/setup" : "/login");
  }
  const user = await loadUserInfo(session.id);
  if (!user) redirect("/login");
  return (
    <>
      <AppShell initialUser={user} />
      {children}
    </>
  );
}
