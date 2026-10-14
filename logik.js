/* ============================================================
   METEORSTURM · logik.js
   ------------------------------------------------------------
   Alle reinen Rechenfunktionen des Spiels: kein DOM, kein Canvas,
   kein Zufall von außen (wer Zufall braucht, bekommt eine
   Zufallsfunktion als Parameter). Dadurch lässt sich alles in Node
   testen, z. B.:
     node -e "import('./logik.js').then(l => console.log(l.punkteFuer(3)))"

   Koordinaten: Pixel im logischen Feld BREITE x HOEHE, Ursprung oben
   links, y wächst nach unten. Winkel im Bogenmaß, 0 = nach rechts,
   positiv = im Uhrzeigersinn (weil y nach unten zeigt).
   ============================================================ */

export const BREITE = 640;
export const HOEHE = 480;

/* ---------- Stellschrauben ---------- */
export const DREH_TEMPO = 4.4; // rad/s beim Drehen
export const SCHUB = 300; // px/s² Beschleunigung
export const REIBUNG = 0.55; // pro Sekunde verliert das Schiff diesen Anteil (exponentiell)
export const MAX_TEMPO = 360; // px/s Höchstgeschwindigkeit
export const SCHIFF_RADIUS = 11; // Trefferkreis des Schiffs
export const SCHUSS_TEMPO = 560; // px/s
export const SCHUSS_DAUER = 0.85; // s, dann verpufft ein Schuss
export const MAX_SCHUESSE = 4; // gleichzeitig im Flug
export const BONUS_ALLE = 10000; // Extraleben alle 10.000 Punkte

// Brocken: Größe 3 = groß, 2 = mittel, 1 = klein
export const BROCKEN_RADIUS = { 3: 40, 2: 22, 1: 12 };
const BROCKEN_PUNKTE = { 3: 20, 2: 50, 1: 100 };
export const UFO_PUNKTE = { gross: 200, klein: 1000 };
export const UFO_RADIUS = { gross: 18, klein: 10 };

/* ---------- Rand: Wer rechts hinausfliegt, kommt links wieder ---------- */

/** Faltet einen Wert in den Bereich [0, max). Auch für negative Werte. */
export function umlauf(wert, max) {
  return ((wert % max) + max) % max;
}

/**
 * Kürzester Abstand zweier Koordinaten auf einer "Rolle" der Länge max.
 * Beispiel bei max = 640: Punkt bei x = 5 und x = 635 sind nur 10 px
 * auseinander, nicht 630. Ohne das könnte man Brocken "über den Rand"
 * nicht treffen.
 */
export function umlaufDelta(a, b, max) {
  let d = b - a;
  if (d > max / 2) d -= max;
  if (d < -max / 2) d += max;
  return d;
}

/** Berühren sich zwei Kreise (mit Rand-Umlauf)? */
export function kreiseTreffen(a, ra, b, rb) {
  const dx = umlaufDelta(a.x, b.x, BREITE);
  const dy = umlaufDelta(a.y, b.y, HOEHE);
  const r = ra + rb;
  return dx * dx + dy * dy <= r * r; // Wurzel sparen: Quadrate vergleichen
}

/* ---------- Schiff ---------- */

export function neuesSchiff(x = BREITE / 2, y = HOEHE / 2) {
  return { x, y, winkel: -Math.PI / 2, vx: 0, vy: 0, schub: false, schutz: 2.2 };
}

/**
 * Ein Zeitschritt für das Schiff.
 * eingabe = { links, rechts, schub } (Booleans)
 * Trägheit: Ohne Schub gleitet das Schiff weiter und wird nur langsam
 * durch die Reibung gebremst, genau das macht das Spielgefühl aus.
 */
export function schiffSchritt(schiff, eingabe, dt) {
  if (eingabe.links) schiff.winkel -= DREH_TEMPO * dt;
  if (eingabe.rechts) schiff.winkel += DREH_TEMPO * dt;
  schiff.schub = Boolean(eingabe.schub);
  if (schiff.schub) {
    schiff.vx += Math.cos(schiff.winkel) * SCHUB * dt;
    schiff.vy += Math.sin(schiff.winkel) * SCHUB * dt;
  }
  // Exponentielle Reibung: unabhängig von der Schrittweite gleich stark
  const bremse = Math.exp(-REIBUNG * dt);
  schiff.vx *= bremse;
  schiff.vy *= bremse;
  const tempo = Math.hypot(schiff.vx, schiff.vy);
  if (tempo > MAX_TEMPO) {
    schiff.vx *= MAX_TEMPO / tempo;
    schiff.vy *= MAX_TEMPO / tempo;
  }
  schiff.x = umlauf(schiff.x + schiff.vx * dt, BREITE);
  schiff.y = umlauf(schiff.y + schiff.vy * dt, HOEHE);
  if (schiff.schutz > 0) schiff.schutz = Math.max(0, schiff.schutz - dt);
}

