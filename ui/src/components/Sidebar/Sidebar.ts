import "./Sidebar.css";
import { h, setText } from "../../lib/dom";
import { icon, type IconName } from "../../lib/icons";

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
}

export interface SidebarState {
  missionName: string;
  missionDay: number;
  alertCount: number;
  linkOnline: boolean;
}

export function createSidebar(items: NavItem[]) {
  const links = new Map<string, HTMLAnchorElement>();
  const alertBadge = h("span", { class: "sidebar__badge num", hidden: true });

  const nav = h(
    "nav",
    { class: "sidebar__nav", "aria-label": "Sections" },
    items.map((item) => {
      const link = h(
        "a",
        { class: "sidebar__link", href: `#${item.id}`, title: item.label },
        icon(item.icon, 18),
        h("span", { class: "sidebar__label" }, item.label),
        item.id === "alerts" ? alertBadge : null,
      );
      links.set(item.id, link);
      return link;
    }),
  );

  const missionName = h("span", { class: "sidebar__mission-name" });
  const missionDay = h("span", { class: "sidebar__mission-day num" });
  const linkText = h("span", { class: "sidebar__link-text" });
  const linkDot = h("span", { class: "sidebar__link-dot" });

  const el = h(
    "aside",
    { class: "sidebar" },
    h(
      "a",
      { class: "sidebar__brand", href: "#overview" },
      h("img", { class: "sidebar__logo", src: "/boops-logo.svg", alt: "", width: 32, height: 32 }),
      h(
        "span",
        { class: "sidebar__brand-text" },
        h("span", { class: "sidebar__brand-name" }, "boops"),
        h("span", { class: "sidebar__brand-sub" }, "Crew health"),
      ),
    ),
    nav,
    h(
      "div",
      { class: "sidebar__mission" },
      h("div", { class: "sidebar__mission-row" }, icon("satellite", 16), missionName),
      missionDay,
      h("div", { class: "sidebar__link-status" }, linkDot, linkText),
    ),
  );

  function setActive(id: string) {
    for (const [itemId, link] of links) {
      if (itemId === id) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  }

  function update(state: SidebarState) {
    setText(missionName, state.missionName);
    setText(missionDay, `Mission day ${state.missionDay}`);
    setText(linkText, state.linkOnline ? "Ground link locked" : "Ground link lost");
    linkDot.dataset.online = String(state.linkOnline);
    alertBadge.hidden = state.alertCount === 0;
    setText(alertBadge, String(state.alertCount));
  }

  setActive(items[0]?.id ?? "");
  return { el, setActive, update };
}
