import { Switch, Route } from "wouter";
import { Toaster } from "sonner";
import { useAuth } from "./hooks/useAuth";
import MapPage from "./pages/MapPage";
import MarketPage from "./pages/MarketPage";
import DeckPage from "./pages/DeckPage";
import LoginPage from "./pages/LoginPage";
import AdminPage from "./pages/AdminPage";

export default function App() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0a]">
        <p className="text-[#d97706] font-mono tracking-widest text-sm animate-pulse">
          INITIALIZING...
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
        <Route path="/deck" component={DeckPage} />
        <Route component={MarketPage} />
      </Switch>
      <Toaster
        theme="dark"
        toastOptions={{
          style: {
            background: "#1a1209",
            border: "1px solid #d97706",
            color: "#e8dcc8",
            fontFamily: "Courier New, monospace",
            fontSize: "13px",
          },
        }}
      />
    </>
  );
}
