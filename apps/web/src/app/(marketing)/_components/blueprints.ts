export type Blueprint = { name: string; body: string };

// Shared across the homepage "templates" section and the /examples gallery.
export const BLUEPRINTS: Blueprint[] = [
  { name: "Solo artist", body: "Bio, music, photos, and shows for a single performer." },
  { name: "Band / ensemble", body: "Members, releases, and a shared tour calendar." },
  { name: "Composer / educator", body: "Works, recordings, teaching, and a résumé or CV." },
  { name: "Press kit (EPK)", body: "A polished one-stop page for bookers and press." },
  { name: "Tour-focused", body: "Dates front and center with ticket links." },
];
