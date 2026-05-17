// No layout chrome — each page renders its own profile header + tabs so they
// can pass per-page active state. Keeping this file empty preserves the route
// segment; we can later promote SummonerHeader into a shared sticky element.

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
