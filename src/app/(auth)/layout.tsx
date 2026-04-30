// (auth) layout — no sidebar, no auth guard (login / register pages)
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

