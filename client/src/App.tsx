import { Switch, Route } from "wouter";
import { Toaster } from "sonner";
import { useAuth } from "./hooks/useAuth";
import MapPage from "./pages/MapPage";
import MarketPage from "./pages/MarketPage";
import MarketDetailPage from "./pages/MarketDetailPage";
import PortfolioPage from "./pages/PortfolioPage";
import LoginPage from "./pages/LoginPage";
import AdminPage from "./pages/AdminPage";
import ArenaPage from "./pages/ArenaPage";

export default function App() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--paper)]">
        <p
          className="text-[var(--ink)] text-sm animate-pulse"
          style={{ letterSpacing: "0.3em", fontFamily: "var(--serif)" }}
        >
          UNROLLING THE SHEET…
        </p>
      </div>
    );
  }

  return (
    <>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/admin" component={user ? AdminPage : LoginPage} />
        <Route path="/map" component={MapPage} />
        <Route path="/arena" component={ArenaPage} />
        <Route path="/market/:id" component={MarketDetailPage} />
        <Route path="/portfolio" component={PortfolioPage} />
        <Route component={MarketPage} />
      </Switch>
      <Toaster
        theme="light"
        toastOptions={{
          style: {
            background: "var(--paper)",
            border: "1.5px solid var(--ink-strong)",
            borderRadius: 0,
            boxShadow: "inset 0 0 0 3px var(--paper), inset 0 0 0 4px var(--ink-soft)",
            color: "var(--ink)",
            fontFamily: "var(--serif)",
            fontSize: "13px",
          },
        }}
      />
    </>
  );
}
