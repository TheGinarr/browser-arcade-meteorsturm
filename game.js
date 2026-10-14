/* ============================================================
   METEORSTURM · game.js
   ------------------------------------------------------------
   SO FUNKTIONIERT DIESES SPIEL
   1. Zustand: ein Schiff (oder null, solange es nach einem Treffer
      neu aufgebaut wird), Listen für Brocken, eigene Schüsse,
      UFO-Schüsse und Partikel, dazu höchstens ein UFO. Eine "phase"
      (bereit / laeuft / pause / vorbei) steuert die Eingaben.
   2. Reine Logik in logik.js: Flugphysik mit Trägheit, Rand-Umlauf,
      Kollisionen, Zerfall der Brocken, UFO-Verhalten. Hier in game.js
      liegen nur Eingabe, Spielschleife und Zeichnen.
   3. Spielschleife mit festem Zeitschritt (1/120 s, Muster
      "Akkumulator" wie bei Snake): Die Physik ist auf jedem Gerät
      exakt gleich, egal ob 60- oder 144-Hz-Bildschirm.
   4. Vektor-Look: Alles besteht aus Linien. Das Leuchten entsteht mit
      shadowBlur, der "Phosphor"-Nachschein durch ein halbtransparentes
      Übermalen statt komplettem Löschen (nur wenn Bewegung erlaubt).
   5. Wellen: Sind alle Brocken zerstört, beginnt nach kurzer Pause die
      nächste Welle mit mehr und etwas schnelleren Brocken.
   6. Ende: Sind alle Leben weg, übernimmt gameOverDialog() aus ui.js.
   ============================================================ */

import { topliste, spielZuruecksetzen } from "./assets/storage.js";
import {
  bewegungReduziert,
  gameOverDialog,
  toplisteAnzeigen,
  zahlHochzaehlen,
} from "./assets/ui.js";
import { spielSeite, text, TASTE } from "./assets/mobil.js";
import {
  BREITE,
  HOEHE,
  SCHIFF_RADIUS,
  MAX_SCHUESSE,
  BROCKEN_RADIUS,
  UFO_PUNKTE,
  UFO_RADIUS,
  umlauf,
  kreiseTreffen,
  neuesSchiff,
  schiffSchritt,
  schussVomSchiff,
  schussSchritt,
  brockenSchritt,
  brockenTeilen,
  punkteFuer,
  wellenBrocken,
  mitteFrei,
  ufoPause,
  neuesUfo,
  ufoSchritt,
  ufoZielWinkel,
  ufoSchuss,
  bonusLeben,
  hyperraumZiel,
} from "./logik.js";

/* ---------- Konstanten ---------- */
const SPIEL = "meteorsturm";
const SCHRITT = 1 / 120; // Physik-Zeitschritt (fest)
const MAX_FRAME_ABSTAND_MS = 250;
const START_LEBEN = 3;
const FEUER_PAUSE = 0.22; // s zwischen zwei Schüssen bei gehaltener Taste
const HYPER_PAUSE = 1.0; // s Sperre nach einem Hyperraum-Sprung
const WELLEN_PAUSE = 2.0; // s zwischen zwei Wellen
const NEU_PAUSE = 1.6; // s nach einem Treffer, bevor das Schiff zurückkommt
const SPERRE_NACH_DIALOG_MS = 700;

const TASTEN = {
  links: new Set(["arrowleft", "a"]),
  rechts: new Set(["arrowright", "d"]),
  schub: new Set(["arrowup", "w"]),
  feuer: new Set([" "]),
  hyper: new Set(["arrowdown", "s", "shift"]),
};

/* ---------- Elemente ---------- */
const leinwand = document.getElementById("leinwand");
const z = leinwand.getContext("2d");
const hudPunkte = document.getElementById("hud-punkte");
const hudLeben = document.getElementById("hud-leben");
const hudWelle = document.getElementById("hud-welle");
const hudRekord = document.getElementById("hud-rekord");
const toplisteBox = document.getElementById("topliste");
const resetKnopf = document.getElementById("reset");

