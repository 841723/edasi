import { ReactNode } from "react";
import { Header } from "./header";
import { Footer } from "./footer";
import { JobsStatus } from "./jobs-status";
import { RealtimeBridge } from "@/hooks/use-realtime";
import { useLocation } from "react-router-dom";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  const location = useLocation();
  const isTrainer = /\/trainer$/.test(location.pathname);
  return (
    <div className="flex h-screen min-h-screen flex-col overflow-x-hidden overflow-y-hidden bg-dark-50">
      <RealtimeBridge />
      <Header />
      <JobsStatus />
      <main className={`flex min-h-0 flex-1 flex-col overflow-x-hidden p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-6 md:pb-6 lg:p-8 ${isTrainer ? "overflow-y-hidden" : "overflow-y-auto"}`}>
        {children}
        {!isTrainer && <Footer />}
      </main>
    </div>
  );
}
