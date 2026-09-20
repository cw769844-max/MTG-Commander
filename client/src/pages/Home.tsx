import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="page">
      <h1>MTG Commander</h1>
      <p>Build Commander decks from the full Scryfall card pool and play manual, webcam-enabled games with up to 3 opponents.</p>
      <p>
        <Link to="/decks">Start building a deck</Link> or <Link to="/lobby">jump into a game</Link>.
      </p>
    </div>
  );
}