leinwand.width = BREITE;
leinwand.height = HOEHE;
leinwand.style.touchAction = "none";

/* ---------- Farben ----------
   Bewusst NICHT aus dem Neon-Design: Im Spielfeld gilt der Look der
   Vektor-Ära (weiß-bläulicher Phosphor auf Schwarz). Texte und Rahmen
   außerhalb des Canvas nutzen weiter die Design-Tokens. */
const stil = getComputedStyle(document.body);
const PHOSPHOR = "#e9f6ff";
const GLUEHEN = "#7fd8ff";
const farben = {
  grund: "#020308",
  linie: PHOSPHOR,
  ufo: "#ffe9b0",
  schussUfo: "#ffd27a",
  text: PHOSPHOR,
  schriftPixel: stil.getPropertyValue("--pixel").trim() || "monospace",
  schriftText: stil.getPropertyValue("--sans").trim() || "sans-serif",
};

/* ---------- Zustand ---------- */
let phase; // "bereit" | "laeuft" | "pause" | "vorbei"
let schiff; // Objekt aus logik.js oder null
let brocken, schuesse, ufoSchuesse, partikel;
let ufo, ufoTimer;
let punkte, leben, welle;
let wellenTimer; // > 0: Pause bis zur nächsten Welle
let neuTimer; // > 0: Schiff ist zerstört und kommt nach Ablauf zurück
let feuerTimer = 0,
  hyperTimer = 0;
let rekordGespeichert = 0;
let banner = "",
  bannerBis = 0;
let akkumulator = 0,
  letzteZeit = 0,
  spielzeit = 0;
let dialogGezeigt = false;
let ruhigerModus = bewegungReduziert();
const taste = { links: false, rechts: false, schub: false, feuer: false, hyper: false };
let feuerGedrueckt = false; // für "einmal tippen = ein Schuss"

/* ============================================================
   HUD & Topliste
   ============================================================ */
function toplisteAktualisieren() {
  const liste = topliste(SPIEL);
  rekordGespeichert = liste.length ? liste[0].punkte : 0;
  toplisteAnzeigen(toplisteBox, SPIEL);
}
function hudAktualisieren() {
  zahlHochzaehlen(hudPunkte, punkte, 250);
  hudLeben.textContent = String(leben);
  hudWelle.textContent = String(welle);
  hudRekord.textContent = String(Math.max(rekordGespeichert, punkte));
}

/* ============================================================
   Spielablauf
   ============================================================ */
function neuesSpiel() {
  phase = "bereit";
  schiff = neuesSchiff();
  punkte = 0;
  leben = START_LEBEN;
  welle = 1;
  brocken = wellenBrocken(welle, schiff, Math.random);
  schuesse = [];
  ufoSchuesse = [];
  partikel = [];
  ufo = null;
  ufoTimer = ufoPause(welle, Math.random);
  wellenTimer = 0;
  neuTimer = 0;
  akkumulator = 0;
  dialogGezeigt = false;
  toplisteAktualisieren();
  hudPunkte.textContent = "0";
  hudAktualisieren();
}

function bannerZeigen(text, dauer = 1.6) {
  banner = text;
  bannerBis = spielzeit + dauer;
}

function punkteDazu(n) {
  const alt = punkte;
  punkte += n;
  const extra = bonusLeben(alt, punkte);
  if (extra > 0) {
    leben += extra;
    bannerZeigen("EXTRALEBEN!", 1.4);
  }
  hudAktualisieren();
}

function explosion(x, y, menge, farbe = farben.linie) {
  if (ruhigerModus) menge = Math.ceil(menge / 3);
  for (let i = 0; i < menge; i++) {
    const w = Math.random() * Math.PI * 2;
    const v = 40 + Math.random() * 160;
    partikel.push({
      x,
      y,
      vx: Math.cos(w) * v,
      vy: Math.sin(w) * v,
      rest: 0.4 + Math.random() * 0.6,
      laenge: Math.random() < 0.35 ? 4 + Math.random() * 8 : 0, // manche sind kleine Linien-Splitter
      winkel: Math.random() * Math.PI,
      farbe,
    });
  }
}