/** Neuer Schuss an der Schiffsspitze. Erbt die Schiffsgeschwindigkeit. */
export function schussVomSchiff(schiff) {
  const cos = Math.cos(schiff.winkel);
  const sin = Math.sin(schiff.winkel);
  return {
    x: umlauf(schiff.x + cos * 15, BREITE),
    y: umlauf(schiff.y + sin * 15, HOEHE),
    vx: cos * SCHUSS_TEMPO + schiff.vx,
    vy: sin * SCHUSS_TEMPO + schiff.vy,
    rest: SCHUSS_DAUER,
  };
}

/** Bewegt einen Schuss. Gibt false zurück, wenn er verpufft ist. */
export function schussSchritt(schuss, dt) {
  schuss.x = umlauf(schuss.x + schuss.vx * dt, BREITE);
  schuss.y = umlauf(schuss.y + schuss.vy * dt, HOEHE);
  schuss.rest -= dt;
  return schuss.rest > 0;
}

/* ---------- Brocken ---------- */

/**
 * Erzeugt einen Brocken mit eigener, zufälliger Silhouette: ein Vieleck
 * mit 9 bis 12 Ecken, deren Abstand zur Mitte schwankt. So sieht jeder
 * Brocken anders aus (keine festen Vorlagen).
 */
export function neuerBrocken(groesse, x, y, zufall, welle = 1) {
  const ecken = 9 + Math.floor(zufall() * 4);
  const form = [];
  for (let i = 0; i < ecken; i++) {
    form.push(0.72 + zufall() * 0.4); // Radius-Faktor je Ecke
  }
  // Kleinere Brocken sind schneller, spätere Wellen auch ein bisschen.
  const grundTempo = { 3: 38, 2: 62, 1: 92 }[groesse] * (1 + Math.min(welle - 1, 8) * 0.06);
  const tempo = grundTempo * (0.7 + zufall() * 0.6);
  const richtung = zufall() * Math.PI * 2;
  return {
    groesse,
    x,
    y,
    vx: Math.cos(richtung) * tempo,
    vy: Math.sin(richtung) * tempo,
    drehung: zufall() * Math.PI * 2,
    drehTempo: (zufall() - 0.5) * 1.6,
    form,
  };
}

export function brockenSchritt(b, dt) {
  b.x = umlauf(b.x + b.vx * dt, BREITE);
  b.y = umlauf(b.y + b.vy * dt, HOEHE);
  b.drehung += b.drehTempo * dt;
}

/** Ein getroffener Brocken zerfällt in zwei kleinere (kleine verschwinden). */
export function brockenTeilen(b, zufall, welle) {
  if (b.groesse <= 1) return [];
  return [0, 1].map(() => neuerBrocken(b.groesse - 1, b.x, b.y, zufall, welle));
}

export function punkteFuer(groesse) {
  return BROCKEN_PUNKTE[groesse] ?? 0;
}

/** Anzahl großer Brocken zu Beginn einer Welle: 4, 6, 8, 10, dann 11. */
export function brockenProWelle(welle) {
  return Math.min(11, 2 + welle * 2);
}

/**
 * Startpositionen einer Welle: am Rand verteilt und mindestens
 * `abstand` Pixel vom Schiff entfernt, damit man nicht sofort stirbt.
 */
export function wellenBrocken(welle, schiff, zufall) {
  const liste = [];
  const anzahl = brockenProWelle(welle);
  for (let i = 0; i < anzahl; i++) {
    let x,
      y,
      versuche = 0;
    do {
      // abwechselnd an einem senkrechten bzw. waagerechten Rand
      if (zufall() < 0.5) {
        x = zufall() < 0.5 ? 0 : BREITE - 1;
        y = zufall() * HOEHE;
      } else {
        x = zufall() * BREITE;
        y = zufall() < 0.5 ? 0 : HOEHE - 1;
      }
      versuche++;
    } while (schiff && versuche < 20 && kreiseTreffen({ x, y }, 0, schiff, 160));
    liste.push(neuerBrocken(3, x, y, zufall, welle));
  }
  return liste;
}

