---
name: Scrawdle
description: Roll the die, draw the word, vote for the best one; a Saturday-night family game show where the TV is the set and every phone is a buzzer pad.
colors:
  night: "#0B0926"
  navy: "#141038"
  violet: "#2B1C63"
  plum: "#43207A"
  bezel: "#120C35"
  key-violet: "#4A35A8"
  key-base: "#1A1150"
  gold: "#FFC23D"
  gold-edge: "#9A5B12"
  buzzer-base: "#6E3E0A"
  bulb: "#FFE7A6"
  cream: "#FFF4DE"
  tile-edge: "#B9945A"
  magenta: "#F2358A"
  applause: "#B8135E"
  teal: "#1ED3C2"
  teal-edge: "#0E7F74"
  ink: "#1B1240"
  text-2: "#C9BEF0"
  danger: "#FF6B6B"
  canvas: "#FFFFFF"
  contestant-4: "#8E7BFF"
  contestant-5: "#FF8A3D"
  contestant-6: "#6FE36F"
  contestant-7: "#4FB4FF"
  contestant-8: "#FF9ECF"
typography:
  display:
    fontFamily: "Shrikhand, Big Shoulders Display, serif"
    fontSize: "34px"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "0.01em"
  logo:
    fontFamily: "Shrikhand, Big Shoulders Display, serif"
    fontSize: "40px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.01em"
  board:
    fontFamily: "Big Shoulders Display, Bricolage Grotesque, sans-serif"
    fontSize: "40px"
    fontWeight: 900
    lineHeight: 1
  headline:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 800
    lineHeight: 1.1
  body:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.45
  lead:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
  label:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.3
  button:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.01em"
rounded:
  small-key: "14px"
  key: "18px"
  panel: "22px"
  board: "30px"
  pad: "36px"
  buzzer: "50px"
  pill: "999px"
spacing:
  tight: "6px"
  gap: "10px"
  panel: "14px"
  frame: "20px"
  section: "28px"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.key}"
    padding: "0 28px"
    height: "60px"
  button-key:
    backgroundColor: "{colors.key-violet}"
    textColor: "{colors.cream}"
    rounded: "{rounded.key}"
    padding: "0 22px"
    height: "52px"
  button-icon-key:
    backgroundColor: "{colors.key-violet}"
    textColor: "{colors.cream}"
    rounded: "{rounded.small-key}"
    size: "44px"
  button-go:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.ink}"
    rounded: "{rounded.small-key}"
    height: "60px"
  buzzer-done:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.ink}"
    typography: "{typography.display}"
    rounded: "{rounded.buzzer}"
    height: "84px"
  tool-key:
    backgroundColor: "{colors.key-violet}"
    textColor: "{colors.cream}"
    rounded: "15px"
    height: "60px"
  tool-key-lit:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.ink}"
    rounded: "15px"
    height: "60px"
  panel:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.cream}"
    rounded: "{rounded.panel}"
    padding: "14px"
  flip-tile:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
    typography: "{typography.board}"
  category-chip:
    backgroundColor: "{colors.applause}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.pill}"
  code-slot:
    backgroundColor: "{colors.violet}"
    textColor: "{colors.teal}"
    typography: "{typography.board}"
    rounded: "12px"
    height: "60px"
---

# Design System: Scrawdle

## Overview

**Creative North Star: "The Saturday-Night Studio"**

Scrawdle is a family game show taped on a Saturday night. The TV is the set: a deep night-violet studio lit from above, a faint fluted back wall, a glossy floor that throws back a warm pool of light, a gold marquee board whose bulbs chase slowly round the word, cream flip tiles that turn over letter by letter, and contestant podiums with lit name panels along the bottom. Every phone is a contestant's buzzer pad: a chunky violet slab with two screws, a little scoreboard on top, the white canvas in a dark bezel, round colour buttons, chunky keys that press in, and one giant domed gold Done! buzzer.

