import "./CrewSelector.css";
import { h, setText } from "../../lib/dom";
import { VITALS, formatVital } from "../../lib/vitals";
import type { CrewHealth, VitalKey } from "../../types";
import { createStatusBadge } from "../StatusBadge/StatusBadge";

const MINI_STATS: VitalKey[] = ["heartRate", "spo2", "temperature"];

interface CardRefs {
  button: HTMLButtonElement;
  badge: ReturnType<typeof createStatusBadge>;
  stats: Map<VitalKey, HTMLElement>;
}

/** Row of crew cards; clicking one selects whose vitals are shown below. */
export function createCrewSelector({ onSelect }: { onSelect: (crewId: string) => void }) {
  const meta = h("span", { class: "section-header__meta" });
  const list = h("div", { class: "crew-selector__list", role: "group", "aria-label": "Crew members" });
  const el = h(
    "section",
    { class: "crew-selector", id: "crew" },
    h("div", { class: "section-header" }, h("h2", { class: "section-header__title" }, "Crew"), meta),
    list,
  );

  const cards = new Map<string, CardRefs>();

  function buildCard(crew: CrewHealth): CardRefs {
    const badge = createStatusBadge(crew.status);
    const stats = new Map<VitalKey, HTMLElement>();
    const statEls = MINI_STATS.map((key) => {
      const value = h("span", { class: "crew-card__stat-value num" });
      stats.set(key, value);
      return h(
        "span",
        { class: "crew-card__stat", style: { "--metric": VITALS[key].color } },
        h("span", { class: "crew-card__stat-label" }, VITALS[key].short),
        value,
      );
    });

    const button = h(
      "button",
      {
        class: "crew-card",
        type: "button",
        "aria-pressed": "false",
        onClick: () => onSelect(crew.member.id),
      },
      h(
        "span",
        { class: "crew-card__top" },
        h("span", { class: "crew-card__avatar" }, crew.member.initials),
        h(
          "span",
          { class: "crew-card__who" },
          h("span", { class: "crew-card__name" }, crew.member.name),
          h("span", { class: "crew-card__role" }, `${crew.member.role} · ${crew.member.module}`),
        ),
        badge.el,
      ),
      h("span", { class: "crew-card__stats" }, statEls),
    );
    list.append(button);
    return { button, badge, stats };
  }

  function update(crew: CrewHealth[], selectedId: string) {
    const flagged = crew.filter((c) => c.status !== "nominal").length;
    setText(meta, `${crew.length} aboard · ${flagged === 0 ? "all nominal" : `${flagged} need attention`}`);

    for (const member of crew) {
      const refs = cards.get(member.member.id) ?? buildCard(member);
      cards.set(member.member.id, refs);
      refs.badge.update(member.status);
      refs.button.dataset.status = member.status;
      refs.button.setAttribute("aria-pressed", String(member.member.id === selectedId));
      for (const [key, valueEl] of refs.stats) {
        const vital = member.vitals.find((v) => v.key === key);
        if (vital) {
          setText(valueEl, `${formatVital(vital)}${VITALS[key].unit === "%" ? "%" : ""}`);
          valueEl.dataset.status = vital.status;
        }
      }
    }
  }

  return { el, update };
}
