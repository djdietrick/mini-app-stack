import { catalog } from "./catalog.js";
import "./style.css";

const list = document.getElementById("apps")!;

for (const app of catalog) {
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.className = "card";
  link.href = __APP_URLS__[app.id];
  link.style.setProperty("--accent", app.accent);

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = app.name.charAt(0);

  const name = document.createElement("h2");
  name.textContent = app.name;

  const tagline = document.createElement("p");
  tagline.className = "tagline";
  tagline.textContent = app.tagline;

  const description = document.createElement("p");
  description.className = "description";
  description.textContent = app.description;

  const open = document.createElement("span");
  open.className = "open";
  open.textContent = "Open";
  open.setAttribute("aria-hidden", "true");

  link.append(badge, name, tagline, description, open);
  item.append(link);
  list.append(item);
}
