export type SiteSection = { name: string; body: string };

// What every new Stagecraft site contains, shared by the homepage and the
// /examples page. Keep it in step with the musician-site template's
// first-run seed (templates/musician-site/src/lib/first-run-seeds.ts) and
// theme presets (src/lib/theme-presets.ts): every site gets the same pages,
// and the theme sets the look.
export const SITE_SECTIONS: SiteSection[] = [
  { name: "Home", body: "A hero with your name, your latest release, upcoming shows, and a photo gallery." },
  { name: "Music", body: "Your releases, listed automatically as you add them." },
  { name: "Tour dates", body: "Add a show once and it appears wherever your site lists dates." },
  { name: "Updates", body: "News posts for announcements, interviews, and studio notes." },
  { name: "About & Contact", body: "A bio page, plus a contact form that goes to your email." },
  { name: "Themes", body: "Pick a ready-made theme or your own accent color, and change fonts and colors any time." },
];
