/**
 * Draft-commit subjects for the generic collection item routes.
 *
 * Pages read as "Update page about" rather than "Update pages/about":
 * the page editor and the Pages panel save through these routes, and
 * the subject is what shows up in the site repo's history. Every other
 * collection keeps the `<collection>/<item>` form.
 */

export type ItemCommitAction = "create" | "update" | "delete";

const VERBS: Record<ItemCommitAction, string> = {
  create: "Create",
  update: "Update",
  delete: "Delete",
};

export function itemCommitSubject(
  action: ItemCommitAction,
  collectionSlug: string,
  itemSlug: string,
): string {
  const verb = VERBS[action];
  if (collectionSlug === "pages") return `${verb} page ${itemSlug}`;
  return `${verb} ${collectionSlug}/${itemSlug}`;
}

export function renameCommitSubject(
  collectionSlug: string,
  oldSlug: string,
  newSlug: string,
): string {
  if (collectionSlug === "pages") return `Rename page ${oldSlug} → ${newSlug}`;
  return `Rename ${collectionSlug}/${oldSlug} → ${newSlug}`;
}
