import { Suspense } from "react";
import LoginPage from "./page-client";

export default function LoginRoute() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center text-[var(--ink-muted)]">
          Loading…
        </main>
      }
    >
      <LoginPage />
    </Suspense>
  );
}