function brockenTreffen(index) {
  const b = brocken[index];
  brocken.splice(index, 1);
  brocken.push(...brockenTeilen(b, Math.random, welle));
  punkteDazu(punkteFuer(b.groesse));
  explosion(b.x, b.y, 6 + b.groesse * 5);
}

function schiffZerstoeren() {
  if (!schiff) return;
  explosion(schiff.x, schiff.y, 26, GLUEHEN);
  // Wrack: die Linien des Schiffs fliegen auseinander
  for (let i = 0; i < 5; i++) {
    const w = Math.random() * Math.PI * 2;
    partikel.push({
      x: schiff.x,
      y: schiff.y,
      vx: Math.cos(w) * 60 + schiff.vx * 0.3,
      vy: Math.sin(w) * 60 + schiff.vy * 0.3,
      rest: 1.4,
      laenge: 12,
      winkel: Math.random() * Math.PI,
      dreh: (Math.random() - 0.5) * 6,
      farbe: farben.linie,
    });
  }
  schiff = null;
  leben -= 1;
  hudAktualisieren();
  if (leben <= 0) {
    phase = "vorbei";
    setTimeout(dialogAnzeigen, ruhigerModus ? 200 : 1200);
  } else {
    neuTimer = NEU_PAUSE;
  }
}

function naechsteWelle() {
  welle += 1;
  brocken = wellenBrocken(welle, schiff, Math.random);
  ufoTimer = ufoPause(welle, Math.random);
  hudAktualisieren();
  bannerZeigen(`WELLE ${welle}`);
}

/* ---------- Ein Physikschritt ---------- */
function schritt(dt) {
  spielzeit += dt;
  feuerTimer = Math.max(0, feuerTimer - dt);
  hyperTimer = Math.max(0, hyperTimer - dt);

  // Schiff: zurückholen, sobald die Mitte frei ist
  if (!schiff && phase === "laeuft") {
    neuTimer -= dt;
    if (neuTimer <= 0 && mitteFrei(brocken, ufo)) schiff = neuesSchiff();
  }

  if (schiff) {
    schiffSchritt(schiff, taste, dt);
    // Feuer: neuer Tastendruck schießt sofort, gehalten alle FEUER_PAUSE Sekunden
    if (taste.feuer && feuerTimer <= 0 && schuesse.length < MAX_SCHUESSE) {
      schuesse.push(schussVomSchiff(schiff));
      feuerTimer = FEUER_PAUSE;
    }
    if (taste.hyper && hyperTimer <= 0) {
      const ziel = hyperraumZiel(Math.random);
      explosion(schiff.x, schiff.y, 8, GLUEHEN);
      Object.assign(schiff, ziel, { vx: 0, vy: 0 });
      hyperTimer = HYPER_PAUSE;
    }
  }

  for (const b of brocken) brockenSchritt(b, dt);
  schuesse = schuesse.filter((s) => schussSchritt(s, dt));
  ufoSchuesse = ufoSchuesse.filter((s) => schussSchritt(s, dt));

  // UFO
  if (ufo) {
    if (!ufoSchritt(ufo, dt, Math.random)) ufo = null;
    else {
      ufo.schussPause -= dt;
      if (ufo.schussPause <= 0) {
        ufoSchuesse.push(ufoSchuss(ufo, ufoZielWinkel(ufo, schiff, punkte, Math.random)));
        ufo.schussPause = ufo.art === "klein" ? 0.9 : 1.3;
      }
    }
  } else if (brocken.length > 0) {
    ufoTimer -= dt;
    if (ufoTimer <= 0) {
      ufo = neuesUfo(punkte, welle, Math.random);
      ufoTimer = ufoPause(welle, Math.random);
    }
  }

  // Treffer: eigene Schüsse gegen Brocken und UFO
  for (let i = schuesse.length - 1; i >= 0; i--) {
    const s = schuesse[i];
    const bi = brocken.findIndex((b) => kreiseTreffen(s, 2, b, BROCKEN_RADIUS[b.groesse] * 0.92));
    if (bi >= 0) {
      schuesse.splice(i, 1);
      brockenTreffen(bi);
      continue;
    }
    if (ufo && kreiseTreffen(s, 2, ufo, UFO_RADIUS[ufo.art])) {
      schuesse.splice(i, 1);
      punkteDazu(UFO_PUNKTE[ufo.art]);
      explosion(ufo.x, umlauf(ufo.y, HOEHE), 22, farben.ufo);
      ufo = null;
    }
  }

  // UFO-Schüsse treffen auch Brocken (wie im Original-Genre üblich)
  for (let i = ufoSchuesse.length - 1; i >= 0; i--) {
    const s = ufoSchuesse[i];
    const bi = brocken.findIndex((b) => kreiseTreffen(s, 2, b, BROCKEN_RADIUS[b.groesse] * 0.92));
    if (bi >= 0) {
      ufoSchuesse.splice(i, 1);
      const b = brocken[bi];
      brocken.splice(bi, 1);
      brocken.push(...brockenTeilen(b, Math.random, welle));
      explosion(b.x, b.y, 8);
    }
  }

  // Schiff getroffen? (Schutzzeit nach dem Erscheinen)
  if (schiff && schiff.schutz <= 0) {
    const r = SCHIFF_RADIUS * 0.85;
    const bi = brocken.findIndex((b) =>
      kreiseTreffen(schiff, r, b, BROCKEN_RADIUS[b.groesse] * 0.82),
    );
    if (bi >= 0) {
      brockenTreffen(bi);
      schiffZerstoeren();
    } else if (ufo && kreiseTreffen(schiff, r, ufo, UFO_RADIUS[ufo.art])) {
      punkteDazu(UFO_PUNKTE[ufo.art]);
      explosion(ufo.x, ufo.y, 20, farben.ufo);
      ufo = null;
      schiffZerstoeren();
    } else {
      const si = ufoSchuesse.findIndex((s) => kreiseTreffen(schiff, r, s, 2));
      if (si >= 0) {
        ufoSchuesse.splice(si, 1);
        schiffZerstoeren();
      }
    }
  }

  // Welle geschafft?
  if (brocken.length === 0 && !ufo && phase === "laeuft") {
    if (wellenTimer <= 0) wellenTimer = WELLEN_PAUSE;
    wellenTimer -= dt;
    if (wellenTimer <= 0) naechsteWelle();
  }
}

