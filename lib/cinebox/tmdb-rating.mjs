export function normalizeTmdbRating(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10
    ? value
    : undefined;
}

export function displayTmdbRating(value) {
  return normalizeTmdbRating(value) ?? "—";
}
