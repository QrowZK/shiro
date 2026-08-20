/**
 * Rank colours: the tint Zero-K's rank icons carry, so a player's Elo reads the
 * same way in Shiro as their badge does in the official client.
 *
 * A port of Chobby's `configs/gameConfig/zk/rankFunction.lua`, which picks an
 * icon from an 8x8 grid named `<levelBracket>_<skillBracket>.png`:
 *
 *   levelBracket - how far the account's level has passed 5/10/20/35/50/75/100
 *   skillBracket - `clamp(floor((elo - 1000) / 200), 0, 7)`
 *
 * The colours below were measured off those 64 icons rather than guessed. The
 * finding that matters: **hue tracks the skill bracket and is flat across the
 * level axis** - all eight level rows of a given column are the same colour to
 * within a shade. So "colour it by rank" and "colour it by Elo band" are the
 * same instruction, and the icon is the thing that reconciles them.
 */

/** The eight bands, low to high, as measured from the rank icons. */
export const RANK_COLOURS = [
  "#767676",   // under 1200 - grey
  "#BD272F",   // 1200-1399  - red
  "#D16225",   // 1400-1599  - orange
  "#D18F25",   // 1600-1799  - amber
  "#DEB90B",   // 1800-1999  - yellow
  "#169BBF",   // 2000-2199  - cyan
  "#2E64F5",   // 2200-2399  - blue
  "#9113D0",   // 2400 and up- purple
] as const;

/** Where the icon grid's second index comes from. Upstream's formula. */
export function skillBracket(elo: number): number {
  return Math.max(0, Math.min(7, Math.floor((elo - 1000) / 200)));
}

/**
 * The colour for an Elo, or undefined when there is no Elo to colour.
 *
 * Undefined rather than a default: a player whose rating we do not have and a
 * player in the bottom band are not the same thing, and giving them the same
 * grey would say they were.
 */
export function rankColour(elo: number | undefined): string | undefined {
  if (elo == null || !Number.isFinite(elo)) return undefined;
  return RANK_COLOURS[skillBracket(elo)];
}