function partikelBewegen(dt) {
  for (const p of partikel) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.985;
    p.vy *= 0.985;
    if (p.dreh) p.winkel += p.dreh * dt;
    p.rest -= dt;
  }
  partikel = partikel.filter((p) => p.rest > 0);
}

/* ---------- Dialog ---------- */
function dialogAnzeigen() {
  if (dialogGezeigt) return;
  dialogGezeigt = true;
  const dialog = gameOverDialog({
    spiel: SPIEL,
    titel: "GAME OVER",
    punkte,
    punkteText: `${punkte} Punkte`,
    richtung: "hoch",
    neustart: neuesSpiel,
  });
  // Kurz sperren, damit Dauerfeuer den Dialog nicht sofort wegdrückt
  const bis = performance.now() + SPERRE_NACH_DIALOG_MS;
  const sperren = (e) => {
    if (performance.now() < bis) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  document.addEventListener("keydown", sperren, true);
  dialog.style.pointerEvents = "none";
  setTimeout(() => {
    dialog.style.pointerEvents = "";
    document.removeEventListener("keydown", sperren, true);
  }, SPERRE_NACH_DIALOG_MS);
  dialog.addEventListener("close", () => {
    toplisteAktualisieren();
    hudAktualisieren();
  });
}

/* ============================================================
   Eingabe
   ============================================================ */
function starten() {
  if (phase === "bereit") {
    phase = "laeuft";
    akkumulator = 0;
    bannerZeigen("WELLE 1", 1.2);
  } else if (phase === "pause") {
    phase = "laeuft";
  } else if (phase === "vorbei" && dialogGezeigt && !document.getElementById("spiel-dialog")) {
    neuesSpiel();
  }
}

function pauseUmschalten() {
  if (phase === "laeuft") phase = "pause";
  else if (phase === "pause") phase = "laeuft";
}

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.getElementById("spiel-dialog")) return;
  const k = e.key.toLowerCase();
  if (k === "p") {
    pauseUmschalten();
    return;
  }
  const istStart = k === "enter" || k === " ";
  const art = Object.keys(TASTEN).find((n) => TASTEN[n].has(k));
  if (!art && !istStart) return;
  if (istStart && e.target instanceof HTMLElement && e.target.matches("button, a, summary")) return;
  e.preventDefault();
  if (phase !== "laeuft") {
    if (istStart || art === "schub") starten();
    return;
  }
  if (art) {
    if (art === "feuer" && !taste.feuer) feuerTimer = 0; // neuer Druck: sofort schießen
    taste[art] = true;
  }
});
document.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  const art = Object.keys(TASTEN).find((n) => TASTEN[n].has(k));
  if (art) taste[art] = false;
});