/** Ist die Mitte frei genug, um ein neues Schiff abzusetzen? */
export function mitteFrei(brocken, ufo) {
  const mitte = { x: BREITE / 2, y: HOEHE / 2 };
  if (ufo && kreiseTreffen(mitte, 90, ufo, UFO_RADIUS[ufo.art])) return false;
  return !brocken.some((b) => kreiseTreffen(mitte, 90, b, BROCKEN_RADIUS[b.groesse]));
}

/* ---------- UFOs ---------- */

/**
 * Wahrscheinlichkeit, dass das kleine (gefährliche) UFO kommt.
 * Steigt mit Punkten und Welle, ab 40.000 Punkten fast immer.
 */
export function kleinesUfoChance(punkte, welle) {
  return Math.min(0.9, 0.08 + punkte / 45000 + (welle - 1) * 0.04);
}

/** Pause bis zum nächsten UFO in Sekunden (wird mit der Welle kürzer). */
export function ufoPause(welle, zufall) {
  return Math.max(7, 18 - welle * 1.2) + zufall() * 6;
}

export function neuesUfo(punkte, welle, zufall) {
  const art = zufall() < kleinesUfoChance(punkte, welle) ? "klein" : "gross";
  const vonLinks = zufall() < 0.5;
  const tempo = art === "klein" ? 120 : 85;
  return {
    art,
    x: vonLinks ? -20 : BREITE + 20,
    y: 40 + zufall() * (HOEHE - 80),
    vx: vonLinks ? tempo : -tempo,
    vy: 0,
    kursWechsel: 1 + zufall() * 1.5, // s bis zum nächsten Höhenwechsel
    schussPause: 1.2, // s bis zum ersten Schuss
    strecke: 0, // zurückgelegte Pixel (UFO verlässt das Feld nach einer Breite)
  };
}

/** Bewegt das UFO. Gibt false zurück, wenn es das Feld verlassen hat. */
export function ufoSchritt(ufo, dt, zufall) {
  ufo.kursWechsel -= dt;
  if (ufo.kursWechsel <= 0) {
    // zufällig schräg hoch, schräg runter oder geradeaus
    const wahl = Math.floor(zufall() * 3) - 1;
    ufo.vy = wahl * Math.abs(ufo.vx) * 0.6;
    ufo.kursWechsel = 0.8 + zufall() * 1.6;
  }
  ufo.x += ufo.vx * dt;
  ufo.y = umlauf(ufo.y + ufo.vy * dt, HOEHE);
  ufo.strecke += Math.abs(ufo.vx * dt);
  return ufo.strecke < BREITE + 40;
}

/**
 * Schusswinkel eines UFOs.
 * Großes UFO: schießt in eine zufällige Richtung.
 * Kleines UFO: zielt auf das Schiff, mit einer Streuung, die mit den
 * Punkten des Spielers kleiner wird (es wird immer treffsicherer).
 */
export function ufoZielWinkel(ufo, schiff, punkte, zufall) {
  if (ufo.art === "gross" || !schiff) return zufall() * Math.PI * 2;
  const dx = umlaufDelta(ufo.x, schiff.x, BREITE);
  const dy = umlaufDelta(ufo.y, schiff.y, HOEHE);
  const streuung = Math.max(0.06, 0.55 - punkte / 40000);
  return Math.atan2(dy, dx) + (zufall() - 0.5) * 2 * streuung;
}

export function ufoSchuss(ufo, winkel) {
  const tempo = 300;
  return {
    x: ufo.x,
    y: ufo.y,
    vx: Math.cos(winkel) * tempo,
    vy: Math.sin(winkel) * tempo,
    rest: 1.4,
  };
}

/* ---------- Punkte & Leben ---------- */

/** Wie viele Extraleben gibt es beim Sprung von `alt` auf `neu` Punkte? */
export function bonusLeben(alt, neu) {
  return Math.floor(neu / BONUS_ALLE) - Math.floor(alt / BONUS_ALLE);
}

/** Hyperraum: zufällige Zielposition (mit Abstand zum Rand). */
export function hyperraumZiel(zufall) {
  return { x: 30 + zufall() * (BREITE - 60), y: 30 + zufall() * (HOEHE - 60) };
}
