// The card of an action is open by default. The setting folds it and a long
// output stays folded too. A click of the reader wins over both, so the card
// follows the setting again only for the cards nobody touched.
export function cardOpen(
  collapsed: boolean,
  verbose: boolean,
  override: boolean | null
): boolean {
  return override ?? (!collapsed && !verbose);
}