// Tippen/Klicken aufs Feld: starten bzw. weiter. Im Spiel: Pause.
// Während des Spiels bewusst OHNE Wirkung: Am Handy landet der Daumen
// sonst versehentlich auf dem Feld und pausiert mitten im Gefecht.
leinwand.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (phase !== "laeuft") starten();
});

function eingabeVergessen() {
  for (const k of Object.keys(taste)) taste[k] = false;
  if (phase === "laeuft") phase = "pause";
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) eingabeVergessen();
});
window.addEventListener("blur", eingabeVergessen);

resetKnopf.addEventListener("click", () => {
  spielZuruecksetzen(SPIEL);
  toplisteAktualisieren();
  hudAktualisieren();
  if (phase === "laeuft") phase = "pause";
  resetKnopf.blur();
});

/* ============================================================
   Zeichnen
   ============================================================ */

/** Zeichnet eine Form an allen Stellen, an denen sie über den Rand ragt. */
function ueberallZeichnen(x, y, r, zeichne) {
  const xs = [x],
    ys = [y];
  if (x < r) xs.push(x + BREITE);
  else if (x > BREITE - r) xs.push(x - BREITE);
  if (y < r) ys.push(y + HOEHE);
  else if (y > HOEHE - r) ys.push(y - HOEHE);
  for (const px of xs) for (const py of ys) zeichne(px, py);
}

function linienStil(farbe = farben.linie, staerke = 1.6) {
  z.strokeStyle = farbe;
  z.lineWidth = staerke;
  z.lineJoin = "round";
  z.lineCap = "round";
  z.shadowColor = GLUEHEN;
  z.shadowBlur = ruhigerModus ? 4 : 8;
}

function zeichneSchiff(s, jetzt) {
  // Blinken während der Schutzzeit
  if (s.schutz > 0 && Math.floor(jetzt / 110) % 2 === 0) return;
  ueberallZeichnen(s.x, s.y, 20, (x, y) => {
    z.save();
    z.translate(x, y);
    z.rotate(s.winkel);
    linienStil();
    // Eigene Schiffsform: schlanke Pfeilspitze mit gekerbtem Heck
    z.beginPath();
    z.moveTo(15, 0);
    z.lineTo(-9, -10);
    z.lineTo(-4, -4);
    z.lineTo(-7, 0);
    z.lineTo(-4, 4);
    z.lineTo(-9, 10);
    z.closePath();
    z.stroke();
    // Flamme beim Schub, flackert
    if (s.schub && Math.floor(jetzt / 45) % 3 !== 0) {
      z.beginPath();
      z.moveTo(-6, -3);
      z.lineTo(-14 - Math.random() * 6, 0);
      z.lineTo(-6, 3);
      z.stroke();
    }
    z.restore();
  });
}

