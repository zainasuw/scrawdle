# frontend

The whole game: plain HTML, CSS and JavaScript with no build step. Serve this folder with any static server (see the main README).

- `index.html`: home, the Daily Word / Quick draw dice reveal, the solo drawing screen, the finish screen and the dialogs.
- `party.js` (screens and flow), `party-rules.js` (pure rules: words, rows on the word board, votes, scores; tested) and `lobby.js` (rooms over Supabase Realtime): the party game.
- `drawing.js`: drawing tools, undo and redo, auto-save, replay, the finish screen and the PNG download.
- `dice.js` and `dice.css`: the 3D die. `words.json`: the word list (compound pairs joined with a non-breaking space so they never split). `daily.js`: the word of the day.
- `stage.css`: shared design tokens. `game.css`, `screens.css`, `social.css`, `pages.css`: the drawing screen, the other solo screens, the party game, and the leaderboard / Public drawings pages.
- `publish.js`, `gallery.js`, `leaderboard.js`, `votes.js`, `sketchbook.js`: publishing, Public drawings, the leaderboard, likes and My drawings.
- `supabase-config.js`: your Supabase URL and anon key for online play (empty = offline).