The system is classy-fun, never casino. Energy comes from real colour on a dark set, physical keys that travel when pressed, and big moments set in Shrikhand; restraint comes from colours that each have one job, a single chase on the whole set, and a quiet, legible grotesque for everything people read. It refuses both the quiet grey app (rejected twice in this project's history as boring) and the tacky casino.

The studio is always night. There is no light theme; the theme toggle is hidden on home.

**Key Characteristics:**
- Night-violet set under a soft stage light (`--bg-stage`), with a fluted back wall that fades out above the floor.
- One slow bulb chase, on the marquee word board only.
- Gold is the one main action, the bulbs and the leader; magenta is the category and applause; teal is time and go; violet keys are everything else.
- Physical keys: every key stands on a solid base edge and travels down into it when pressed.
- Cream flip tiles, split across the middle, for the word, the room code's cousins and the scoreboard numbers.
- The drawing canvas is white, square-cornered, in a dark bezel, and the largest thing on a phone.
- TV screens scale as one picture in `--u` units; phones keep text at 12px or more.

## Colors

A dark, saturated studio with three lit accents that never trade jobs.

### Primary
- **Marquee Gold** (#FFC23D): the one main action on any screen (the gold key, the Host buzzer, the Done! buzzer), the marquee bulbs, the leader's crown, podium spotlight and score digits, the selected colour's glow and focus rings. Its key sits on Gold Edge (#9A5B12); the buzzers sit on Buzzer Base (#6E3E0A).
- **Bulb Glow** (#FFE7A6): the lit core of a bulb, the round counter's lettering, warm highlights.

### Secondary
- **Applause Magenta** (#F2358A): the category (its die-face disc ring, the category pill, the last word of a phrase), applause moments, the "!" in the logo, the clock in its last ten seconds, the current round pip.
- **Applause Deep** (#B8135E): magenta deep enough to carry white lettering at any size (6.4:1). Use it whenever white text sits on magenta.

### Tertiary
- **Go Teal** (#1ED3C2): time and go: the clock ring, the Join key, the room-code letters, "Sent!" and "You're in!" tags, done ticks on podiums. Its key edge is Teal Edge (#0E7F74).

### Neutral
- **Studio Night** (#0B0926): the page ground and the backdrop behind dialogs.
- **Stage Navy** (#141038): the top of the stage light, panel faces.
- **Set Violet** (#2B1C63): raised set pieces, the code slot's split tile.
- **Curtain Plum** (#43207A): the stage light's floor glow, scrollbars.
- **Bezel** (#120C35): the dark ring round the canvas, avatars and colour dots.
- **Key Violet** (#4A35A8) on **Key Base** (#1A1150): every ordinary key.
- **Cream** (#FFF4DE): flip tiles, plates, the category disc, and the primary text colour on the dark set (17.8:1 on night).
- **Lilac Text** (#C9BEF0): secondary text on the dark set (10.4:1 on navy).
- **Ink** (#1B1240): all text on gold, cream and teal (10.8:1 on gold, 9.2:1 on teal).
- **Tile Edge** (#B9945A): the solid edge under cream tiles and plates.
- **Canvas White** (#FFFFFF): the drawing surface and drawing cards, never tinted.
- **Danger** (#FF6B6B): failed saves and a bad join code, always with words.

### Contestant colours
Eight colours in join order ring each avatar and light each podium: magenta, teal and gold first (the accents themselves), then Contestant Lilac (#8E7BFF), Orange (#FF8A3D), Green (#6FE36F), Sky (#4FB4FF) and Pink (#FF9ECF). They identify a player and nothing else.

### Named Rules
**The One Gold Rule.** One gold key or buzzer per screen. Gold also lights the bulbs and the leader; it never decorates a secondary action.

**The Three Jobs Rule.** Magenta is the category and applause, teal is time and go, gold is the act and the lead. A colour that has a job is not borrowed for another.

**The Ink-on-Light Rule.** Text on gold, cream and teal is Ink; text on the dark set is Cream or Lilac Text; white lettering on magenta sits on Applause Deep.

## Typography

**Display Font:** Shrikhand (with Big Shoulders Display, serif)
**Board Font:** Big Shoulders Display, 800 to 900 (with Bricolage Grotesque)
**Body Font:** Bricolage Grotesque, variable 200 to 800 (with system-ui)

**Character:** Shrikhand is the show's host: a fat, slanted marquee script for the logo and the big moments. Big Shoulders Display is the scoreboard: condensed numerals and capitals for tiles, scores, timers and codes. Bricolage Grotesque carries every word people actually read.

### Hierarchy
- **Logo** (Shrikhand 400, 40px home / 22px phone / 3.6u TV, line 1): the wordmark in gold, rotated -3deg, on a stacked warm text shadow; the "!" in magenta.
- **Display** (Shrikhand 400, 34px phone / 3.4u TV, line 1.1): big titles ("Who drew what?"), the Done! buzzer (30px), the Host buzzer's name (28px). Balanced wrap.
- **Board** (Big Shoulders Display 900, line 1): flip-tile letters sized from the word's longest row (22 to 92px), the room code (40px), podium scores (2.5u), the clock digits (0.42 of the dial), always tabular numerals for numbers.
- **Headline** (Bricolage 800, 21 to 22px, line 1.1): panel names, the word on the phone scoreboard, the finish word.
- **Lead** (Bricolage 600, 17px, line 1.4, max 32ch phone / 40ch TV): instructions on the pad and the TV.
- **Body** (Bricolage 500, 16px, line 1.45): default running text.
- **Label** (Bricolage 600 to 700, 14px, line 1.3): sub-lines, help text, status lines. 12px is the floor on phones; 1.05u (20px on a 1080p TV) is the floor on TV.
- **Button** (Bricolage 800, 22px gold key / 18px violet key / 20px Join).

### Named Rules
**The Host Rule.** Shrikhand is for the logo, big titles and the buzzers only; it never sets a label, a list or a paragraph.

**The Scoreboard Rule.** Anything counted or keyed in (tiles, scores, timers, codes) is Big Shoulders Display with tabular numerals.

**The Unbroken Word Rule.** A word never breaks across tile rows; rows are chosen by the game, never wrapped by chance. Compound pairs stay together. W and M are narrowed horizontally (scaleX .8 to .9), never shortened.

## Layout

Phones and split screens come first: the drawing pad is one column (scoreboard, canvas, colours, tools, footer) that fills `100dvh` and never scrolls, with a 10px row gap and 20px of pad padding plus the safe-area inset. Home is a single column of panels; at 760px it widens, and at 1000px with an aspect of at least 5:4 the reveal becomes the TV set: die and category on the left, the marquee board on the right.

The TV is one picture that scales: every TV size is in `--u`, one hundredth of a 16:9 screen's width (`min(1vw, 100vh / 56.25)`, 19.2px on a 1920 x 1080 set). The TV layout is a top strip (logo, round pips, room code, close) over the screen, with the contestant podiums along the bottom and the leader crowned. Gaps are small and concrete (6px tight, 10px default, 14px inside panels, 20px pad frame); nothing sits on an abstract scale.

## Elevation & Depth

Depth is theatrical and physical. Three devices do the work: a stage light painted with gradients (a lit top, a warm pool on the floor, faint coloured beams from the top corners on TV), soft drop shadows under panels and set pieces, and solid key bases that make every key a physical object that travels when pressed. Glows are reserved for lit things: bulbs, the leader, the selected colour, the clock.

### Shadow Vocabulary
- **Panel** (`0 18px 40px -12px rgb(0 0 0 / .6), 0 2px 0 rgb(255 255 255 / .06) inset`, with an inner `inset 0 0 0 2px rgb(255 255 255 / .08)` ring): every dark panel.
- **Gold ring** (`inset 0 0 0 2px rgb(255 194 61 / .5)`): lit-edge panels such as the phone scoreboard, the toast and popovers; also the hover state of a menu panel.
- **Key base** (`0 4px 0 #1A1150` to `0 5px 0`, plus `inset 0 2px 0 rgb(255 255 255 / .2)`): violet keys. Pressed: `0 1px 0` and the key moves down 3 to 4px.
- **Gold key** (`0 6px 0 #9A5B12, 0 14px 26px -6px rgb(0 0 0 / .55), inset 0 2px 0 rgb(255 255 255 / .55)`): the main action.
- **Buzzer** (`0 6px 0 #6E3E0A, 0 12px 24px rgb(0 0 0 / .45), inset 0 -6px 10px rgb(150 80 0 / .28)`): Done! and Host, with a white highlight oval near the top of the dome.
- **Tile** (`0 .07em 0 #B9945A, 0 .12em .2em rgb(0 0 0 / .45), inset 0 1px 0 #fff`): cream flip tiles and plates.
- **Bulb glow** (`0 0 22px rgb(255 194 61 / .35)` and kin): lit bulbs, the leader's score and spotlight, the selected card.

### Named Rules
**The Press-In Rule.** Keys stand on a solid base edge directly below them and travel down into it on press; the tool in your hand stays pressed in and lit gold. The base is the key's own thickness, straight down, never a sideways offset.

**The Untouched Canvas Rule.** Never put filter, mask or clip-path on the drawing canvas or any ancestor of it. Bezels, glows and the pad are backgrounds, borders, box-shadows and pseudo-elements beside it.

## Shapes

Generously rounded, chunky forms. Small keys 14px, tool keys 15px, the gold key 18px, panels 22px, the marquee and title boards 28 to 36px, the phone pad 32 to 36px, the Done! buzzer a 50px stadium; chips, pills and the round counter are full pills; avatars, colour dots, the category disc and the clock are circles. Flip tiles are rounded at 0.12 of their width and split by a thin line across the middle. The canvas itself is square-cornered inside a rounded white holder and a 6px bezel. Bulb rows are made of whole, evenly spaced bulbs.

## Components

### Buttons
- **Gold key (primary):** Gold gradient (#FFD467 to #FFB81F), Ink text, 800 22px, 18px radius, 60px tall, 0 28px padding, on the Gold Edge base. Hover lightens to #FFE08A; press moves down 4px. Disabled turns violet (#2B2160) with Lilac Text.
- **Violet key:** Key Violet gradient (#4A35A8 to #3A2890), Cream text, 52px tall, 16 to 18px radius, on Key Base; hover #5640B8.
- **Icon key:** 44px square violet key, 14px radius, a 2.6-stroke line icon (help, home).
- **Teal Join key:** teal gradient from #5BE6D8, Ink text 800 20px, 14px radius, on Teal Edge.
- **Quiet button:** transparent pill, Lilac Text 700 14px, 44px tall; hover adds an 8% white wash.

### Chips
- **Category chip:** a pill with the category's die face on a cream disc, white 800 text; on the finish plate it is Applause Deep. The big call after the roll ("It's silly!") is the same chip at 26px, rotated -4deg.
- **Tags:** "Sent!" and "You're in!" are teal signs in Big Shoulders 900 22px on a teal edge; "you" is a small cream pill.
- **Round counter:** a dark pill with a gold ring, round pips (gold played, magenta now, dim to come) and Bulb Glow lettering.

### Cards / Containers
- **Panel:** vertical gradient #1E1650 to #120C38, 22px radius, 14px padding, the panel shadow and ring. Menu panels lift 3px and take the gold ring on hover.
- **Drawing card:** a white drawing in a dark bezel on a dark panel; selected cards take a gold border, a gold glow and scale 1.03.
- **Plate:** a cream gradient plate (#FFF8E8 to #F1E2C2) on the tile edge, for the finished word.

### Inputs / Fields
- **Code slot:** a split flip-board tile (#2A2160 over #221A52), Go Teal letters in Big Shoulders 900 40px with 0.34em tracking, a gold caret. Focus: a teal ring plus a 4px soft teal halo. Error: a Danger ring and a short wobble, with the help line turning bold.

### Navigation
There is no nav bar. The TV's top strip holds the logo, round counter, room code and Close; the phone pad's top holds the round name and a leave key; home's title card holds the logo and two icon keys.

### The marquee word board (signature)
A violet frame (22 to 30px) round a dark screen, ringed in a dark band and a gold hairline, with a ring of dim bulbs whose lit glow chases slowly round: on the solo reveal every other bulb is lit and the lit set steps one bulb every 1.6s; on the party TV one bulb in three is lit and the glow steps every 1.2s. The word inside is cream flip tiles that flip in from -90deg, 460ms each, 55ms apart; the phrase's last word is magenta.

### The buzzer pad (signature)
The phone in play: a violet slab with a lit top edge, a heavy base and two screws; a scoreboard on top (a still row of bulbs, the category disc, the word); the canvas in its bezel; colour buttons (27px dots in 44px targets; the picked one gets a white ring and a gold glow); chunky 60px tool keys with labels; Undo, Redo, Clear; and the Done! buzzer, unlit violet until something is drawn.

### Die and stage table (signature)
A cream die with a category mark on each face, tumbling onto a violet drum with a gold-lit rim and a row of bulbs on its front. The 3D chain never carries opacity, filter, mask, clip-path or overflow.

### Contestant podium (signature)
An avatar (ringed in the contestant's colour over a bezel ring) above a dark desk lit along its top in that colour, a lit name panel with the name in white 800 and the score in gold Big Shoulders, and a status line under it. The leader's podium turns gold and wears the crown. On the leaderboard page, the top three stand on podiums of three heights (gold, teal, magenta lights) and places 4 to 10 are scoreboard rows with their numbers on flip tiles.

### Clock (signature)
A dark dial with a teal ring, tick marks and Big Shoulders digits glowing in the ring colour. In the last ten seconds the ring turns magenta and pulses once a second.

### Toast and dialogs
A dark lit panel (#221A5A to #120C38), 18px radius, gold ring and a deep drop shadow; 700 14px text.

## Do's and Don'ts

### Do:
- **Do** give every screen exactly one gold action, and make every other key violet.
- **Do** keep text on gold, cream and teal in Ink (#1B1240), and set white lettering on magenta only on Applause Deep (#B8135E).
- **Do** size TV screens in `--u` so the whole set scales as one picture; keep TV text at 1.05u or more and phone text at 12px or more.
- **Do** make keys physical: a solid base straight below, a short travel on press (3 to 6px) at 140ms with `cubic-bezier(.2, .8, .2, 1)`.
- **Do** keep the drawing canvas white and the largest thing on a phone, in its dark bezel.
- **Do** set counted and keyed things (tiles, scores, timers, codes) in Big Shoulders Display with tabular numerals.
- **Do** honour reduced motion: the duration tokens drop to 0ms, animations stop, the bulbs show lit and still, and confetti lies where it would have landed.

### Don't:
- **Don't** chase bulbs anywhere but the marquee word board, and never faster than one step every 1.2s; every other bulb row holds still. That restraint is what keeps the set classy, not casino.
- **Don't** put filter, mask or clip-path on the drawing canvas or anything that holds it.
- **Don't** set labels, lists or paragraphs in Shrikhand.
- **Don't** borrow a colour outside its job: no teal actions that aren't time or go, no magenta that isn't the category or applause, no gold on secondary keys.
- **Don't** add a light theme or a grey, low-colour screen; the studio is always night.
- **Don't** put a small label above a title; a supporting line goes under it.
- **Don't** break a word or a compound pair across tile rows.