function zeichneBrocken(b) {
  const r = BROCKEN_RADIUS[b.groesse];
  ueberallZeichnen(b.x, b.y, r * 1.2, (x, y) => {
    z.save();
    z.translate(x, y);
    z.rotate(b.drehung);
    linienStil();
    z.beginPath();
    b.form.forEach((faktor, i) => {
      const w = (i / b.form.length) * Math.PI * 2;
      const px = Math.cos(w) * r * faktor;
      const py = Math.sin(w) * r * faktor;
      if (i === 0) z.moveTo(px, py);
      else z.lineTo(px, py);
    });
    z.closePath();
    z.stroke();
    z.restore();
  });
}

function zeichneUfo(u) {
  const r = UFO_RADIUS[u.art];
  // Das UFO fliegt quer durchs Bild und verlässt es dann: kein Rand-Umlauf in x.
  [[u.x, u.y]].forEach(([x, y]) => {
    z.save();
    z.translate(x, y);
    linienStil(farben.ufo);
    z.shadowColor = "#ffb84d";
    // Eigene UFO-Form: flache Linse mit Kuppel und drei Lichtern
    z.beginPath();
    z.ellipse(0, 0, r * 1.5, r * 0.5, 0, 0, Math.PI * 2);
    z.stroke();
    z.beginPath();
    z.arc(0, -r * 0.25, r * 0.6, Math.PI * 1.05, Math.PI * 1.95);
    z.stroke();
    for (const lx of [-0.8, 0, 0.8]) {
      z.beginPath();
      z.arc(lx * r, r * 0.12, 1.4, 0, Math.PI * 2);
      z.stroke();
    }
    z.restore();
  });
}

function zeichnePunkt(x, y, farbe, groesse = 2) {
  z.fillStyle = farbe;
  z.shadowColor = farbe;
  z.shadowBlur = ruhigerModus ? 3 : 8;
  z.beginPath();
  z.arc(x, y, groesse, 0, Math.PI * 2);
  z.fill();
}

function zeichnePartikel() {
  for (const p of partikel) {
    z.globalAlpha = Math.min(1, p.rest * 1.6);
    if (p.laenge) {
      linienStil(p.farbe, 1.3);
      z.beginPath();
      z.moveTo(
        p.x - (Math.cos(p.winkel) * p.laenge) / 2,
        p.y - (Math.sin(p.winkel) * p.laenge) / 2,
      );
      z.lineTo(
        p.x + (Math.cos(p.winkel) * p.laenge) / 2,
        p.y + (Math.sin(p.winkel) * p.laenge) / 2,
      );
      z.stroke();
    } else {
      zeichnePunkt(p.x, p.y, p.farbe, 1.2);
    }
  }
  z.globalAlpha = 1;
}

function zeichneLebenImFeld() {
  // Kleine Schiffe oben links (wie auf alten Automaten), Punkte oben mittig
  for (let i = 0; i < Math.min(leben, 8); i++) {
    z.save();
    z.translate(22 + i * 18, 24);
    z.rotate(-Math.PI / 2);
    z.scale(0.6, 0.6);
    linienStil(farben.linie, 2);
    z.beginPath();
    z.moveTo(15, 0);
    z.lineTo(-9, -10);
    z.lineTo(-4, -4);
    z.lineTo(-7, 0);
    z.lineTo(-4, 4);
    z.lineTo(-9, 10);
    z.closePath();
    z.stroke();
    z.restore();
  }
  z.save();
  z.shadowColor = GLUEHEN;
  z.shadowBlur = 6;
  z.fillStyle = farben.text;
  z.font = `14px ${farben.schriftPixel}`;
  z.textAlign = "right";
  z.textBaseline = "top";
  z.fillText(String(punkte).padStart(5, "0"), BREITE - 16, 14);
  z.restore();
}

function zeichneText(titel, unter, jetzt) {
  z.save();
  z.globalAlpha = 0.72;
  z.fillStyle = farben.grund;
  z.fillRect(0, 0, BREITE, HOEHE);
  z.globalAlpha = 1;
  z.textAlign = "center";
  z.textBaseline = "middle";
  z.shadowColor = GLUEHEN;
  z.shadowBlur = 14;
  z.fillStyle = farben.text;
  z.font = `22px ${farben.schriftPixel}`;
  z.fillText(titel, BREITE / 2, HOEHE / 2 - 16);
  if (unter) {
    z.shadowBlur = 0;
    z.globalAlpha = ruhigerModus ? 1 : 0.8 + 0.2 * Math.sin(jetzt / 350);
    z.font = `16px ${farben.schriftText}`;
    z.fillText(unter, BREITE / 2, HOEHE / 2 + 22);
  }
  z.restore();
}

