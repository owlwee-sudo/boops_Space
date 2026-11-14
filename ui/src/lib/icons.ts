import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bell,
  ChartSpline,
  Check,
  CircleCheck,
  Clock,
  Droplet,
  Gauge,
  HeartPulse,
  LayoutGrid,
  Minus,
  Moon,
  Radiation,
  Satellite,
  Thermometer,
  TriangleExclamationPoint,
  Users,
  Wind,
  createElement,
  type IconNode,
} from "lucide";

export const Icons = {
  activity: Activity,
  arrowDown: ArrowDown,
  arrowUp: ArrowUp,
  bell: Bell,
  chart: ChartSpline,
  check: Check,
  circleCheck: CircleCheck,
  clock: Clock,
  droplet: Droplet,
  gauge: Gauge,
  heart: HeartPulse,
  grid: LayoutGrid,
  minus: Minus,
  moon: Moon,
  radiation: Radiation,
  satellite: Satellite,
  thermometer: Thermometer,
  warning: TriangleExclamationPoint,
  users: Users,
  wind: Wind,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof Icons;

/** Render a Lucide icon as an inline SVG element. */
export function icon(name: IconName, size = 16, strokeWidth = 1.75): SVGElement {
  return createElement(Icons[name], {
    width: size,
    height: size,
    "stroke-width": strokeWidth,
    class: "icon",
    "aria-hidden": "true",
  });
}
