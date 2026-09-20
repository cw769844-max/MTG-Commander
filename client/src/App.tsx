import { Link, Route, Routes } from "react-router-dom";
import DeckBuilder from "./pages/DeckBuilder";
import DeckList from "./pages/DeckList";
import GameTable from "./pages/GameTable";
import Home from "./pages/Home";
import Lobby from "./pages/Lobby";

export default function App() {
  return (
    <>
      <nav className="nav">
        <strong>MTG Commander</strong>
        <Link to="/">Home</Link>
        <Link to="/decks">My Decks</Link>
        <Link to="/lobby">Play</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/decks" element={<DeckList />} />
        <Route path="/decks/:deckId" element={<DeckBuilder />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/game/:roomCode" element={<GameTable />} />
      </Routes>
    </>
  );
}