function zeichneAlles(jetzt) {
  // Phosphor-Nachschein: nur teilweise übermalen, alte Linien glimmen kurz nach
  z.shadowBlur = 0;
  z.globalAlpha = ruhigerModus ? 1 : 0.55;
  z.fillStyle = farben.grund;
  z.fillRect(0, 0, BREITE, HOEHE);
  z.globalAlpha = 1;

  for (const b of brocken) zeichneBrocken(b);
  if (ufo) zeichneUfo(ufo);
  for (const s of schuesse) zeichnePunkt(s.x, s.y, farben.linie, 1.8);
  for (const s of ufoSchuesse) zeichnePunkt(s.x, s.y, farben.schussUfo, 2);
  if (schiff && phase !== "vorbei") zeichneSchiff(schiff, jetzt);
  zeichnePartikel();
  zeichneLebenImFeld();

  if (banner && spielzeit < bannerBis && phase === "laeuft") {
    z.save();
    z.textAlign = "center";
    z.textBaseline = "middle";
    z.shadowColor = GLUEHEN;
    z.shadowBlur = 12;
    z.fillStyle = farben.text;
    z.font = `20px ${farben.schriftPixel}`;
    z.fillText(banner, BREITE / 2, HOEHE / 2 - 60);
    z.restore();
  }

  if (phase === "bereit") {
    zeichneText(
      text("TASTE DRÜCKEN", "ZUM START TIPPEN"),
      text(
        "Leertaste startet · ← → drehen · ↑ Schub · ↓ Hyperraum",
        "Links drehen · rechts Schub, Feuer, Hyperraum",
      ),
      jetzt,
    );
  } else if (phase === "pause") {
    zeichneText("PAUSE", text("P oder Leertaste: weiter", "Antippen: weiter"), jetzt);
  } else if (phase === "vorbei") {
    zeichneText("GAME OVER", "", jetzt);
  }
}

/* ============================================================
   Hauptschleife
   ============================================================ */
function einzelbild(jetzt) {
  const abstand = Math.min(jetzt - letzteZeit, MAX_FRAME_ABSTAND_MS) / 1000;
  letzteZeit = jetzt;
  ruhigerModus = bewegungReduziert();
  if (phase === "laeuft" || phase === "vorbei") {
    akkumulator += abstand;
    while (akkumulator >= SCHRITT) {
      akkumulator -= SCHRITT;
      if (phase === "laeuft") schritt(SCHRITT);
      else {
        // nach dem Ende treiben Brocken und Trümmer weiter
        spielzeit += SCHRITT;
        for (const b of brocken) brockenSchritt(b, SCHRITT);
      }
    }
  }
  if (phase !== "pause") partikelBewegen(abstand);
  zeichneAlles(jetzt);
  requestAnimationFrame(einzelbild);
}

/* ============================================================
   Start
   ============================================================ */
neuesSpiel();
// Handy: Drehen links, Schub/Feuer/Hyperraum rechts (assets/mobil.js)
spielSeite({
  phase: () => phase,
  gamepad: {
    links: [
      { ...TASTE.links, zeichen: "⟲", name: "Links drehen" },
      { ...TASTE.rechts, zeichen: "⟳", name: "Rechts drehen" },
    ],
    rechts: [
      { ...TASTE.runter, zeichen: "✦", name: "Hyperraum", beschriftung: "HYPER" },
      { ...TASTE.hoch, zeichen: "▲", name: "Schub", beschriftung: "SCHUB" },
      { ...TASTE.leer, zeichen: "●", name: "Feuer", beschriftung: "FEUER", gross: true },
    ],
  },
});
letzteZeit = performance.now();
requestAnimationFrame(einzelbild);
