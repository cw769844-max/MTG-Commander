import { Link, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import { useAuth } from "./context/AuthContext";
import DeckBuilder from "./pages/DeckBuilder";
import DeckList from "./pages/DeckList";
import GameTable from "./pages/GameTable";
import Home from "./pages/Home";
import Lobby from "./pages/Lobby";
import Login from "./pages/Login";
import Register from "./pages/Register";

function NavAuth() {
  const { user, loading, logout } = useAuth();
  if (loading) return null;
  if (!user) {
    return (
      <>
        <Link to="/login">Log in</Link>
        <Link to="/register">Register</Link>
      </>
    );
  }
  return (
    <>
      <span>{user.displayName}</span>
      <button onClick={() => logout()}>Log out</button>
    </>
  );
}

export default function App() {
  return (
    <>
      <nav className="nav">
        <strong>MTG Commander</strong>
        <Link to="/">Home</Link>
        <Link to="/decks">My Decks</Link>
        <Link to="/lobby">Play</Link>
        <span style={{ marginLeft: "auto", display: "flex", gap: "1rem" }}>
          <NavAuth />
        </span>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/decks"
          element={
            <ProtectedRoute>
              <DeckList />
            </ProtectedRoute>
          }
        />
        <Route
          path="/decks/:deckId"
          element={
            <ProtectedRoute>
              <DeckBuilder />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lobby"
          element={
            <ProtectedRoute>
              <Lobby />
            </ProtectedRoute>
          }
        />
        <Route
          path="/game/:roomCode"
          element={
            <ProtectedRoute>
              <GameTable />
            </ProtectedRoute>
          }
        />
      </Routes>
    </>
  );
}
